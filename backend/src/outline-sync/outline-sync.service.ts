import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { UserService } from '../user/user.service';
import { AdminService } from '../admin/admin.service';

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
  private outlineTeamId: string | null = null;
  private outlineAdminUserId: string | null = null;

  constructor(
    private readonly userService: UserService,
    private readonly adminService: AdminService,
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
    try {
      await this.pg.connect();
      await this.cacheOutlineTeamAndAdmin();
      await this.ensureStewardsGroup();
      await this.syncExistingAdmins();
    } catch (e) {
      this.logger.warn(`Outline sync disabled (${e instanceof Error ? e.message : e}). Wiki integration will not sync until the outline DB is reachable.`);
    }
  }

  async onModuleDestroy() {
    await this.pg.end().catch(() => {});
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
    if (!this.outlineTeamId || !this.outlineAdminUserId) return;
    const existing = await this.pg.query(
      `SELECT id FROM groups WHERE "externalId" = 'stewards' AND "teamId" = $1`,
      [this.outlineTeamId],
    );
    if (existing.rows.length > 0) return;
    await this.pg.query(
      `INSERT INTO groups (id, name, "teamId", "createdById", "externalId", "createdAt", "updatedAt")
       VALUES ($1, 'Stewards', $2, $3, 'stewards', NOW(), NOW())`,
      [randomUUID(), this.outlineTeamId, this.outlineAdminUserId],
    );
    this.logger.log('Created "Stewards" group in Outline.');
  }

  /** Backfill: ensure all current cleancentive admins are in the Stewards group + have Outline admin role. */
  private async syncExistingAdmins(): Promise<void> {
    if (!this.isReady()) return;
    const adminUserIds = await this.adminService.getAdminUserIds();
    for (const userId of adminUserIds) {
      const email = await this.getEmail(userId);
      if (!email) continue;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) continue;
      // Ensure admin role
      await this.pg.query(
        `UPDATE users SET role = 'admin', "updatedAt" = NOW() WHERE id = $1 AND role != 'admin'`,
        [outlineUserId],
      );
      // Ensure Stewards group membership
      await this.addToGroup(outlineUserId, 'stewards');
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

  private isReady(): boolean {
    return this.outlineTeamId !== null && this.outlineAdminUserId !== null;
  }

  // --- Event Handlers ------------------------------------------------------

  @OnEvent('user.profile-changed')
  async handleProfileChanged(payload: { userId: string }): Promise<void> {
    if (!this.isReady()) return;
    try {
      const user = await this.userService.findById(payload.userId);
      if (!user) return;
      const email = user.emails?.[0]?.email;
      if (!email) return;
      const displayName =
        (user.full_name?.trim()) ||
        (user.nickname && user.nickname !== 'guest' ? user.nickname : null) ||
        email.split('@')[0];
      await this.pg.query(
        `UPDATE users SET name = $1, "updatedAt" = NOW() WHERE LOWER(email) = LOWER($2) AND "teamId" = $3`,
        [displayName, email, this.outlineTeamId],
      );
      this.logger.debug(`Synced display name for ${email} → ${displayName}`);
    } catch (e) {
      this.logger.warn(`Profile sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  @OnEvent('user.avatar-changed')
  async handleAvatarChanged(payload: { userId: string; avatarEmailId: string | null }): Promise<void> {
    if (!this.isReady()) return;
    try {
      const email = await this.getEmail(payload.userId);
      if (!email) return;
      const appBaseUrl = (process.env.OIDC_ISSUER_URL ?? 'https://cleancentive.local/api/v1/oidc')
        .replace(/\/api\/v1\/oidc\/?$/, '');
      const avatarUrl = payload.avatarEmailId
        ? `${appBaseUrl}/api/v1/user/${payload.userId}/avatar?v=${payload.avatarEmailId}`
        : null;
      await this.pg.query(
        `UPDATE users SET "avatarUrl" = $1, "updatedAt" = NOW() WHERE LOWER(email) = LOWER($2) AND "teamId" = $3`,
        [avatarUrl, email, this.outlineTeamId],
      );
      this.logger.debug(`Synced avatar for ${email}`);
    } catch (e) {
      this.logger.warn(`Avatar sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  @OnEvent('admin.promoted')
  async handleAdminPromoted(payload: { userId: string }): Promise<void> {
    if (!this.isReady()) return;
    try {
      const email = await this.getEmail(payload.userId);
      if (!email) return;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) return;
      await this.pg.query(
        `UPDATE users SET role = 'admin', "updatedAt" = NOW() WHERE id = $1`,
        [outlineUserId],
      );
      await this.addToGroup(outlineUserId, 'stewards');
      this.logger.log(`Promoted ${email} to Outline admin + Stewards group`);
    } catch (e) {
      this.logger.warn(`Admin promotion sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  @OnEvent('admin.demoted')
  async handleAdminDemoted(payload: { userId: string }): Promise<void> {
    if (!this.isReady()) return;
    try {
      const email = await this.getEmail(payload.userId);
      if (!email) return;
      const outlineUserId = await this.findOutlineUserId(email);
      if (!outlineUserId) return;
      await this.pg.query(
        `UPDATE users SET role = 'member', "updatedAt" = NOW() WHERE id = $1`,
        [outlineUserId],
      );
      await this.removeFromGroup(outlineUserId, 'stewards');
      this.logger.log(`Demoted ${email} from Outline admin`);
    } catch (e) {
      this.logger.warn(`Admin demotion sync failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  @OnEvent('team.member-joined')
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

  @OnEvent('team.member-left')
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

  // --- Group primitives ----------------------------------------------------

  private async ensureTeamGroup(teamId: string, teamName: string): Promise<void> {
    const existing = await this.pg.query(
      `SELECT id FROM groups WHERE "externalId" = $1 AND "teamId" = $2`,
      [teamId, this.outlineTeamId],
    );
    if (existing.rows.length > 0) {
      // Update name if it changed
      await this.pg.query(
        `UPDATE groups SET name = $1, "updatedAt" = NOW() WHERE "externalId" = $2 AND "teamId" = $3`,
        [`Team: ${teamName}`, teamId, this.outlineTeamId],
      );
      return;
    }
    await this.pg.query(
      `INSERT INTO groups (id, name, "teamId", "createdById", "externalId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [randomUUID(), `Team: ${teamName}`, this.outlineTeamId, this.outlineAdminUserId, teamId],
    );
    this.logger.log(`Created Outline group "Team: ${teamName}"`);
  }

  private async addToGroup(outlineUserId: string, externalGroupId: string): Promise<void> {
    const group = await this.pg.query<{ id: string }>(
      `SELECT id FROM groups WHERE "externalId" = $1 AND "teamId" = $2`,
      [externalGroupId, this.outlineTeamId],
    );
    if (!group.rows[0]) return;
    await this.pg.query(
      `INSERT INTO group_users ("userId", "groupId", "createdById", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT ("userId", "groupId") DO NOTHING`,
      [outlineUserId, group.rows[0].id, this.outlineAdminUserId],
    );
  }

  private async removeFromGroup(outlineUserId: string, externalGroupId: string): Promise<void> {
    const group = await this.pg.query<{ id: string }>(
      `SELECT id FROM groups WHERE "externalId" = $1 AND "teamId" = $2`,
      [externalGroupId, this.outlineTeamId],
    );
    if (!group.rows[0]) return;
    await this.pg.query(
      `DELETE FROM group_users WHERE "userId" = $1 AND "groupId" = $2`,
      [outlineUserId, group.rows[0].id],
    );
  }
}
