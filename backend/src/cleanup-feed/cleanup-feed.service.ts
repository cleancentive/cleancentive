import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, type FindOptionsWhere } from 'typeorm';
import { isSupportedLocale, type Locale } from '@cleancentive/shared';
import { Cleanup } from '../cleanup/cleanup.entity';
import { CleanupDate } from '../cleanup/cleanup-date.entity';
import { CleanupParticipant } from '../cleanup/cleanup-participant.entity';
import { CleanupService } from '../cleanup/cleanup.service';
import { Team } from '../team/team.entity';
import { TeamMembership } from '../team/team-membership.entity';
import { UserEmail } from '../user/user-email.entity';
import { AdminService } from '../admin/admin.service';
import { EmailService } from '../email/email.service';
import { CalendarService } from '../calendar/calendar.service';
import { resolveNotificationRecipients } from '../user/notification-recipients';
import { emailStrings } from '../email/email.i18n';
import {
  CleanupFeed,
  CleanupFeedRunSummary,
  CleanupFeedSettings,
  DEFAULT_FEED_SETTINGS,
  type CleanupFeedKind,
} from './cleanup-feed.entity';
import { FEED_ADAPTERS, isCleanupFeedKind } from './adapters/registry';
import type { AdapterContext, ExternalCleanup, ExternalListing } from './adapters/adapter';
import { assertPublicHttpUrl, fetchHtml, fetchJson, RequestPacer } from './fetch-page';
import { Geocoder } from './geocoder';
import { reconcile, normalizeName, type LinkedCleanupRow, type ReconcilePlan } from './reconciler';
import { candidateNames } from './description-format';
import { zonedDayKey } from './local-time';

const TIME_ZONE = 'Europe/Zurich';
const SOURCE_PACING_MS = 1000;

export interface CreateFeedInput {
  kind: string;
  url: string;
  settings?: Partial<CleanupFeedSettings>;
  enabled?: boolean;
}

/** What reading the source cost and covered, as opposed to what changed. */
interface SourceStats {
  listed: number;
  fetched: number;
  skippedPast: number;
  skippedUnchanged: number;
}

export interface RefreshResult {
  plan: ReconcilePlan;
  summary: CleanupFeedRunSummary;
}

@Injectable()
export class CleanupFeedService {
  private readonly logger = new Logger(CleanupFeedService.name);

