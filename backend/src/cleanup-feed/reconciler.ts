import type { CleanupSyncSnapshot } from '../cleanup/cleanup.entity';
import type { CleanupFeedSettings } from './cleanup-feed.entity';
import type { ExternalCleanup, ExternalListing } from './adapters/adapter';
import { candidateNames, formatDescription, formatName } from './description-format';

/** A cleanup as the reconciler needs to see it — the feed's own, or a candidate to adopt. */
export interface LinkedCleanupRow {
  id: string;
  name: string;
  nameNormalized: string;
  description: string;
  archivedAt: Date | null;
  teamId: string | null;
  feedId: string | null;
  externalId: string | null;
  version: string | null;
  snapshot: CleanupSyncSnapshot | null;
  dates: Array<{
    id: string;
    startAt: Date;
    endAt: Date;
    latitude: number;
    longitude: number;
    locationName: string | null;
  }>;
}

export interface ReconcileInput {
  now: Date;
  feed: { id: string; teamId: string; settings: CleanupFeedSettings };
  /** Every cleanup already linked to this feed. */
  linked: LinkedCleanupRow[];
  /** Unlinked cleanups whose normalized name matches one the feed would use. */
  candidatesByName: Map<string, LinkedCleanupRow>;
  /** Fetched, geocoded, and already filtered to the feed's horizon. */
  externals: ExternalCleanup[];
  /** Every id the source still publishes, including ones we did not fetch. */
  listedExternalIds: Set<string>;
  /** Listings that could not be turned into a cleanup. */
  unresolved: Array<{ listing: ExternalListing; reason: string }>;
}

export type OwnedFields = Omit<CleanupSyncSnapshot, 'dateId' | 'address'>;

export interface ReconcilePlan {
  creates: Array<{ external: ExternalCleanup; name: string; description: string }>;
  adoptions: Array<{ cleanupId: string; external: ExternalCleanup }>;
  updates: Array<{
    cleanupId: string;
    dateId: string;
    external: ExternalCleanup;
    name: string;
    description: string;
    changes: Partial<OwnedFields>;
  }>;
  archives: Array<{ cleanupId: string; externalId: string; name: string }>;
  unchanged: string[];
  errors: Array<{ externalId: string; title: string; url: string; reason: string }>;
}

/**
 * Works out what a refresh should do. Pure on purpose: every rule below is one
 * the maintainers will want to argue with, and arguing is cheaper against a
 * function that takes rows and returns a plan.
 */
export function reconcile(input: ReconcileInput): ReconcilePlan {
  const plan: ReconcilePlan = {
    creates: [],
    adoptions: [],
    updates: [],
    archives: [],
    unchanged: [],
    errors: [],
  };

  const live = input.linked.filter((row) => isLive(row, input.now));
  const liveByExternalId = new Map(live.filter((row) => row.externalId).map((row) => [row.externalId, row]));
  const takenNames = new Set(input.linked.map((row) => row.nameNormalized));

  for (const external of input.externals) {
    const existing = liveByExternalId.get(external.externalId);
    if (existing) {
      planUpdate(plan, existing, external, input);
      continue;
    }
    planCreate(plan, external, input, takenNames);
  }

  for (const row of live) {
    if (!row.externalId || input.listedExternalIds.has(row.externalId)) {
      continue;
    }
    // The source no longer publishes it, and it has not happened yet.
    plan.archives.push({ cleanupId: row.id, externalId: row.externalId, name: row.name });
  }

  for (const { listing, reason } of input.unresolved) {
    plan.errors.push({ externalId: listing.externalId, title: listing.title, url: listing.url, reason });
  }

  return plan;
}

/**
 * Live means: not archived, and still to come. A past cleanup is left alone
 * forever — including when the source reuses its id for next season, which is
 * then a new cleanup rather than a rewrite of the one people attended.
 */
function isLive(row: LinkedCleanupRow, now: Date): boolean {
  if (row.archivedAt) {
    return false;
  }
  return row.dates.some((date) => date.endAt.getTime() > now.getTime());
}

function planCreate(
  plan: ReconcilePlan,
  external: ExternalCleanup,
  input: ReconcileInput,
  takenNames: Set<string>,
): void {
  const names = candidateNames(external, input.feed.settings);

  // Somebody may have entered this cleanup by hand before the feed existed.
  // Adopting it keeps their text and the participants who already joined.
  for (const name of names) {
    const candidate = input.candidatesByName.get(normalizeName(name));
    if (candidate && !candidate.feedId && sharesADate(candidate, external)) {
      plan.adoptions.push({ cleanupId: candidate.id, external });
      takenNames.add(candidate.nameNormalized);
      return;
    }
  }

  const free = names.find((name) => !takenNames.has(normalizeName(name)) && !input.candidatesByName.has(normalizeName(name)));
  if (!free) {
    plan.errors.push({
      externalId: external.externalId,
      title: external.title,
      url: external.url,
      reason: `a different cleanup is already called "${names[0]}"`,
    });
    return;
  }

  takenNames.add(normalizeName(free));
  plan.creates.push({
    external,
    name: free,
    description: formatDescription(external),
  });
}

function planUpdate(
  plan: ReconcilePlan,
  row: LinkedCleanupRow,
  external: ExternalCleanup,
  input: ReconcileInput,
): void {
  const date = row.dates.find((candidate) => candidate.id === row.snapshot?.dateId) ?? null;
  if (!date) {
    plan.errors.push({
      externalId: external.externalId,
      title: external.title,
      url: external.url,
      reason: 'the date this feed created was removed by an organizer',
    });
    return;
  }

  const name = formatName(external, input.feed.settings);
  const description = formatDescription(external);
  const snapshot = row.snapshot;

  // Only fields whose *source* value moved are rewritten. Anything an organizer
  // corrected by hand — a coordinate the geocoder got wrong, most often — stays
  // corrected until the source itself changes that field.
  const changes: Partial<OwnedFields> = {};
  if (!snapshot || snapshot.name !== name) changes.name = name;
  if (!snapshot || snapshot.description !== description) changes.description = description;
  if (!snapshot || snapshot.startAt !== external.startAt.toISOString()) changes.startAt = external.startAt.toISOString();
  if (!snapshot || snapshot.endAt !== external.endAt.toISOString()) changes.endAt = external.endAt.toISOString();
  if (external.latitude !== null && (!snapshot || snapshot.latitude !== external.latitude)) changes.latitude = external.latitude;
  if (external.longitude !== null && (!snapshot || snapshot.longitude !== external.longitude)) changes.longitude = external.longitude;
  if (!snapshot || snapshot.locationName !== external.locationName) changes.locationName = external.locationName;

  if (Object.keys(changes).length === 0) {
    plan.unchanged.push(external.externalId);
    return;
  }

  plan.updates.push({ cleanupId: row.id, dateId: date.id, external, name, description, changes });
}

/** Same day, give or take one — enough to tell "this event" from "another one". */
function sharesADate(row: LinkedCleanupRow, external: ExternalCleanup): boolean {
  const oneDay = 24 * 60 * 60 * 1000;
  return row.dates.some((date) => Math.abs(date.startAt.getTime() - external.startAt.getTime()) <= oneDay);
}

/** Same rule as CleanupService.normalizeName — names collide on this form. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
