import { BadRequestException, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Client as PgClient } from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { UserService } from '../user/user.service';
import { AdminService } from '../admin/admin.service';
import { Team } from '../team/team.entity';
import { TeamOutlineCollection } from '../team/team-outline-collection.entity';
import { OutlineWebhookConfig } from './outline-webhook-config.entity';
import { OutlineMaintenanceState } from './outline-maintenance-state.entity';

/**
 * Pushes cleancentive state into Outline's Postgres database in real-time so
 * the wiki stays in sync without a polling/batch script.
 *
 * Syncs: avatar URLs, admin role → Outline admin + "Stewards" group, and
 * cleancentive team membership → per-team Outline groups.
 *
 * Uses direct SQL on the `outline` database (same Postgres host, different DB).
 * Outline reads its tables on every request, so changes take effect immediately.
 */
@Injectable()
export class OutlineSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutlineSyncService.name);
  private pg: PgClient;
  private isPgConnected = false;
  private outlineTeamId: string | null = null;
  private outlineAdminUserId: string | null = null;

  private readonly outlineApiUrl = process.env.OUTLINE_API_URL ?? 'https://wiki.cleancentive.local';
  private readonly outlinePublicUrl = process.env.OUTLINE_PUBLIC_URL ?? process.env.WIKI_URL ?? 'https://wiki.cleancentive.local';
  private readonly umamiBaseUrl = process.env.UMAMI_PUBLIC_URL ?? 'https://analytics.cleancentive.local';
  private readonly umamiAdminUrl = process.env.UMAMI_URL ?? 'http://localhost:3001';
  private readonly umamiWikiDomain = process.env.UMAMI_WIKI_DOMAIN ?? new URL(this.outlinePublicUrl).hostname;
  private readonly outlineTeamLogoUrl = process.env.OUTLINE_TEAM_LOGO_URL ?? 'https://cleancentive.local/icon.svg';
  private readonly outlineWorkspaceName = process.env.OUTLINE_TEAM_NAME ?? 'CleanCentive Wiki';
  private readonly outlineS3Bucket = process.env.OUTLINE_S3_BUCKET ?? 'cleancentive-wiki';
  private outlineApiKey = '';
  private static readonly API_KEY_NAME = 'cleancentive-sync';

  private static readonly WEBHOOK_NAME = 'cleancentive-webhook';
  private static readonly WEBHOOK_EVENTS = [
    'documents.create',
    'documents.update',
    'documents.delete',
    'documents.archive',
    'comments.create',
  ];
  private static readonly WIPE_CONFIRMATION = 'WIPE_OUTLINE_CONTENT';
  private static readonly WIPE_STATE_KEY = 'outline-content-wiped';
  private static readonly INIT_STATE_KEY = 'outline-content-initialized';
  constructor(
    private readonly userService: UserService,
    private readonly adminService: AdminService,
    @InjectRepository(Team) private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamOutlineCollection)
    private readonly teamCollectionRepository: Repository<TeamOutlineCollection>,
    @InjectRepository(OutlineWebhookConfig)
    private readonly webhookConfigRepository: Repository<OutlineWebhookConfig>,
    @InjectRepository(OutlineMaintenanceState)
    private readonly maintenanceStateRepository: Repository<OutlineMaintenanceState>,
  ) {
    this.pg = new PgClient({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USERNAME ?? 'cleancentive',
      password: process.env.DB_PASSWORD ?? 'cleancentive_dev_password',
      database: 'outline',
    });
  }

  async onModuleInit() {
    await this.bootstrap();
  }

  async bootstrap(): Promise<void> {
    // Bucket presence check is best-effort: Backblaze B2 (and many S3-
    // compatible providers) reject HeadBucket/CreateBucket when the app key
    // is scoped to a single existing bucket. The bucket exists in prod, so a
    // failure here must not abort the rest of the bootstrap.
    try {
      await this.ensureWikiBucket();
    } catch (e) {
      this.logger.warn(`Wiki bucket check skipped (${e instanceof Error ? e.message : e})`);
    }
    try {
      if (!this.isPgConnected) {
        await this.pg.connect();
        this.isPgConnected = true;
      }
      await this.cacheOutlineTeamAndAdmin();
      await this.provisionWorkspaceBrandingAndAnalytics();
      await this.provisionApiKey();
      await this.provisionWebhookSubscription();
      await this.ensureStewardsGroup();
      await this.syncExistingAdmins();
      await this.backfillTeamCollections();
      await this.backfillUserAvatars();
    } catch (e) {
      this.logger.warn(`Outline sync disabled (${e instanceof Error ? e.message : e}). Wiki integration will not sync until the outline DB is reachable.`);
    }
  }

  async onModuleDestroy() {
    await this.pg.end().catch(() => {});
    this.isPgConnected = false;
  }

  private async cacheOutlineTeamAndAdmin(): Promise<void> {
    const teams = await this.pg.query<{ id: string }>('SELECT id FROM teams LIMIT 1');
    this.outlineTeamId = teams.rows[0]?.id ?? null;
    if (this.outlineTeamId) {
      const admins = await this.pg.query<{ id: string }>(
        `SELECT id FROM users WHERE "teamId" = $1 AND role = 'admin' LIMIT 1`,
        [this.outlineTeamId],
      );
      this.outlineAdminUserId = admins.rows[0]?.id ?? null;
    }
  }

  private async ensureStewardsGroup(): Promise<void> {
    if (!this.outlineTeamId || !this.outlineAdminUserId || !this.outlineApiKey) return;
    if (await this.findGroupIdByExternalId('stewards')) return;
    await this.callOutlineApi('/groups.create', { name: 'Stewards', externalId: 'stewards' });
    this.logger.log('Created "Stewards" group in Outline.');
  }

  private async ensureWikiBucket(): Promise<void> {
    const client = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9002',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
      },
    });

    try {
      await client.send(new HeadBucketCommand({ Bucket: this.outlineS3Bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: this.outlineS3Bucket }));
      this.logger.log(`Created Outline S3 bucket "${this.outlineS3Bucket}"`);
    }
  }

  private async getOrCreateUmamiWikiWebsite(): Promise<string> {
    const loginRes = await fetch(`${this.umamiAdminUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.UMAMI_USERNAME ?? 'admin',
        password: process.env.UMAMI_PASSWORD ?? 'umami',
      }),
    });
    if (!loginRes.ok) throw new Error(`Umami login failed: ${loginRes.status}`);
    const { token } = (await loginRes.json()) as { token: string };
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const listRes = await fetch(`${this.umamiAdminUrl}/api/websites`, { headers });
    if (!listRes.ok) throw new Error(`Umami website list failed: ${listRes.status}`);
    const { data } = (await listRes.json()) as { data: Array<{ id: string; name: string }> };
    const existing = data.find((website) => website.name === 'Cleancentive Wiki');
    if (existing) return existing.id;

    const createRes = await fetch(`${this.umamiAdminUrl}/api/websites`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Cleancentive Wiki', domain: this.umamiWikiDomain }),
    });
    if (!createRes.ok) throw new Error(`Umami website create failed: ${createRes.status}`);
    const created = (await createRes.json()) as { id: string };
    return created.id;
  }

  private async provisionWorkspaceBrandingAndAnalytics(): Promise<void> {
    if (!this.outlineTeamId) {
      this.logger.log(`Outline workspace provisioning pending first SSO sign-in at ${this.outlinePublicUrl}`);
      return;
    }

    const teams = await this.pg.query<{ avatarUrl: string | null; name: string | null }>(
      `SELECT "avatarUrl", name FROM teams WHERE id = $1 LIMIT 1`,
      [this.outlineTeamId],
    );
    const team = teams.rows[0];
    if (team && team.avatarUrl !== this.outlineTeamLogoUrl) {
      await this.pg.query(`UPDATE teams SET "avatarUrl" = $1, "updatedAt" = NOW() WHERE id = $2`, [
        this.outlineTeamLogoUrl,
        this.outlineTeamId,
      ]);
    }
    if (team && team.name !== this.outlineWorkspaceName) {
      await this.pg.query(`UPDATE teams SET name = $1, "updatedAt" = NOW() WHERE id = $2`, [
        this.outlineWorkspaceName,
        this.outlineTeamId,
      ]);
      this.logger.log(`Set Outline workspace name → "${this.outlineWorkspaceName}"`);
    }

    // Umami integration is best-effort — if Umami is unreachable or creds are
    // wrong on prod, we still want the rest of the bootstrap (API key,
    // collections, avatars) to run.
    let websiteId: string;
    try {
      websiteId = await this.getOrCreateUmamiWikiWebsite();
    } catch (e) {
      this.logger.warn(`Umami integration skipped (${e instanceof Error ? e.message : e})`);
      return;
    }
    const settings = { measurementId: websiteId, instanceUrl: this.umamiBaseUrl, scriptName: '/script.js' };
    const existing = await this.pg.query<{ id: string; settings: any }>(
      `SELECT id, settings FROM integrations WHERE service = 'umami' AND "teamId" = $1 LIMIT 1`,
      [this.outlineTeamId],
    );
    if (existing.rows[0]) {
      const current = existing.rows[0].settings ?? {};
      if (
        current.measurementId !== settings.measurementId ||
        current.instanceUrl !== settings.instanceUrl ||
        current.scriptName !== settings.scriptName
      ) {
        await this.pg.query(`UPDATE integrations SET settings = $1, "updatedAt" = NOW() WHERE id = $2`, [
          settings,
          existing.rows[0].id,
        ]);
      }
      return;
    }

    await this.pg.query(
      `INSERT INTO integrations (id, type, service, "teamId", settings, "createdAt", "updatedAt")
       VALUES ($1, 'analytics', 'umami', $2, $3, NOW(), NOW())`,
      [randomUUID(), this.outlineTeamId, settings],
    );
  }

  /** Backfill: ensure all current cleancentive admins are in the Stewards group + have Outline admin role. */
  private async syncExistingAdmins(): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    const adminUserIds = await this.adminService.getAdminUserIds();
    for (const userId of adminUserIds) {
      const email = await this.getEmail(userId);
      if (!email) continue;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) continue;
      try {
        await this.setOutlineUserRole(outlineUserId, 'admin');
        await this.addToGroup(outlineUserId, 'stewards');
      } catch (e) {
        this.logger.warn(`Admin backfill failed for ${email}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // --- Helpers -------------------------------------------------------------

  /** Look up an Outline user ID by their email address. */
  private async findOutlineUserId(email: string): Promise<string | null> {
    const res = await this.pg.query<{ id: string }>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND "teamId" = $2 LIMIT 1`,
      [email, this.outlineTeamId],
    );
    return res.rows[0]?.id ?? null;
  }

  /** Get the primary email for a cleancentive user. */
  private async getEmail(userId: string): Promise<string | null> {
    const user = await this.userService.findById(userId);
    return user?.emails?.[0]?.email ?? null;
  }

  /** Set Outline user role, treating "already in that role" 400 as a no-op. */
  private async setOutlineUserRole(outlineUserId: string, role: 'admin' | 'member'): Promise<void> {
    try {
      await this.callOutlineApi('/users.update_role', { id: outlineUserId, role });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('already in that role')) throw e;
    }
  }

  /** Look up an Outline group ID by its externalId. */
  private async findGroupIdByExternalId(externalId: string): Promise<string | null> {
    const res = await this.pg.query<{ id: string }>(
      `SELECT id FROM groups WHERE "externalId" = $1 AND "teamId" = $2`,
      [externalId, this.outlineTeamId],
    );
    return res.rows[0]?.id ?? null;
  }

  /**
   * Ensures bootstrap has completed successfully, attempting one re-bootstrap
   * if not. Returns true when the sync can act on Outline. Use as the gate at
   * the top of every event handler and reconciliation entry point so the sync
   * self-heals when the backend started before any Outline user existed.
   */
  private async ensureReady(): Promise<boolean> {
    if (this.isReady() && this.outlineApiKey) return true;
    this.logger.log('Outline sync not ready; attempting re-bootstrap');
    await this.bootstrap();
    return this.isReady() && !!this.outlineApiKey;
  }

  private isReady(): boolean {
    return this.outlineTeamId !== null && this.outlineAdminUserId !== null;
  }

  // --- Event Handlers ------------------------------------------------------

  async processEvent(eventName: string, payload: unknown): Promise<void> {
    if (!(await this.ensureReady())) {
      this.logger.warn(`Outline sync still not ready after re-bootstrap; dropping event ${eventName}`);
      return;
    }
    switch (eventName) {
      case 'user.profile-changed':
        return this.handleProfileChanged(payload as { userId: string });
      case 'user.avatar-changed':
        return this.handleAvatarChanged(payload as { userId: string; avatarEmailId: string | null });
      case 'admin.promoted':
        return this.handleAdminPromoted(payload as { userId: string });
      case 'admin.demoted':
        return this.handleAdminDemoted(payload as { userId: string });
      case 'team.member-joined':
        return this.handleTeamMemberJoined(payload as { teamId: string; userId: string; teamName: string });
      case 'team.member-left':
        return this.handleTeamMemberLeft(payload as { teamId: string; userId: string });
      case 'team.created':
        return this.handleTeamCreated(payload as { teamId: string; teamName: string });
      case 'team.renamed':
        return this.handleTeamRenamed(payload as { teamId: string; oldName: string; newName: string });
      case 'team.archived':
        return this.handleTeamArchived(payload as { teamId: string; teamName: string });
      case 'user.anonymized':
        return this.handleUserAnonymized(payload as { userId: string; emails: string[] });
      case 'user.deleted':
        return this.handleUserDeleted(payload as { userId: string; emails: string[] });
      default:
        throw new Error(`Unknown Outline sync event: ${eventName}`);
    }
  }

  async handleProfileChanged(payload: { userId: string }): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    try {
      const user = await this.userService.findById(payload.userId);
      if (!user) return;
      const email = user.emails?.[0]?.email;
      if (!email) return;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) return;
      const displayName =
        (user.full_name?.trim()) ||
        (user.nickname && user.nickname !== 'guest' ? user.nickname : null) ||
        email.split('@')[0];
      await this.callOutlineApi('/users.update', { id: outlineUserId, name: displayName });
      this.logger.debug(`Synced display name for ${email} → ${displayName}`);
    } catch (e) {
      this.logger.warn(`Profile sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async handleAvatarChanged(payload: { userId: string; avatarEmailId: string | null }): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    try {
      const email = await this.getEmail(payload.userId);
      if (!email) return;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) return;
      const appBaseUrl = (process.env.OIDC_ISSUER_URL ?? 'https://cleancentive.local/api/v1/oidc')
        .replace(/\/api\/v1\/oidc\/?$/, '');
      const avatarUrl = payload.avatarEmailId
        ? `${appBaseUrl}/api/v1/user/${payload.userId}/avatar?v=${payload.avatarEmailId}`
        : null;
      await this.callOutlineApi('/users.update', { id: outlineUserId, avatarUrl });
      this.logger.debug(`Synced avatar for ${email}`);
    } catch (e) {
      this.logger.warn(`Avatar sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async handleAdminPromoted(payload: { userId: string }): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    try {
      const email = await this.getEmail(payload.userId);
      if (!email) return;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) return;
      await this.setOutlineUserRole(outlineUserId, 'admin');
      await this.addToGroup(outlineUserId, 'stewards');
      this.logger.log(`Promoted ${email} to Outline admin + Stewards group`);
    } catch (e) {
      this.logger.warn(`Admin promotion sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async handleAdminDemoted(payload: { userId: string }): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    try {
      const email = await this.getEmail(payload.userId);
      if (!email) return;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) return;
      await this.setOutlineUserRole(outlineUserId, 'member');
      await this.removeFromGroup(outlineUserId, 'stewards');
      this.logger.log(`Demoted ${email} from Outline admin`);
    } catch (e) {
      this.logger.warn(`Admin demotion sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async handleTeamMemberJoined(payload: { teamId: string; userId: string; teamName: string }): Promise<void> {
    if (!this.isReady()) return;
    try {
      const email = await this.getEmail(payload.userId);
      if (!email) return;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) return;
      await this.addToGroup(outlineUserId, payload.teamId);
      this.logger.debug(`Added ${email} to Outline group for team ${payload.teamName}`);
    } catch (e) {
      this.logger.warn(`Team join sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async handleTeamMemberLeft(payload: { teamId: string; userId: string }): Promise<void> {
    if (!this.isReady()) return;
    try {
      const email = await this.getEmail(payload.userId);
      if (!email) return;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) return;
      await this.removeFromGroup(outlineUserId, payload.teamId);
      this.logger.debug(`Removed ${email} from Outline group for team ${payload.teamId}`);
    } catch (e) {
      this.logger.warn(`Team leave sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async handleTeamCreated(payload: { teamId: string; teamName: string }): Promise<void> {
    await this.provisionTeamCollection(payload.teamId, payload.teamName);
  }

  async handleTeamRenamed(payload: { teamId: string; oldName: string; newName: string }): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    const groupId = await this.findGroupIdByExternalId(payload.teamId);
    if (groupId) {
      try {
        await this.callOutlineApi('/groups.update', { id: groupId, name: `Team: ${payload.newName}` });
        this.logger.log(`Renamed Outline group for team ${payload.teamId}: "${payload.oldName}" → "${payload.newName}"`);
      } catch (e) {
        this.logger.warn(`Group rename failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  async handleTeamArchived(payload: { teamId: string; teamName: string }): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    try {
      const groupId = await this.findGroupIdByExternalId(payload.teamId);
      if (!groupId) return;

      // No bulk-remove API; loop through current memberships and remove each.
      const memberships = await this.callOutlineApi('/groups.memberships', { id: groupId, limit: 100 });
      const users = (memberships?.data?.users ?? []) as Array<{ id: string }>;
      for (const u of users) {
        try {
          await this.callOutlineApi('/groups.remove_user', { id: groupId, userId: u.id });
        } catch (e) {
          this.logger.warn(`Failed to remove user ${u.id} from archived team group: ${e instanceof Error ? e.message : e}`);
        }
      }
      this.logger.log(`Team ${payload.teamName} archived — removed ${users.length} members from Outline group`);
    } catch (e) {
      this.logger.warn(`Team archive sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async handleUserAnonymized(payload: { userId: string; emails: string[] }): Promise<void> {
    await this.suspendOutlineUsersByEmail(payload.emails, 'anonymized');
  }

  async handleUserDeleted(payload: { userId: string; emails: string[] }): Promise<void> {
    await this.suspendOutlineUsersByEmail(payload.emails, 'deleted');
  }

  private async suspendOutlineUsersByEmail(emails: string[], reason: string): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey || emails.length === 0) return;
    for (const email of emails) {
      try {
        const outlineUserId = await this.findOutlineUserId(email);
        if (!outlineUserId) continue;
        await this.callOutlineApi('/users.suspend', { id: outlineUserId });
        this.logger.log(`Suspended Outline user ${email} (${reason})`);
      } catch (e) {
        this.logger.warn(`User suspend failed for ${email}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // --- Group primitives ----------------------------------------------------

  private async ensureTeamGroup(teamId: string, teamName: string): Promise<void> {
    if (!this.outlineApiKey) return;
    const existingGroupId = await this.findGroupIdByExternalId(teamId);
    if (existingGroupId) {
      await this.callOutlineApi('/groups.update', { id: existingGroupId, name: `Team: ${teamName}` });
      return;
    }
    await this.callOutlineApi('/groups.create', { name: `Team: ${teamName}`, externalId: teamId });
    this.logger.log(`Created Outline group "Team: ${teamName}"`);
  }

  private async addToGroup(outlineUserId: string, externalGroupId: string): Promise<void> {
    if (!this.outlineApiKey) return;
    const groupId = await this.findGroupIdByExternalId(externalGroupId);
    if (!groupId) return;
    await this.callOutlineApi('/groups.add_user', { id: groupId, userId: outlineUserId });
  }

  private async removeFromGroup(outlineUserId: string, externalGroupId: string): Promise<void> {
    if (!this.outlineApiKey) return;
    const groupId = await this.findGroupIdByExternalId(externalGroupId);
    if (!groupId) return;
    await this.callOutlineApi('/groups.remove_user', { id: groupId, userId: outlineUserId });
  }

  // --- Collection provisioning --------------------------------------------

  /**
   * Mint a fresh Outline API key for this process. Soft-deletes any prior
   * `cleancentive-sync` keys (e.g. left over from a previous run) so there is
   * exactly one live key at any time, and stores the plaintext in memory only.
   *
   * Outline hashes API keys with plain SHA-256 hex (`server/utils/crypto.ts`),
   * so we generate a `ol_api_<38 word chars>` plaintext, insert its hash, and
   * use the plaintext for downstream API calls.
   */
  private async provisionApiKey(): Promise<void> {
    if (!this.isReady()) return;
    const plaintext = `ol_api_${this.randomWordChars(38)}`;
    const hash = createHash('sha256').update(plaintext).digest('hex');
    const last4 = plaintext.slice(-4);

    await this.pg.query(
      `UPDATE "apiKeys" SET "deletedAt" = NOW(), "updatedAt" = NOW()
       WHERE name = $1 AND "deletedAt" IS NULL`,
      [OutlineSyncService.API_KEY_NAME],
    );
    await this.pg.query(
      `INSERT INTO "apiKeys" (id, name, "userId", hash, last4, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [randomUUID(), OutlineSyncService.API_KEY_NAME, this.outlineAdminUserId, hash, last4],
    );
    this.outlineApiKey = plaintext;
    this.logger.log('Provisioned Outline API key for this process');
  }

  /**
   * Subscribe Outline to push events back to Cleancentive. Generates a stable
   * HMAC secret on first run (persisted in `outline_webhook_config`) and
   * reuses it on subsequent runs. Soft-deletes any prior `cleancentive-webhook`
   * subscription rows so exactly one is live at a time.
   */
  private async provisionWebhookSubscription(): Promise<void> {
    if (!this.isReady()) return;

    let config = await this.webhookConfigRepository.findOne({ where: {}, order: { created_at: 'ASC' } });
    if (!config) {
      const secret = randomBytes(32).toString('hex');
      config = await this.webhookConfigRepository.save(this.webhookConfigRepository.create({ secret }));
    }

    const publicUrl = process.env.CLEANCENTIVE_PUBLIC_URL ?? 'https://cleancentive.local';
    const webhookUrl = `${publicUrl}/api/v1/outline-webhooks/incoming`;

    await this.pg.query(
      `UPDATE webhook_subscriptions SET "deletedAt" = NOW(), "updatedAt" = NOW()
       WHERE name = $1 AND "deletedAt" IS NULL`,
      [OutlineSyncService.WEBHOOK_NAME],
    );
    await this.pg.query(
      `INSERT INTO webhook_subscriptions
         (id, "teamId", "createdById", url, enabled, name, events, secret, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, NOW(), NOW())`,
      [
        randomUUID(),
        this.outlineTeamId,
        this.outlineAdminUserId,
        webhookUrl,
        OutlineSyncService.WEBHOOK_NAME,
        OutlineSyncService.WEBHOOK_EVENTS,
        Buffer.from(config.secret, 'utf8'),
      ],
    );
    this.logger.log(`Provisioned Outline webhook subscription → ${webhookUrl}`);
  }

  async wipeOutlineContentOnce(confirmation: string): Promise<{
    confirmation: string;
    outline: Record<string, number>;
    cleancentive: { teamOutlineCollections: number };
  }> {
    if (confirmation !== OutlineSyncService.WIPE_CONFIRMATION) {
      throw new BadRequestException('Confirmation must be WIPE_OUTLINE_CONTENT');
    }
    await this.ensureMaintenanceNotCompleted(OutlineSyncService.WIPE_STATE_KEY, 'Outline content has already been wiped');

    const outline: Record<string, number> = {};
    const mappings = await this.teamCollectionRepository.find();
    const activeTeams = await this.teamRepository.find({ where: { archived_at: IsNull() } });
    const cleancentiveGroupExternalIds = [
      'stewards',
      ...new Set([
        ...mappings.map((mapping) => mapping.team_id),
        ...activeTeams.map((team) => team.id),
      ]),
    ];
    await this.pg.query('BEGIN');
    try {
      const mappingCount = await this.countAndDeleteCleancentiveMappings();
      const cleancentiveGroupIds = await this.findOutlineGroupIdsByExternalIds(cleancentiveGroupExternalIds);

      outline.shares = await this.countAndDeleteIfTableExists('shares', 'shares', `DELETE FROM shares`);
      outline.documentGroupMemberships = await this.countAndDeleteIfTableExists('group_memberships', 'documentGroupMemberships', `DELETE FROM group_memberships WHERE "documentId" IS NOT NULL`);
      outline.collectionGroupMemberships = await this.countAndDeleteIfTableExists('group_memberships', 'collectionGroupMemberships', `DELETE FROM group_memberships WHERE "collectionId" IS NOT NULL OR "groupId" = ANY($1)`, [cleancentiveGroupIds]);
      outline.documentMemberships = await this.countAndDeleteIfTableExists('user_memberships', 'documentMemberships', `DELETE FROM user_memberships WHERE "documentId" IS NOT NULL`);
      outline.collectionMemberships = await this.countAndDeleteIfTableExists('user_memberships', 'collectionMemberships', `DELETE FROM user_memberships WHERE "collectionId" IS NOT NULL`);
      outline.userMemberships = await this.countAndDeleteIfTableExists('user_memberships', 'userMemberships', `DELETE FROM user_memberships`);
      outline.documentAttachments = await this.countAndDeleteIfTableExists('attachments', 'documentAttachments', `DELETE FROM attachments WHERE "documentId" IS NOT NULL`);
      outline.events = await this.countAndDeleteIfTableExists('events', 'events', `DELETE FROM events WHERE "documentId" IS NOT NULL OR "collectionId" IS NOT NULL`);
      outline.comments = await this.countAndDeleteIfTableExists('comments', 'comments', `DELETE FROM comments`);
      outline.revisions = await this.countAndDeleteIfTableExists('revisions', 'revisions', `DELETE FROM revisions`);
      outline.views = await this.countAndDeleteIfTableExists('views', 'views', `DELETE FROM views`);
      outline.stars = await this.countAndDeleteIfTableExists('stars', 'stars', `DELETE FROM stars WHERE "documentId" IS NOT NULL OR "collectionId" IS NOT NULL`);
      outline.pins = await this.countAndDeleteIfTableExists('pins', 'pins', `DELETE FROM pins WHERE "documentId" IS NOT NULL OR "collectionId" IS NOT NULL`);
      outline.relationships = await this.countAndDeleteIfTableExists('relationships', 'relationships', `DELETE FROM relationships`);
      outline.documents = await this.countAndDeleteIfTableExists('documents', 'documents', `DELETE FROM documents`);
      outline.collections = await this.countAndDeleteIfTableExists('collections', 'collections', `DELETE FROM collections`);
      outline.groups = await this.countAndDeleteIfTableExists(
        'groups',
        'groups',
        `DELETE FROM groups WHERE "externalId" = ANY($1) AND "teamId" = $2`,
        [cleancentiveGroupExternalIds, this.outlineTeamId],
      );

      await this.pg.query('COMMIT');
      await this.clearCleancentiveMappingsAfterOutlineCommit();
      await this.recordMaintenanceCompleted(OutlineSyncService.WIPE_STATE_KEY);

      return {
        confirmation,
        outline,
        cleancentive: { teamOutlineCollections: mappingCount },
      };
    } catch (e) {
      await this.pg.query('ROLLBACK');
      throw e;
    }
  }

  async initializeOutlineContentOnce(): Promise<{
    gettingStarted: { created: boolean };
    teams: { created: number; skipped: number };
    stewards: { publicCreated: boolean; confidentialCreated: boolean };
  }> {
    if (!(await this.ensureReady())) {
      throw new BadRequestException('Outline sync is not ready');
    }
    await this.ensureMaintenanceNotCompleted(OutlineSyncService.INIT_STATE_KEY, 'Outline content has already been initialized');

    await this.ensureStewardsGroup();
    await this.syncExistingAdmins();

    const gettingStartedCreated = await this.createSystemCollectionWithStarterDoc({
      name: 'Getting Started',
      permission: 'read_write',
      title: 'Getting started with the CleanCentive wiki',
      text: this.gettingStartedDocText(),
    });

    let created = 0;
    let skipped = 0;
    const activeTeams = await this.teamRepository.find({ where: { archived_at: IsNull(), system_key: IsNull() } });
    for (const team of activeTeams) {
      const existing = await this.teamCollectionRepository.findOne({ where: { team_id: team.id } });
      if (existing) {
        await this.completeMissingInitialShare(existing, true);
        skipped++;
        continue;
      }
      await this.ensureTeamGroup(team.id, team.name);
      const groupId = await this.findGroupIdByExternalId(team.id);
      const collectionId = await this.createCollection({
        name: team.name,
        permission: 'read',
      });
      await this.saveTeamCollectionMapping(team.id, collectionId, groupId, null);
      await this.addGroupToCollection(collectionId, groupId, 'read_write');
      await this.createStarterDoc(collectionId, `Welcome to the ${team.name} wiki`, this.starterDocText(team.name));
      const shareId = await this.createInitialCollectionShare(collectionId);
      await this.updateTeamCollectionMapping(team.id, { outline_share_id: shareId });
      created++;
    }

    const stewardsTeam = await this.teamRepository.findOne({ where: { system_key: 'stewards' } });
    if (stewardsTeam) {
      const existing = await this.teamCollectionRepository.findOne({ where: { team_id: stewardsTeam.id } });
      if (!existing) {
        const stewardsGroupId = await this.findGroupIdByExternalId('stewards');
        const collectionId = await this.createCollection({
          name: 'Stewards',
          permission: 'read',
        });
        await this.saveTeamCollectionMapping(stewardsTeam.id, collectionId, stewardsGroupId, null);
        await this.addGroupToCollection(collectionId, stewardsGroupId, 'admin');
        await this.createStarterDoc(collectionId, 'Welcome to the Stewards wiki', this.starterDocText('Stewards'));
        const shareId = await this.createInitialCollectionShare(collectionId);
        await this.updateTeamCollectionMapping(stewardsTeam.id, { outline_share_id: shareId });
      } else {
        await this.completeMissingInitialShare(existing, true);
      }

      const stewardsGroupId = await this.findGroupIdByExternalId('stewards');
      const confidentialCreated = await this.createSystemCollectionWithStarterDoc({
        name: 'Stewards Confidential',
        permission: null,
        title: 'Stewards Confidential',
        text: this.starterDocText('Stewards Confidential'),
        groupId: stewardsGroupId,
        groupPermission: 'admin',
      });

      const result = {
        gettingStarted: { created: gettingStartedCreated },
        teams: { created, skipped },
        stewards: { publicCreated: !existing, confidentialCreated },
      };
      await this.recordMaintenanceCompleted(OutlineSyncService.INIT_STATE_KEY);
      return result;
    }

    await this.recordMaintenanceCompleted(OutlineSyncService.INIT_STATE_KEY);

    return {
      gettingStarted: { created: gettingStartedCreated },
      teams: { created, skipped },
      stewards: { publicCreated: false, confidentialCreated: false },
    };
  }

  private async countAndDeleteCleancentiveMappings(): Promise<number> {
    const res = await this.countAndDeleteIfTableExists(
      'team_outline_collections',
      'teamOutlineCollections',
      `DELETE FROM team_outline_collections`,
    );
    if (res > 0) return res;
    return this.teamCollectionRepository.count();
  }

  private async ensureMaintenanceNotCompleted(key: string, message: string): Promise<void> {
    const existing = await this.maintenanceStateRepository.findOne({ where: { key } });
    if (existing) {
      throw new BadRequestException(message);
    }
  }

  private async recordMaintenanceCompleted(key: string): Promise<void> {
    await this.maintenanceStateRepository.save(
      this.maintenanceStateRepository.create({ key, completed_at: new Date() }),
    );
  }

  private async clearCleancentiveMappingsAfterOutlineCommit(): Promise<void> {
    await this.teamCollectionRepository.clear();
  }

  private async findOutlineGroupIdsByExternalIds(externalIds: string[]): Promise<string[]> {
    if (externalIds.length === 0) return [];
    const res = await this.pg.query<{ id: string }>(
      `SELECT id FROM groups WHERE "externalId" = ANY($1) AND "teamId" = $2`,
      [externalIds, this.outlineTeamId],
    );
    return res.rows.map((row) => row.id);
  }

  private async countAndDeleteIfTableExists(tableName: string, summaryKey: string, sql: string, params: any[] = []): Promise<number> {
    const table = await this.pg.query<{ exists: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS exists`, [tableName]);
    if (!table.rows[0]?.exists) return 0;
    return this.countAndDelete(summaryKey, sql, params);
  }

  private async countAndDelete(summaryKey: string, sql: string, params: any[] = []): Promise<number> {
    const res = await this.pg.query<{ [key: string]: string | number }>(`WITH deleted AS (${sql} RETURNING 1) SELECT COUNT(*) AS "${summaryKey}" FROM deleted`, params);
    return Number(res.rows[0]?.[summaryKey] ?? 0);
  }

  /** Generate `length` characters from `[A-Za-z0-9_]`, matching Outline's `randomString`. */
  private randomWordChars(length: number): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_';
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  }

  private async callOutlineApi(endpoint: string, body?: any): Promise<any | null> {
    if (!this.outlineApiKey) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.outlineApiUrl}/api${endpoint}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.outlineApiKey}`,
          'Content-Type': 'application/json',
          // Outline runs with FORCE_HTTPS=true on prod and rejects POSTs that
          // appear to be HTTP (returns 405 with "Allow: GET, HEAD"). Inside
          // the docker network we connect via http://outline:3000, so spoof
          // the proto header that Caddy normally adds.
          'X-Forwarded-Proto': 'https',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        throw new Error(`Outline API ${endpoint} returned ${res.status}: ${await res.text()}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async provisionTeamCollection(teamId: string, teamName: string): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;

    const existing = await this.teamCollectionRepository.findOne({ where: { team_id: teamId } });
    if (existing) return;

    try {
      // Ensure the team group exists before attaching it. Groups are otherwise
      // created lazily on first team.member-joined; if we skipped this, the
      // collection would stay admin-only until a non-creator joined.
      await this.ensureTeamGroup(teamId, teamName);
      const groupId = await this.findGroupIdByExternalId(teamId);
      const collectionId = await this.createCollection({
        name: teamName,
        permission: 'read',
      });
      await this.saveTeamCollectionMapping(teamId, collectionId, groupId, null);
      await this.addGroupToCollection(collectionId, groupId, 'read_write');
      await this.createStarterDoc(collectionId, `Welcome to the ${teamName} wiki`, this.starterDocText(teamName));
      const shareId = await this.createInitialCollectionShare(collectionId);
      await this.updateTeamCollectionMapping(teamId, { outline_share_id: shareId });
      this.logger.log(`Provisioned Outline collection for team ${teamName} (${collectionId})`);
    } catch (e) {
      this.logger.warn(`Team collection provisioning failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async provisionTeamCollectionIfMissing(teamId: string, teamName: string): Promise<boolean> {
    const existing = await this.teamCollectionRepository.findOne({ where: { team_id: teamId } });
    if (existing) {
      return false;
    }

    await this.provisionTeamCollection(teamId, teamName);
    return true;
  }

  private async provisionInitialTeamCollection(teamId: string, teamName: string): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    const existing = await this.teamCollectionRepository.findOne({ where: { team_id: teamId } });
    if (existing) return;
    await this.provisionTeamCollection(teamId, teamName);
  }

  private async warnIfMappedCollectionMissing(mapping: TeamOutlineCollection, teamName: string): Promise<boolean> {
    try {
      const info = await this.callOutlineApi('/collections.info', { id: mapping.outline_collection_id });
      if (!info?.data) {
        this.logger.warn(`Outline collection ${mapping.outline_collection_id} for team ${teamName} is gone — not auto-recreating`);
        return true;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404')) {
        this.logger.warn(`Outline collection ${mapping.outline_collection_id} for team ${teamName} is gone — not auto-recreating`);
        return true;
      }
      this.logger.warn(`Reconciliation check failed for team ${teamName}: ${msg}`);
    }
    return false;
  }

  private async createCollectionWithStarterDoc(options: {
    name: string;
    permission: 'read' | 'read_write' | null;
    title: string;
    text: string;
    groupId?: string | null;
    groupPermission?: 'read_write' | 'admin';
  }): Promise<string> {
    const collectionId = await this.createCollection({
      name: options.name,
      permission: options.permission,
    });
    await this.addGroupToCollection(collectionId, options.groupId, options.groupPermission);
    await this.createStarterDoc(collectionId, options.title, options.text);
    return collectionId;
  }

  private async createCollection(options: {
    name: string;
    permission: 'read' | 'read_write' | null;
  }): Promise<string> {
    const created = await this.callOutlineApi('/collections.create', {
      name: options.name,
      permission: options.permission,
    });
    const collectionId = created?.data?.id;
    if (!collectionId) throw new Error(`Collection create returned no id for ${options.name}`);
    return collectionId;
  }

  private async addGroupToCollection(
    collectionId: string,
    groupId: string | null | undefined,
    groupPermission: 'read_write' | 'admin' | undefined,
  ): Promise<void> {
    if (!groupId || !groupPermission) return;
    await this.callOutlineApi('/collections.add_group', {
      id: collectionId,
      groupId,
      permission: groupPermission,
    });
  }

  private async createStarterDoc(collectionId: string, title: string, text: string): Promise<void> {
    await this.callOutlineApi('/documents.create', {
      collectionId,
      title,
      text,
      publish: true,
    });
  }

  private async createSystemCollectionWithStarterDoc(options: {
    name: string;
    permission: 'read' | 'read_write' | null;
    title: string;
    text: string;
    groupId?: string | null;
    groupPermission?: 'read_write' | 'admin';
  }): Promise<boolean> {
    const existing = await this.findCollectionIdByName(options.name);
    if (existing) {
      await this.addGroupToCollection(existing, options.groupId, options.groupPermission);
      await this.createStarterDoc(existing, options.title, options.text);
      return false;
    }
    await this.createCollectionWithStarterDoc(options);
    return true;
  }

  private async findCollectionIdByName(name: string): Promise<string | null> {
    if (!this.outlineTeamId) return null;
    const res = await this.pg.query<{ id: string }>(
      `SELECT id FROM collections WHERE name = $1 AND "teamId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
      [name, this.outlineTeamId],
    );
    return res.rows[0]?.id ?? null;
  }

  private async createInitialCollectionShare(collectionId: string): Promise<string | null> {
    const share = await this.callOutlineApi('/shares.create', { collectionId, published: true });
    return share?.data?.id ?? null;
  }

  private async saveTeamCollectionMapping(
    teamId: string,
    collectionId: string,
    groupId: string | null,
    shareId: string | null,
  ): Promise<void> {
    await this.teamCollectionRepository.save(
      this.teamCollectionRepository.create({
        team_id: teamId,
        outline_collection_id: collectionId,
        outline_group_id: groupId,
        outline_share_id: shareId,
        initialized_at: new Date(),
      }),
    );
  }

  private async updateTeamCollectionMapping(
    teamId: string,
    patch: {
      outline_group_id?: string | null;
      outline_share_id?: string | null;
      outline_confidential_collection_id?: string | null;
    },
  ): Promise<void> {
    await this.teamCollectionRepository.update({ team_id: teamId }, patch);
  }

  private async completeMissingInitialShare(mapping: TeamOutlineCollection, requireInitializerOwnedState = false): Promise<void> {
    if (mapping.outline_share_id) return;
    if (requireInitializerOwnedState && !mapping.initialized_at) return;
    const shareId = await this.createInitialCollectionShare(mapping.outline_collection_id);
    await this.updateTeamCollectionMapping(mapping.team_id, { outline_share_id: shareId });
  }

  private starterDocText(teamName: string): string {
    return [
      `This is the wiki space for **${teamName}**.`,
      '',
      'A few suggestions to get started:',
      '',
      '- Document the spots you cover most often, with notes on access, hazards, and what kind of litter you typically find.',
      '- Capture lessons from past cleanups — what worked, what didn\'t.',
      '- Pin team agreements (meeting cadence, who handles equipment, etc.) so new members can self-onboard.',
      '',
      'Anyone in the team can edit this page.',
    ].join('\n');
  }

  private gettingStartedDocText(): string {
    return [
      'This wiki holds CleanCentive team knowledge, cleanup notes, and Steward documentation.',
      '',
      'Use team collections for operational notes that should stay editable by team members.',
      'Use Steward spaces for platform-level guidance and public documentation.',
    ].join('\n');
  }

  /** Backfill: create Outline collections for teams that don't have one yet. */
  private async backfillTeamCollections(): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    const teams = await this.teamRepository.find({ where: { archived_at: IsNull(), system_key: IsNull() } });
    for (const team of teams) {
      await this.provisionInitialTeamCollection(team.id, team.name);
    }
    await this.backfillStewardsCollections();
  }

  /**
   * The Stewards system team is special: its public collection works like a
   * normal team collection (mapped in team_outline_collections so the team
   * detail page can render a Wiki link), but it ALSO has a private
   * "Stewards Confidential" collection that only the stewards group can see.
   * Both are provisioned here so the bootstrap is self-sufficient — the
   * one-shot initializeOutlineContentOnce admin endpoint is no longer the
   * only place that sets these up.
   */
  private async backfillStewardsCollections(): Promise<void> {
    const stewardsTeam = await this.teamRepository.findOne({ where: { system_key: 'stewards' } });
    if (!stewardsTeam) return;

    const stewardsGroupId = await this.findGroupIdByExternalId('stewards');
    if (!stewardsGroupId) return;

    let mapping = await this.teamCollectionRepository.findOne({ where: { team_id: stewardsTeam.id } });

    // Public Stewards collection — same shape as a normal team mapping so the
    // existing TeamDetail wiki link works without special-casing.
    if (!mapping) {
      const publicCollectionId = await this.createCollection({ name: 'Stewards', permission: 'read' });
      await this.saveTeamCollectionMapping(stewardsTeam.id, publicCollectionId, stewardsGroupId, null);
      await this.addGroupToCollection(publicCollectionId, stewardsGroupId, 'admin');
      await this.createStarterDoc(publicCollectionId, 'Welcome to the Stewards wiki', this.starterDocText('Stewards'));
      const shareId = await this.createInitialCollectionShare(publicCollectionId);
      await this.updateTeamCollectionMapping(stewardsTeam.id, { outline_share_id: shareId });
      mapping = await this.teamCollectionRepository.findOne({ where: { team_id: stewardsTeam.id } });
      this.logger.log(`Provisioned public Stewards collection (${publicCollectionId})`);
    }

    // Confidential Stewards collection — private, only stewards see it.
    // Outline-only (not exposed via TeamDetail), but we persist the id for
    // idempotence so subsequent boots don't re-create it.
    if (!mapping?.outline_confidential_collection_id) {
      const existingId = await this.findCollectionIdByName('Stewards Confidential');
      const confidentialCollectionId = existingId
        ?? (await this.createCollection({ name: 'Stewards Confidential', permission: null }));
      if (!existingId) {
        await this.addGroupToCollection(confidentialCollectionId, stewardsGroupId, 'admin');
        await this.createStarterDoc(confidentialCollectionId, 'Stewards Confidential', this.starterDocText('Stewards Confidential'));
        this.logger.log(`Provisioned confidential Stewards collection (${confidentialCollectionId})`);
      }
      await this.updateTeamCollectionMapping(stewardsTeam.id, {
        outline_confidential_collection_id: confidentialCollectionId,
      });
    }
  }

  /**
   * Backfill avatar URLs for Outline users whose CleanCentive account has a
   * Gravatar email selected. Closes the gap created when avatar-changed events
   * fired before bootstrap had provisioned the API key (the queued event was
   * silently dropped) — affected users would otherwise stay avatar-less until
   * they re-select their Gravatar email.
   */
  private async backfillUserAvatars(): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    const appBaseUrl = (process.env.OIDC_ISSUER_URL ?? 'https://cleancentive.local/api/v1/oidc')
      .replace(/\/api\/v1\/oidc\/?$/, '');
    const users = await this.userService.findUsersWithAvatar();
    let updated = 0;
    for (const user of users) {
      try {
        const outlineRow = await this.pg.query<{ id: string; avatarUrl: string | null }>(
          `SELECT id, "avatarUrl" FROM users WHERE LOWER(email) = LOWER($1) AND "teamId" = $2 LIMIT 1`,
          [user.email, this.outlineTeamId],
        );
        const row = outlineRow.rows[0];
        if (!row) continue;
        const desiredUrl = `${appBaseUrl}/api/v1/user/${user.id}/avatar?v=${user.avatarEmailId}`;
        if (row.avatarUrl === desiredUrl) continue;
        await this.callOutlineApi('/users.update', { id: row.id, avatarUrl: desiredUrl });
        updated++;
      } catch (e) {
        this.logger.warn(`Avatar backfill failed for ${user.email}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (updated > 0) this.logger.log(`Backfilled ${updated} Outline user avatar(s)`);
  }

  // --- Reconciliation -----------------------------------------------------

  /**
   * Drift safety net for the reactive-only sync. Detects mismatches between
   * Cleancentive teams and Outline collections and reconciles where intent is
   * unambiguous; logs warnings where it isn't.
   */
  async reconcileTeamCollections(): Promise<void> {
    if (!(await this.ensureReady())) {
      this.logger.warn('Reconciliation skipped: Outline sync not ready after re-bootstrap');
      return;
    }

    let provisioned = 0, missing = 0, archivedMapped = 0, orphans = 0;

    // 1. Active teams: initialize only teams that have never been mapped.
    const activeTeams = await this.teamRepository.find({ where: { archived_at: IsNull(), system_key: IsNull() } });
    for (const team of activeTeams) {
      const mapping = await this.teamCollectionRepository.findOne({ where: { team_id: team.id } });
      if (!mapping) {
        if (await this.provisionTeamCollectionIfMissing(team.id, team.name)) provisioned++;
        continue;
      }
      if (await this.warnIfMappedCollectionMissing(mapping, team.name)) missing++;
    }

    // 2. Archived teams with mappings: leave historical collection permissions intact.
    const archivedTeams = await this.teamRepository.find({ where: { archived_at: Not(IsNull()), system_key: IsNull() } });
    for (const team of archivedTeams) {
      const mapping = await this.teamCollectionRepository.findOne({ where: { team_id: team.id } });
      if (!mapping) continue;
      archivedMapped++;
    }

    // 3. Mapping rows whose team is gone entirely.
    const mappings = await this.teamCollectionRepository.find();
    for (const m of mappings) {
      const team = await this.teamRepository.findOne({ where: { id: m.team_id } });
      if (!team) {
        this.logger.warn(`Orphan team_outline_collections row for team_id=${m.team_id} (team deleted)`);
        orphans++;
      }
    }

    // 4. Stewards system team — separate provisioning path because it has
    // an extra confidential collection and uses the existing 'stewards' group
    // rather than a per-team group.
    await this.backfillStewardsCollections();

    this.logger.log(
      `Reconciliation finished: ${provisioned} provisioned, ${missing} missing-collection warnings, ${archivedMapped} archived mapped teams left unchanged, ${orphans} orphan mappings`,
    );
  }
}