  constructor(
    @InjectRepository(CleanupFeed)
    private readonly feedRepository: Repository<CleanupFeed>,
    @InjectRepository(Cleanup)
    private readonly cleanupRepository: Repository<Cleanup>,
    @InjectRepository(CleanupDate)
    private readonly cleanupDateRepository: Repository<CleanupDate>,
    @InjectRepository(CleanupParticipant)
    private readonly cleanupParticipantRepository: Repository<CleanupParticipant>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMembership)
    private readonly teamMembershipRepository: Repository<TeamMembership>,
    @InjectRepository(UserEmail)
    private readonly userEmailRepository: Repository<UserEmail>,
    private readonly cleanupService: CleanupService,
    private readonly adminService: AdminService,
    private readonly emailService: EmailService,
    private readonly calendarService: CalendarService,
    private readonly geocoder: Geocoder,
  ) {}

  // ---------------------------------------------------------------- registry

  async listFeeds(teamId: string): Promise<CleanupFeed[]> {
    await this.getTeamOrThrow(teamId);
    return this.feedRepository.find({ where: { team_id: teamId }, order: { created_at: 'ASC' } });
  }

  async createFeed(teamId: string, input: CreateFeedInput): Promise<CleanupFeed> {
    await this.getTeamOrThrow(teamId);
    const kind = this.parseKind(input.kind);
    const url = assertPublicHttpUrl(input.url).toString();

    const existing = await this.feedRepository.findOne({ where: { team_id: teamId, url } });
    if (existing) {
      throw new BadRequestException('This team already mirrors that listing');
    }

    const feed = this.feedRepository.create({
      team_id: teamId,
      kind,
      url,
      settings: this.parseSettings(input.settings),
      enabled: input.enabled ?? true,
      last_run_at: null,
      last_success_at: null,
      last_error: null,
      last_summary: null,
    });
    return this.feedRepository.save(feed);
  }

  async updateFeed(
    teamId: string,
    feedId: string,
    input: { url?: string; settings?: Partial<CleanupFeedSettings>; enabled?: boolean },
  ): Promise<CleanupFeed> {
    const feed = await this.getFeedOrThrow(teamId, feedId);
    if (input.url !== undefined) {
      feed.url = assertPublicHttpUrl(input.url).toString();
    }
    if (input.settings !== undefined) {
      feed.settings = this.parseSettings({ ...feed.settings, ...input.settings });
    }
    if (input.enabled !== undefined) {
      feed.enabled = input.enabled;
    }
    return this.feedRepository.save(feed);
  }

  async deleteFeed(teamId: string, feedId: string): Promise<void> {
    const feed = await this.getFeedOrThrow(teamId, feedId);
    // Cleanups it created stay; they simply stop being refreshed.
    await this.feedRepository.delete({ id: feed.id });
  }

  async getFeedOrThrow(teamId: string, feedId: string): Promise<CleanupFeed> {
    const feed = await this.feedRepository.findOne({ where: { id: feedId, team_id: teamId } });
    if (!feed) {
      throw new NotFoundException('Cleanup feed not found');
    }
    return feed;
  }

  async getFeedById(feedId: string): Promise<CleanupFeed | null> {
    return this.feedRepository.findOne({ where: { id: feedId } });
  }

  async listEnabledFeeds(): Promise<CleanupFeed[]> {
    return this.feedRepository.find({ where: { enabled: true }, order: { created_at: 'ASC' } });
  }

  // ---------------------------------------------------------------- refresh

  /**
   * Reads the source, works out what should change, and — unless this is a dry
   * run — applies it. Runs in a worker, never in a request: the audit columns
   * of everything written here must stay empty rather than name whichever
   * steward happened to press the button.
   */
  async refreshFeed(feedId: string, dryRun: boolean): Promise<RefreshResult> {
    const feed = await this.feedRepository.findOne({ where: { id: feedId } });
    if (!feed) {
      throw new NotFoundException('Cleanup feed not found');
    }
    const team = await this.getTeamOrThrow(feed.team_id);
    const startedAt = new Date();

    if (!dryRun) {
      await this.feedRepository.update({ id: feed.id }, { last_run_at: startedAt });
    }

    try {
      const { plan, stats } = await this.buildPlan(feed, team);
      const summary = dryRun
        ? this.summarize(plan, stats, startedAt, true)
        : await this.applyPlan(feed, team, plan, stats, startedAt);

      if (!dryRun) {
        const previousErrors = feed.last_summary?.errors ?? [];
        await this.feedRepository.update(
          { id: feed.id },
          { last_success_at: new Date(), last_error: null, last_summary: summary },
        );
        if (this.shouldSendDigest(summary, previousErrors)) {
          await this.sendDigest(feed, team, summary);
        }
      }

      return { plan, summary };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Cleanup feed ${feed.id} (${feed.kind}) failed: ${message}`);
      if (!dryRun) {
        await this.feedRepository.update({ id: feed.id }, { last_error: message });
      }
      throw error;
    }
  }

  /** Reads the source and turns it into a plan, fetching as little as it can. */
  private async buildPlan(feed: CleanupFeed, team: Team): Promise<{ plan: ReconcilePlan; stats: SourceStats }> {
    const adapter = FEED_ADAPTERS[feed.kind];
    const now = new Date();
    const ctx = this.makeAdapterContext(now);

    const listings = await adapter.list(feed, ctx);
    const listedExternalIds = new Set(listings.map((listing) => listing.externalId));

    const linked = await this.loadLinkedRows(feed.id);
    const liveByExternalId = new Map(
      linked
        .filter((row) => !row.archivedAt && row.externalId && row.dates.some((d) => d.endAt > now))
        .map((row) => [row.externalId, row]),
    );

    const today = zonedDayKey(now, TIME_ZONE);
    const externals: ExternalCleanup[] = [];
    const unresolved: Array<{ listing: ExternalListing; reason: string }> = [];
    const stats: SourceStats = { listed: listings.length, fetched: 0, skippedPast: 0, skippedUnchanged: 0 };

    for (const listing of listings) {
      // Past events are never mirrored, and the listing already says when each
      // one is — so this costs no request at all.
      if (listing.startsOn && listing.startsOn < today) {
        stats.skippedPast++;
        continue;
      }
      const existing = liveByExternalId.get(listing.externalId);
      if (existing && listing.version && existing.version === listing.version) {
        stats.skippedUnchanged++;
        continue;
      }
      stats.fetched++;

      try {
        const detail = await adapter.fetchDetail(listing, feed, ctx);
        if (detail.endAt.getTime() <= now.getTime()) {
          continue;
        }
        externals.push(await this.locate(detail, existing));
      } catch (error) {
        unresolved.push({ listing, reason: (error as Error).message });
      }
    }

    const missingCoordinates = externals.filter((external) => external.latitude === null || external.longitude === null);
    for (const external of missingCoordinates) {
      unresolved.push({
        listing: { externalId: external.externalId, url: external.url, title: external.title, version: external.version, startsOn: null },
        reason: external.address
          ? `could not find coordinates for "${external.address}"`
          : 'the source gives no address to locate',
      });
    }

    const plan = reconcile({
      now,
      feed: { id: feed.id, teamId: feed.team_id, teamName: team.name, settings: feed.settings },
      linked,
      candidatesByName: await this.loadNameCandidates(feed, externals),
      externals: externals.filter((external) => external.latitude !== null && external.longitude !== null),
      listedExternalIds,
      unresolved,
    });

    return { plan, stats };
  }

  /**
   * Fills in coordinates. An address the feed already geocoded keeps whatever
   * the cleanup holds now, so an organizer's corrected pin is not re-derived
   * (and then written back over their correction) on every refresh.
   */
  private async locate(external: ExternalCleanup, existing: LinkedCleanupRow | undefined): Promise<ExternalCleanup> {
    if (external.latitude !== null && external.longitude !== null) {
      return external;
    }
    const snapshot = existing?.snapshot;
    if (snapshot && snapshot.address === external.address) {
      return { ...external, latitude: snapshot.latitude, longitude: snapshot.longitude };
    }
    if (!external.address) {
      return external;
    }
    const found = await this.geocoder.locate(external.address);
    return found ? { ...external, latitude: found.latitude, longitude: found.longitude } : external;
  }

  private makeAdapterContext(now: Date): AdapterContext {
    const pacer = new RequestPacer(SOURCE_PACING_MS);
    return {
      now,
      fetchHtml: async (url: string) => {
        await pacer.wait();
        return fetchHtml(url);
      },
      fetchJson: async <T,>(url: string) => {
        await pacer.wait();
        return fetchJson<T>(url);
      },
      logger: this.logger,
    };
  }

  // ---------------------------------------------------------------- applying

  private async applyPlan(
    feed: CleanupFeed,
    team: Team,
    plan: ReconcilePlan,
    stats: SourceStats,
    startedAt: Date,
  ): Promise<CleanupFeedRunSummary> {
    const organizerIds = await this.resolveOrganizerIds(feed, team);
    const created: CleanupFeedRunSummary['items']['created'] = [];
    const adopted: CleanupFeedRunSummary['items']['adopted'] = [];
    const updated: CleanupFeedRunSummary['items']['updated'] = [];
    const archived: CleanupFeedRunSummary['items']['archived'] = [];

    for (const create of plan.creates) {
      const cleanupId = await this.createFromFeed(feed, team, create.external, create.name, create.description, organizerIds);
      created.push({
        cleanupId,
        name: create.name,
        startAt: create.external.startAt.toISOString(),
        url: create.external.url,
      });
    }

    for (const adoption of plan.adoptions) {
      await this.adopt(feed, adoption.cleanupId, adoption.external);
      const cleanup = await this.cleanupRepository.findOne({ where: { id: adoption.cleanupId } });
      adopted.push({ cleanupId: adoption.cleanupId, name: cleanup?.name ?? adoption.external.title });
    }

    for (const update of plan.updates) {
      await this.applyUpdate(update);
      updated.push({ cleanupId: update.cleanupId, name: update.name, fields: Object.keys(update.changes) });
    }

    for (const archive of plan.archives) {
      await this.archive(archive.cleanupId);
      archived.push({ cleanupId: archive.cleanupId, name: archive.name });
    }

    return this.summarize(plan, stats, startedAt, false, { created, adopted, updated, archived });
  }

  private async createFromFeed(
    feed: CleanupFeed,
    team: Team,
    external: ExternalCleanup,
    name: string,
    description: string,
    organizerIds: string[],
  ): Promise<string> {
    return this.cleanupRepository.manager.transaction(async (manager) => {
      const cleanup = manager.create(Cleanup, {
        name,
        name_normalized: normalizeName(name),
        description,
        archived_at: null,
        archived_by: null,
        team_id: team.id,
        feed_id: feed.id,
        external_id: external.externalId,
        external_url: external.url,
        external_version: external.version,
        synced_at: new Date(),
        sync_snapshot: null,
      });
      const savedCleanup = await manager.save(cleanup);

      const date = manager.create(CleanupDate, {
        cleanup_id: savedCleanup.id,
        start_at: external.startAt,
        end_at: external.endAt,
        latitude: external.latitude,
        longitude: external.longitude,
        location_name: external.locationName,
      });
      const savedDate = await manager.save(date);

      // The team's organizers become the cleanup's, so somebody can correct it.
      for (const userId of organizerIds) {
        await manager.save(manager.create(CleanupParticipant, {
          cleanup_id: savedCleanup.id,
          user_id: userId,
          role: 'organizer',
        }));
      }

      savedCleanup.sync_snapshot = {
        dateId: savedDate.id,
        name,
        description,
        startAt: external.startAt.toISOString(),
        endAt: external.endAt.toISOString(),
        address: external.address,
        latitude: external.latitude,
        longitude: external.longitude,
        locationName: external.locationName,
      };
      await manager.save(savedCleanup);

      return savedCleanup.id;
    });
  }

  /** Links a cleanup somebody entered by hand, keeping their text as it stands. */
  private async adopt(feed: CleanupFeed, cleanupId: string, external: ExternalCleanup): Promise<void> {
    const [cleanup] = await this.findWithSnapshot({ id: cleanupId });
    if (!cleanup) {
      return;
    }
    const dates = await this.cleanupDateRepository.find({ where: { cleanup_id: cleanupId }, order: { start_at: 'ASC' } });
    const nearest = dates.reduce<CleanupDate | null>((best, date) => {
      if (!best) return date;
      const bestGap = Math.abs(best.start_at.getTime() - external.startAt.getTime());
      const gap = Math.abs(date.start_at.getTime() - external.startAt.getTime());
      return gap < bestGap ? date : best;
    }, null);

    cleanup.feed_id = feed.id;
    cleanup.external_id = external.externalId;
    cleanup.external_url = external.url;
    cleanup.external_version = external.version;
    cleanup.synced_at = new Date();
    cleanup.team_id = cleanup.team_id ?? feed.team_id;
    // The snapshot records what is there now, not what the feed would write:
    // the human's version is the baseline, and only later source changes move it.
    cleanup.sync_snapshot = nearest
      ? {
          dateId: nearest.id,
          name: cleanup.name,
          description: cleanup.description,
          startAt: nearest.start_at.toISOString(),
          endAt: nearest.end_at.toISOString(),
          address: external.address,
          latitude: Number(nearest.latitude),
          longitude: Number(nearest.longitude),
          locationName: nearest.location_name,
        }
      : null;
    await this.cleanupRepository.save(cleanup);
  }

  private async applyUpdate(update: ReconcilePlan['updates'][number]): Promise<void> {
    const [cleanup] = await this.findWithSnapshot({ id: update.cleanupId });
    const date = await this.cleanupDateRepository.findOne({ where: { id: update.dateId } });
    if (!cleanup || !date) {
      return;
    }

    if (update.changes.name !== undefined) {
      cleanup.name = update.changes.name;
      cleanup.name_normalized = normalizeName(update.changes.name);
    }
    if (update.changes.description !== undefined) {
      cleanup.description = update.changes.description;
    }
    if (update.changes.startAt !== undefined) {
      date.start_at = new Date(update.changes.startAt);
    }
    if (update.changes.endAt !== undefined) {
      date.end_at = new Date(update.changes.endAt);
    }
    if (update.changes.latitude !== undefined) {
      date.latitude = update.changes.latitude;
    }
    if (update.changes.longitude !== undefined) {
      date.longitude = update.changes.longitude;
    }
    if (update.changes.locationName !== undefined) {
      date.location_name = update.changes.locationName;
    }
    await this.cleanupDateRepository.save(date);

    cleanup.external_version = update.external.version;
    cleanup.external_url = update.external.url;
    cleanup.synced_at = new Date();
    cleanup.sync_snapshot = {
      dateId: date.id,
      name: update.name,
      description: update.description,
      startAt: update.external.startAt.toISOString(),
      endAt: update.external.endAt.toISOString(),
      address: update.external.address,
      latitude: Number(date.latitude),
      longitude: Number(date.longitude),
      locationName: update.external.locationName,
    };
    await this.cleanupRepository.save(cleanup);
  }

  private async archive(cleanupId: string): Promise<void> {
    const cleanup = await this.cleanupRepository.findOne({ where: { id: cleanupId } });
    if (!cleanup || cleanup.archived_at) {
      return;
    }
    cleanup.archived_at = new Date();
    cleanup.archived_by = null;
    await this.cleanupRepository.save(cleanup);
    await this.cleanupService.clearActiveCleanupDates(cleanupId);
  }

  // ---------------------------------------------------------------- loading

  private async loadLinkedRows(feedId: string): Promise<LinkedCleanupRow[]> {
    return this.toRows(await this.findWithSnapshot({ feed_id: feedId }));
  }

  /** sync_snapshot is not selected by default; the reconciler needs it. */
  private async findWithSnapshot(where: FindOptionsWhere<Cleanup>): Promise<Cleanup[]> {
    return this.cleanupRepository
      .createQueryBuilder('cleanup')
      .addSelect('cleanup.sync_snapshot')
      .where(where)
      .getMany();
  }

  /**
   * Cleanups that are not linked to this feed but already carry a name the feed
   * would use — the hand-entered ones it should adopt rather than duplicate.
   */
  private async loadNameCandidates(feed: CleanupFeed, externals: ExternalCleanup[]): Promise<Map<string, LinkedCleanupRow>> {
    const names = externals.flatMap((external) => candidateNames(external, feed.settings)).map(normalizeName);
    if (names.length === 0) {
      return new Map();
    }
    const cleanups = await this.findWithSnapshot({ name_normalized: In([...new Set(names)]) });
    const rows = await this.toRows(cleanups.filter((cleanup) => !cleanup.feed_id && !cleanup.archived_at));
    return new Map(rows.map((row) => [row.nameNormalized, row]));
  }

  private async toRows(cleanups: Cleanup[]): Promise<LinkedCleanupRow[]> {
    if (cleanups.length === 0) {
      return [];
    }
    const dates = await this.cleanupDateRepository.find({
      where: { cleanup_id: In(cleanups.map((cleanup) => cleanup.id)) },
      order: { start_at: 'ASC' },
    });
    const datesByCleanup = new Map<string, CleanupDate[]>();
    for (const date of dates) {
      const list = datesByCleanup.get(date.cleanup_id) ?? [];
      list.push(date);
      datesByCleanup.set(date.cleanup_id, list);
    }

    return cleanups.map((cleanup) => ({
      id: cleanup.id,
      name: cleanup.name,
      nameNormalized: cleanup.name_normalized,
      description: cleanup.description,
      archivedAt: cleanup.archived_at,
      teamId: cleanup.team_id,
      feedId: cleanup.feed_id,
      externalId: cleanup.external_id,
      version: cleanup.external_version,
      snapshot: cleanup.sync_snapshot,
      dates: (datesByCleanup.get(cleanup.id) ?? []).map((date) => ({
        id: date.id,
        startAt: date.start_at,
        endAt: date.end_at,
        latitude: Number(date.latitude),
        longitude: Number(date.longitude),
        locationName: date.location_name,
      })),
    }));
  }

  /**
   * Who ends up able to edit what the feed creates: the team's organizers, or
   * failing that whoever registered the feed, or failing that the stewards.
   */
  private async resolveOrganizerIds(feed: CleanupFeed, team: Team): Promise<string[]> {
    const memberships = await this.teamMembershipRepository.find({ where: { team_id: team.id, role: 'organizer' } });
    if (memberships.length > 0) {
      return memberships.map((membership) => membership.user_id);
    }
    if (feed.created_by) {
      return [feed.created_by];
    }
    return this.adminService.getAdminUserIds();
  }

  // ---------------------------------------------------------------- digest

  /**
   * Mails when something actually happened, or when a *new* problem appeared.
   * A geocode that keeps failing is reported once and then only shown in the
   * steward view — a daily mail about it would train people to ignore these.
   */
  shouldSendDigest(summary: CleanupFeedRunSummary, previousErrors: CleanupFeedRunSummary['errors']): boolean {
    if (summary.created + summary.adopted + summary.updated + summary.archived > 0) {
      return true;
    }
    const seen = new Set(previousErrors.map((error) => `${error.externalId}:${error.reason}`));
    return summary.errors.some((error) => !seen.has(`${error.externalId}:${error.reason}`));
  }

  private async sendDigest(feed: CleanupFeed, team: Team, summary: CleanupFeedRunSummary): Promise<void> {
    const organizerIds = (await this.teamMembershipRepository.find({ where: { team_id: team.id, role: 'organizer' } }))
      .map((membership) => membership.user_id);
    const stewardIds = await this.adminService.getAdminUserIds();
    const recipients = await resolveNotificationRecipients(this.userEmailRepository, [
      ...new Set([...stewardIds, ...organizerIds]),
    ]);
    if (recipients.length === 0) {
      return;
    }

    const teamLink = `${this.calendarService.getAppBaseUrl()}/teams/${team.id}`;
    await this.emailService.sendCommunityMessage(recipients, null, (locale: Locale) => {
      const strings = emailStrings(locale).cleanupFeed;
      const sections: string[] = [strings.intro(new URL(feed.url).host), ''];

      const list = (label: string, entries: string[]) => {
        if (entries.length === 0) return;
        sections.push(`**${label}**`, '', ...entries.map((entry) => `- ${entry}`), '');
      };

      list(strings.createdLabel, summary.items.created.map((item) => strings.entry(item.name, this.formatWhen(item.startAt, locale))));
      list(strings.adoptedLabel, summary.items.adopted.map((item) => item.name));
      list(strings.updatedLabel, summary.items.updated.map((item) => `${item.name} (${item.fields.join(', ')})`));
      list(strings.archivedLabel, summary.items.archived.map((item) => item.name));
      list(strings.errorsLabel, summary.errors.map((error) => strings.errorEntry(error.title, error.reason)));

      sections.push(strings.action(teamLink));

      return {
        subject: strings.subject(team.name),
        preheader: strings.preheader(summary.created, summary.updated, summary.archived),
        title: strings.title(team.name),
        body: sections.join('\n'),
        disclosure: strings.disclosure,
      };
    });
  }

  private formatWhen(iso: string, locale: Locale): string {
    return new Intl.DateTimeFormat(locale, {
      timeZone: TIME_ZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  // ---------------------------------------------------------------- helpers

  private summarize(
    plan: ReconcilePlan,
    stats: SourceStats,
    startedAt: Date,
    dryRun: boolean,
    items?: CleanupFeedRunSummary['items'],
  ): CleanupFeedRunSummary {
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      dryRun,
      listed: stats.listed,
      fetched: stats.fetched,
      skippedPast: stats.skippedPast,
      created: plan.creates.length,
      adopted: plan.adoptions.length,
      updated: plan.updates.length,
      archived: plan.archives.length,
      unchanged: plan.unchanged.length + stats.skippedUnchanged,
      items: items ?? {
        created: plan.creates.map((create) => ({
          cleanupId: '',
          name: create.name,
          startAt: create.external.startAt.toISOString(),
          url: create.external.url,
        })),
        adopted: plan.adoptions.map((adoption) => ({ cleanupId: adoption.cleanupId, name: adoption.external.title })),
        updated: plan.updates.map((update) => ({
          cleanupId: update.cleanupId,
          name: update.name,
          fields: Object.keys(update.changes),
        })),
        archived: plan.archives.map((archive) => ({ cleanupId: archive.cleanupId, name: archive.name })),
      },
      errors: plan.errors,
    };
  }

  private parseKind(value: string): CleanupFeedKind {
    if (!isCleanupFeedKind(value)) {
      throw new BadRequestException(`Unknown feed kind "${value}"`);
    }
    return value;
  }

  private parseSettings(input?: Partial<CleanupFeedSettings>): CleanupFeedSettings {
    const language = input?.language ?? DEFAULT_FEED_SETTINGS.language;
    if (!isSupportedLocale(language)) {
      throw new BadRequestException('settings.language must be a supported locale');
    }
    const namePrefix = (input?.namePrefix ?? DEFAULT_FEED_SETTINGS.namePrefix).trim();
    if (namePrefix.length > 60) {
      throw new BadRequestException('settings.namePrefix must be 60 characters or fewer');
    }
    return { language, horizon: 'upcoming', namePrefix };
  }

  private async getTeamOrThrow(teamId: string): Promise<Team> {
    const team = await this.teamRepository.findOne({ where: { id: teamId } });
    if (!team || team.archived_at) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }
}
