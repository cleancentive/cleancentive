import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
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
  constructor(
    private readonly userService: UserService,
    private readonly adminService: AdminService,
    @InjectRepository(Team) private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamOutlineCollection)
    private readonly teamCollectionRepository: Repository<TeamOutlineCollection>,
    @InjectRepository(OutlineWebhookConfig)
    private readonly webhookConfigRepository: Repository<OutlineWebhookConfig>,
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
    try {
      await this.ensureWikiBucket();
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

    const teams = await this.pg.query<{ avatarUrl: string | null }>(
      `SELECT "avatarUrl" FROM teams WHERE id = $1 LIMIT 1`,
      [this.outlineTeamId],
    );
    const team = teams.rows[0];
    if (team && team.avatarUrl !== this.outlineTeamLogoUrl) {
      await this.pg.query(`UPDATE teams SET "avatarUrl" = $1, "updatedAt" = NOW() WHERE id = $2`, [
        this.outlineTeamLogoUrl,
        this.outlineTeamId,
      ]);
    }

    const websiteId = await this.getOrCreateUmamiWikiWebsite();
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

  private isReady(): boolean {
    return this.outlineTeamId !== null && this.outlineAdminUserId !== null;
  }

  // --- Event Handlers ------------------------------------------------------

  async processEvent(eventName: string, payload: unknown): Promise<void> {
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
      await this.ensureTeamGroup(payload.teamId, payload.teamName);
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

    const mapping = await this.teamCollectionRepository.findOne({ where: { team_id: payload.teamId } });
    if (mapping) {
      try {
        await this.callOutlineApi('/collections.update', {
          id: mapping.outline_collection_id,
          name: payload.newName,
        });
        this.logger.log(`Renamed Outline collection for team ${payload.teamId}: "${payload.oldName}" → "${payload.newName}"`);
      } catch (e) {
        this.logger.warn(`Collection rename failed: ${e instanceof Error ? e.message : e}`);
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

      const mapping = await this.teamCollectionRepository.findOne({ where: { team_id: payload.teamId } });
      if (mapping) {
        try {
          await this.callOutlineApi('/collections.remove_group', {
            id: mapping.outline_collection_id,
            groupId,
          });
          this.logger.log(`Revoked team group access on Outline collection for archived team ${payload.teamName}`);
        } catch (e) {
          this.logger.warn(`Collection group removal failed: ${e instanceof Error ? e.message : e}`);
        }
      }
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
      const created = await this.callOutlineApi('/collections.create', {
        name: teamName,
        permission: null, // private — access granted only via group
      });
      const collectionId = created?.data?.id;
      if (!collectionId) {
        this.logger.warn(`Collection create returned no id for team ${teamName}`);
        return;
      }

      // Ensure the team group exists before attaching it. Groups are otherwise
      // created lazily on first team.member-joined; if we skipped this, the
      // collection would stay admin-only until a non-creator joined.
      await this.ensureTeamGroup(teamId, teamName);
      const groupId = await this.findGroupIdByExternalId(teamId);
      if (groupId) {
        try {
          await this.callOutlineApi('/collections.add_group', {
            id: collectionId,
            groupId,
            permission: 'read_write',
          });
        } catch (e) {
          this.logger.warn(`Failed to grant team group access to new collection: ${e instanceof Error ? e.message : e}`);
        }
      }

      await this.teamCollectionRepository.save(
        this.teamCollectionRepository.create({ team_id: teamId, outline_collection_id: collectionId }),
      );

      // Seed a starter document so the collection is non-empty on first visit.
      // Failure is non-fatal — users can still write content themselves.
      try {
        await this.callOutlineApi('/documents.create', {
          collectionId,
          title: `Welcome to the ${teamName} wiki`,
          text: this.starterDocText(teamName),
          publish: true,
        });
      } catch (e) {
        this.logger.warn(`Seed doc create failed for team ${teamName}: ${e instanceof Error ? e.message : e}`);
      }

      this.logger.log(`Provisioned Outline collection for team ${teamName} (${collectionId})`);
    } catch (e) {
      this.logger.warn(`Team collection provisioning failed: ${e instanceof Error ? e.message : e}`);
    }
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

  /** Backfill: create Outline collections for teams that don't have one yet. */
  private async backfillTeamCollections(): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) return;
    const teams = await this.teamRepository.find({ where: { archived_at: IsNull() } });
    for (const team of teams) {
      await this.provisionTeamCollection(team.id, team.name);
    }
  }

  // --- Reconciliation -----------------------------------------------------

  /**
   * Drift safety net for the reactive-only sync. Detects mismatches between
   * Cleancentive teams and Outline collections and reconciles where intent is
   * unambiguous; logs warnings where it isn't.
   */
  async reconcileTeamCollections(): Promise<void> {
    if (!this.isReady() || !this.outlineApiKey) {
      this.logger.warn('Reconciliation skipped: Outline sync not ready');
      return;
    }

    let provisioned = 0, renamed = 0, missing = 0, archivedRevoked = 0, orphans = 0;

    // 1. Active teams: ensure mapping exists and Outline collection matches.
    const activeTeams = await this.teamRepository.find({ where: { archived_at: IsNull() } });
    for (const team of activeTeams) {
      const mapping = await this.teamCollectionRepository.findOne({ where: { team_id: team.id } });
      if (!mapping) {
        await this.provisionTeamCollection(team.id, team.name);
        provisioned++;
        continue;
      }
      try {
        const info = await this.callOutlineApi('/collections.info', { id: mapping.outline_collection_id });
        const remote = info?.data;
        if (!remote) continue;
        if (remote.name !== team.name) {
          await this.callOutlineApi('/collections.update', { id: mapping.outline_collection_id, name: team.name });
          renamed++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('404')) {
          this.logger.warn(`Outline collection ${mapping.outline_collection_id} for team ${team.name} is gone — not auto-recreating`);
          missing++;
        } else {
          this.logger.warn(`Reconciliation check failed for team ${team.name}: ${msg}`);
        }
      }
    }

    // 2. Archived teams with mappings: ensure team group is detached from collection.
    const archivedTeams = await this.teamRepository.find({ where: { archived_at: Not(IsNull()) } });
    for (const team of archivedTeams) {
      const mapping = await this.teamCollectionRepository.findOne({ where: { team_id: team.id } });
      if (!mapping) continue;
      const groupId = await this.findGroupIdByExternalId(team.id);
      if (!groupId) continue;
      try {
        // collections.remove_group is idempotent — calling on an already-removed
        // group returns an error we can ignore. Cheaper than a list+diff.
        await this.callOutlineApi('/collections.remove_group', {
          id: mapping.outline_collection_id,
          groupId,
        });
        archivedRevoked++;
      } catch {
        // Already detached or collection missing — fine.
      }
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

    this.logger.log(
      `Reconciliation finished: ${provisioned} provisioned, ${renamed} renamed, ${missing} missing-collection warnings, ${archivedRevoked} archived-team revocations, ${orphans} orphan mappings`,
    );
  }
}
