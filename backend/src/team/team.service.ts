import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository, In } from 'typeorm';
import { Team } from './team.entity';
import { TeamMembership } from './team-membership.entity';
import { TeamMessage } from './team-message.entity';
import { TeamEmailPattern } from './team-email-pattern.entity';
import { User } from '../user/user.entity';
import { AdminService } from '../admin/admin.service';
import { UserEmail } from '../user/user-email.entity';
import { EmailService } from '../email/email.service';

interface SearchTeamsInput {
  query?: string;
  includeArchived?: boolean;
  memberOnly?: boolean;
  currentUserIsPlatformAdmin: boolean;
  userId?: string;
}

interface CreateTeamInput {
  name: string;
  description: string;
}

interface CreateTeamMessageInput {
  teamId: string;
  authorUserId: string;
  audience: 'members' | 'organizers';
  subject: string;
  body: string;
}

const REGEX_INDICATORS = /[*+\\()^$\[]/;

function isRegexPattern(pattern: string): boolean {
  if (REGEX_INDICATORS.test(pattern)) return true;
  // '|' with an '@' somewhere signals regex (e.g. "google.com|user@gmail.com")
  if (pattern.includes('|') && pattern.includes('@')) return true;
  return false;
}

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMembership)
    private readonly teamMembershipRepository: Repository<TeamMembership>,
    @InjectRepository(TeamMessage)
    private readonly teamMessageRepository: Repository<TeamMessage>,
    @InjectRepository(TeamEmailPattern)
    private readonly teamEmailPatternRepository: Repository<TeamEmailPattern>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserEmail)
    private readonly userEmailRepository: Repository<UserEmail>,
    private readonly adminService: AdminService,
    private readonly emailService: EmailService,
  ) {}

  normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private async getTeamOrThrow(teamId: string): Promise<Team> {
    const team = await this.teamRepository.findOne({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  private async getMembership(teamId: string, userId: string): Promise<TeamMembership | null> {
    return this.teamMembershipRepository.findOne({ where: { team_id: teamId, user_id: userId } });
  }

  private async getMembershipOrThrow(teamId: string, userId: string): Promise<TeamMembership> {
    const membership = await this.getMembership(teamId, userId);
    if (!membership) {
      throw new ForbiddenException('You are not a member of this team');
    }
    return membership;
  }

  private async ensureTeamNotArchived(team: Team): Promise<void> {
    if (team.archived_at) {
      throw new BadRequestException('Team is archived');
    }
  }

  private async ensureOrganizer(teamId: string, userId: string): Promise<TeamMembership> {
    const membership = await this.getMembershipOrThrow(teamId, userId);
    if (membership.role !== 'organizer') {
      throw new ForbiddenException('Team organizer permissions required');
    }
    return membership;
  }

  private async ensureRegisteredUser(userId: string): Promise<void> {
    const emailCount = await this.userEmailRepository.count({ where: { user_id: userId } });
    if (emailCount === 0) {
      throw new ForbiddenException('Community features require a registered account');
    }
  }

  async searchTeams(input: SearchTeamsInput): Promise<Array<{ team: Team; userRole: string | null; isPartner: boolean }>> {
    const qb = this.teamRepository.createQueryBuilder('team').orderBy('team.created_at', 'DESC');
    if (input.query?.trim()) {
      const query = `%${input.query.trim()}%`;
      qb.where('(team.name ILIKE :query OR team.description ILIKE :query)', { query });
    }

    if (input.includeArchived) {
      if (!input.currentUserIsPlatformAdmin) {
        throw new ForbiddenException('Only stewards can include archived teams');
      }
    } else {
      qb.andWhere('team.archived_at IS NULL');
    }

    const teams = await qb.getMany();
    if (teams.length === 0) return [];

    const teamIds = teams.map((t) => t.id);

    let membershipMap = new Map<string, string>();
    if (input.userId) {
      const memberships = await this.teamMembershipRepository.find({
        where: { user_id: input.userId, team_id: In(teamIds) },
      });
      membershipMap = new Map(memberships.map((m) => [m.team_id, m.role]));
    }

    // Determine which teams are partner teams (have email patterns)
    const partnerPatterns = await this.teamEmailPatternRepository
      .createQueryBuilder('p')
      .select('DISTINCT p.team_id', 'team_id')
      .where('p.team_id IN (:...teamIds)', { teamIds })
      .getRawMany();
    const partnerTeamIds = new Set(partnerPatterns.map((r) => r.team_id));

    const results = teams.map((team) => ({
      team,
      userRole: membershipMap.get(team.id) || null,
      isPartner: partnerTeamIds.has(team.id),
    }));

    if (input.memberOnly) {
      return results.filter((r) => r.userRole !== null);
    }

    return results;
  }

  async createTeam(userId: string, input: CreateTeamInput): Promise<Team> {
    await this.ensureRegisteredUser(userId);
    const trimmedName = input.name?.trim();
    const trimmedDescription = input.description?.trim();
    if (!trimmedName) {
      throw new BadRequestException('name is required');
    }
    const nameNormalized = this.normalizeName(trimmedName);
    const existing = await this.teamRepository.findOne({ where: { name_normalized: nameNormalized } });
    if (existing) {
      throw new BadRequestException('Team name already exists');
    }

    const team = this.teamRepository.create({
      name: trimmedName,
      name_normalized: nameNormalized,
      description: trimmedDescription || '',
      archived_at: null,
      archived_by: null,
    });
    const savedTeam = await this.teamRepository.save(team);

    const membership = this.teamMembershipRepository.create({
      team_id: savedTeam.id,
      user_id: userId,
      role: 'organizer',
    });
    await this.teamMembershipRepository.save(membership);

    await this.userRepository.update({ id: userId }, { active_team_id: savedTeam.id, updated_by: userId });
    return savedTeam;
  }

  async getTeam(teamId: string): Promise<Team> {
    const team = await this.getTeamOrThrow(teamId);
    if (team.archived_at) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  async getTeamDetail(teamId: string, userId?: string, isPlatformAdmin?: boolean): Promise<{
    team: Team;
    members: Array<{ userId: string; nickname: string; role: string; avatarEmailId: string | null }>;
    userRole: string | null;
    isPartner: boolean;
    emailPatterns?: Array<{ id: string; email_pattern: string }>;
  }> {
    const team = await this.getTeam(teamId);

    const memberships = await this.teamMembershipRepository.find({
      where: { team_id: teamId },
      order: { created_at: 'ASC' },
    });

    const userIds = memberships.map((m) => m.user_id);
    const users = userIds.length > 0
      ? await this.userRepository.find({ where: { id: In(userIds) } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const members = memberships.map((m) => {
      const u = userMap.get(m.user_id);
      return {
        userId: m.user_id,
        nickname: u?.nickname || 'Unknown',
        role: m.role,
        avatarEmailId: u?.avatar_email_id || null,
      };
    });

    let userRole: string | null = null;
    if (userId) {
      const membership = memberships.find((m) => m.user_id === userId);
      userRole = membership?.role || null;
    }

    const isPartner = await this.isPartnerTeam(teamId);

    const result: any = { team, members, userRole, isPartner };

    // Only expose email patterns and custom_css to platform admins
    if (isPlatformAdmin && isPartner) {
      const patterns = await this.getEmailPatterns(teamId);
      result.emailPatterns = patterns.map((p) => ({ id: p.id, email_pattern: p.email_pattern }));
    }

    return result;
  }

  async updateTeam(teamId: string, actorUserId: string, input: { name?: string; description?: string }): Promise<Team> {
    await this.ensureRegisteredUser(actorUserId);
    const team = await this.getTeamOrThrow(teamId);
    await this.ensureTeamNotArchived(team);
    await this.ensureOrganizer(teamId, actorUserId);

    if (input.name !== undefined) {
      const trimmedName = input.name.trim();
      if (!trimmedName) throw new BadRequestException('name is required');
      const nameNormalized = this.normalizeName(trimmedName);
      const existing = await this.teamRepository.findOne({ where: { name_normalized: nameNormalized } });
      if (existing && existing.id !== teamId) throw new BadRequestException('Team name already exists');
      team.name = trimmedName;
      team.name_normalized = nameNormalized;
    }
    if (input.description !== undefined) {
      team.description = input.description.trim();
    }

    return this.teamRepository.save(team);
  }

  async joinTeam(teamId: string, userId: string): Promise<{ joined: boolean }> {
    await this.ensureRegisteredUser(userId);
    const team = await this.getTeamOrThrow(teamId);
    await this.ensureTeamNotArchived(team);

    if (await this.isPartnerTeam(teamId)) {
      throw new BadRequestException('Partner teams are managed automatically based on email domains');
    }

    const existing = await this.getMembership(teamId, userId);
    if (existing) {
      return { joined: false };
    }

    const membership = this.teamMembershipRepository.create({
      team_id: teamId,
      user_id: userId,
      role: 'member',
    });
    await this.teamMembershipRepository.save(membership);
    return { joined: true };
  }

  async leaveTeam(teamId: string, userId: string): Promise<{ left: boolean }> {
    await this.ensureRegisteredUser(userId);

    if (await this.isPartnerTeam(teamId)) {
      throw new BadRequestException('Partner teams are managed automatically based on email domains');
    }

    const membership = await this.getMembership(teamId, userId);
    if (!membership) {
      return { left: false };
    }

    if (membership.role === 'organizer') {
      const remainingOrganizerCount = await this.teamMembershipRepository.count({
        where: { team_id: teamId, role: 'organizer' },
      });

      if (remainingOrganizerCount <= 1) {
        await this.promoteStewards(teamId, userId);
      }
    }

    await this.teamMembershipRepository.delete({ id: membership.id });
    await this.userRepository.update({ id: userId, active_team_id: teamId }, { active_team_id: null, updated_by: userId });
    return { left: true };
  }

  private async promoteStewards(teamId: string, leavingUserId: string): Promise<void> {
    const allStewardIds = await this.adminService.getAdminUserIds();
    const stewardIds = allStewardIds.filter((id) => id !== leavingUserId);
    if (stewardIds.length === 0) {
      throw new BadRequestException('Cannot leave team because no stewards are available for fallback promotion');
    }

    const existingMemberships = await this.teamMembershipRepository.find({
      where: {
        team_id: teamId,
        user_id: In(stewardIds),
      },
    });

    const membershipByUserId = new Map(existingMemberships.map((membership) => [membership.user_id, membership]));

    for (const stewardUserId of stewardIds) {
      const existingMembership = membershipByUserId.get(stewardUserId);
      if (!existingMembership) {
        const membership = this.teamMembershipRepository.create({
          team_id: teamId,
          user_id: stewardUserId,
          role: 'organizer',
        });
        await this.teamMembershipRepository.save(membership);
        continue;
      }

      if (existingMembership.role !== 'organizer') {
        existingMembership.role = 'organizer';
        await this.teamMembershipRepository.save(existingMembership);
      }
    }
  }

  async activateTeam(teamId: string, userId: string): Promise<{ activeTeamId: string }> {
    await this.ensureRegisteredUser(userId);
    const team = await this.getTeamOrThrow(teamId);
    await this.ensureTeamNotArchived(team);
    await this.getMembershipOrThrow(teamId, userId);
    await this.userRepository.update({ id: userId }, { active_team_id: teamId, updated_by: userId });
    return { activeTeamId: teamId };
  }

  async deactivateTeam(userId: string): Promise<void> {
    await this.userRepository.update({ id: userId }, { active_team_id: null, updated_by: userId });
  }

  async resolveActiveTeamForUser(userId: string): Promise<Team | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user?.active_team_id) {
      return null;
    }

    const membership = await this.teamMembershipRepository.findOne({
      where: { team_id: user.active_team_id, user_id: userId },
      relations: ['team'],
    });

    if (!membership || membership.team.archived_at) {
      await this.userRepository.update({ id: userId }, { active_team_id: null, updated_by: userId });
      return null;
    }

    return membership.team;
  }

  async promoteMember(teamId: string, targetUserId: string, actorUserId: string): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    const team = await this.getTeamOrThrow(teamId);
    await this.ensureTeamNotArchived(team);
    await this.ensureOrganizer(teamId, actorUserId);

    const membership = await this.getMembership(teamId, targetUserId);
    if (!membership) {
      throw new NotFoundException('Target user is not a team member');
    }

    if (membership.role === 'organizer') {
      return;
    }

    membership.role = 'organizer';
    await this.teamMembershipRepository.save(membership);
  }

  async archiveTeam(teamId: string, actorUserId: string): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    const team = await this.getTeamOrThrow(teamId);
    await this.ensureOrganizer(teamId, actorUserId);
    if (team.archived_at) {
      return;
    }
    team.archived_at = new Date();
    team.archived_by = actorUserId;
    await this.teamRepository.save(team);

    await this.userRepository.update({ active_team_id: teamId }, { active_team_id: null, updated_by: actorUserId });
  }

  async listMessages(teamId: string, userId: string): Promise<Array<TeamMessage & { author?: { nickname: string; avatarEmailId: string | null } }>> {
    await this.ensureRegisteredUser(userId);
    const membership = await this.getMembership(teamId, userId);
    if (!membership) {
      const isPlatformAdmin = await this.adminService.isAdmin(userId);
      if (!isPlatformAdmin) {
        throw new ForbiddenException('You are not allowed to view team messages');
      }
    }
    const messages = await this.teamMessageRepository.find({
      where: { team_id: teamId },
      order: { created_at: 'DESC' },
      take: 100,
    });

    const authorIds = [...new Set(messages.map((m) => m.author_user_id))];
    const authors = authorIds.length > 0
      ? await this.userRepository.find({ where: { id: In(authorIds) } })
      : [];
    const authorMap = new Map(authors.map((a) => [a.id, a]));

    return messages.map((m) => {
      const author = authorMap.get(m.author_user_id);
      return Object.assign(m, {
        author: author
          ? { nickname: author.nickname, avatarEmailId: author.avatar_email_id }
          : undefined,
      });
    });
  }

  async createMessage(input: CreateTeamMessageInput): Promise<TeamMessage> {
    await this.ensureRegisteredUser(input.authorUserId);
    const team = await this.getTeamOrThrow(input.teamId);
    await this.ensureTeamNotArchived(team);
    const membership = await this.getMembershipOrThrow(input.teamId, input.authorUserId);

    const subject = input.subject?.trim();
    const body = input.body?.trim();
    if (!subject) {
      throw new BadRequestException('subject is required');
    }
    if (!body) {
      throw new BadRequestException('body is required');
    }

    if (membership.role !== 'organizer' && input.audience !== 'organizers') {
      throw new ForbiddenException('Team members can only message team organizers');
    }

    const message = this.teamMessageRepository.create({
      team_id: input.teamId,
      author_user_id: input.authorUserId,
      audience: input.audience,
      subject,
      body,
    });
    const saved = await this.teamMessageRepository.save(message);

    await this.sendTeamMessageEmailFanout(team.name, saved, input.authorUserId);
    return saved;
  }

  // ── Partner Team (email pattern) methods ──

  async isPartnerTeam(teamId: string): Promise<boolean> {
    const count = await this.teamEmailPatternRepository.count({ where: { team_id: teamId } });
    return count > 0;
  }

  async getEmailPatterns(teamId: string): Promise<TeamEmailPattern[]> {
    return this.teamEmailPatternRepository.find({ where: { team_id: teamId }, order: { created_at: 'ASC' } });
  }

  async setEmailPatterns(teamId: string, patterns: string[]): Promise<TeamEmailPattern[]> {
    await this.getTeamOrThrow(teamId);

    // Replace all patterns for this team
    await this.teamEmailPatternRepository.delete({ team_id: teamId });

    const entities: TeamEmailPattern[] = [];
    for (const raw of patterns) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const entity = this.teamEmailPatternRepository.create({
        team_id: teamId,
        email_pattern: trimmed,
      });
      entities.push(await this.teamEmailPatternRepository.save(entity));
    }

    await this.reconcileTeamMemberships(teamId);
    return entities;
  }

  async updateCustomCss(teamId: string, customCss: string | null): Promise<Team> {
    const team = await this.getTeamOrThrow(teamId);
    team.custom_css = customCss || null;
    return this.teamRepository.save(team);
  }

  async importPartnerFromUrl(url: string): Promise<{
    domain: string;
    favicon_url: string | null;
    colors: { primary: string | null; accent: string | null };
    name: string | null;
    description: string | null;
  }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('URL must be HTTP or HTTPS');
    }

    let html: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CleanCentive/1.0)' },
        redirect: 'follow',
      });
      clearTimeout(timeout);
      html = await res.text();
    } catch (err: any) {
      throw new BadRequestException(`Failed to fetch URL: ${err.message}`);
    }

    const domain = parsed.hostname.replace(/^www\./, '');
    const origin = parsed.origin;

    // Extract name and description from HTML meta
    const name = this.extractSiteName(html, domain);
    const description = this.extractSiteDescription(html);

    // Extract favicon
    const favicon_url = this.extractFavicon(html, origin);

    // Extract colors — try meta tags, manifest, CSS custom properties, inline style hex
    const colors = await this.extractColors(html, origin);

    return { domain, favicon_url, colors, name, description };
  }

  private extractFavicon(html: string, origin: string): string | null {
    // Priority: rel="icon", rel="shortcut icon", rel="apple-touch-icon"
    const patterns = [
      /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i,
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i,
      /<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i,
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon["']/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return this.resolveUrl(match[1], origin);
      }
    }
    return `${origin}/favicon.ico`;
  }

  private async extractColors(html: string, origin: string): Promise<{ primary: string | null; accent: string | null }> {
    let primary: string | null = null;
    let accent: string | null = null;

    // 1. Check meta theme-color
    const themeColor = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']theme-color["']/i);
    if (themeColor?.[1] && !this.isNeutralColor(themeColor[1])) {
      primary = themeColor[1];
    }

    // 2. Check msapplication-TileColor
    const tileColor = html.match(/<meta[^>]*name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']msapplication-TileColor["']/i);
    if (tileColor?.[1] && !this.isNeutralColor(tileColor[1])) {
      accent = tileColor[1];
    }

    // 3. Try web app manifest for theme_color / background_color
    if (!primary || !accent) {
      const manifestColors = await this.extractColorsFromManifest(html, origin);
      if (!primary && manifestColors.primary) primary = manifestColors.primary;
      if (!accent && manifestColors.accent) accent = manifestColors.accent;
    }

    // 4. Look for CSS custom properties with "primary" or "brand" in linked stylesheets and inline styles
    if (!primary || !accent) {
      const cssColors = await this.extractColorsFromCss(html, origin);
      if (!primary && cssColors.primary) primary = cssColors.primary;
      if (!accent && cssColors.accent) accent = cssColors.accent;
    }

    // 5. Fall back to most common non-neutral hex colors in inline <style> blocks
    if (!primary) {
      const inlineStyles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
        .map(m => m[1]).join('\n');
      const hexColors = [...inlineStyles.matchAll(/#[0-9a-fA-F]{6}/g)]
        .map(m => m[0].toLowerCase())
        .filter(c => !this.isNeutralColor(c));
      const freq = new Map<string, number>();
      for (const c of hexColors) freq.set(c, (freq.get(c) || 0) + 1);
      const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
      if (sorted[0]) primary = sorted[0][0];
      if (sorted[1]) accent = accent || sorted[1][0];
    }

    // 6. Neutral fallback — distinct from CleanCentive primary blue, good contrast on white
    if (!primary) primary = '#374151'; // gray-700

    return { primary, accent };
  }

  private async extractColorsFromCss(html: string, origin: string): Promise<{ primary: string | null; accent: string | null }> {
    // Find linked stylesheet URLs
    const linkMatches = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)];
    const hrefMatches = [...html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi)];
    // Also match preloaded stylesheets
    const preloadMatches = [...html.matchAll(/<link[^>]*rel=["']preload["'][^>]*href=["']([^"']+\.css)["']/gi)];
    const allHrefs = [...linkMatches, ...hrefMatches, ...preloadMatches].map(m => this.resolveUrl(m[1], origin));
    // Deduplicate
    const cssUrls = [...new Set(allHrefs)].slice(0, 3); // Limit to 3 stylesheets

    let primary: string | null = null;
    let accent: string | null = null;

    for (const cssUrl of cssUrls) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(cssUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CleanCentive/1.0)' },
        });
        clearTimeout(timeout);
        const css = await res.text();

        // Look for custom properties with "primary" in name
        const primaryMatch = css.match(/--[a-z0-9-]*primary(?:-5)?:\s*(#[0-9a-fA-F]{3,8})/i);
        if (primaryMatch?.[1] && !this.isNeutralColor(primaryMatch[1])) {
          primary = primaryMatch[1];
        }

        // Look for custom properties with "accent" or "secondary" or "brand"
        const accentMatch = css.match(/--[a-z0-9-]*(?:accent|secondary|brand)(?:-5)?:\s*(#[0-9a-fA-F]{3,8})/i);
        if (accentMatch?.[1] && !this.isNeutralColor(accentMatch[1])) {
          accent = accentMatch[1];
        }

        // If we found primary but not accent, pick a lighter variant
        if (primary && !accent) {
          const lightMatch = css.match(/--[a-z0-9-]*(?:light|blue|highlight)(?:-[0-9])?:\s*(#[0-9a-fA-F]{3,8})/i);
          if (lightMatch?.[1] && !this.isNeutralColor(lightMatch[1])) {
            accent = lightMatch[1];
          }
        }

        if (primary && accent) break;
      } catch {
        // Skip inaccessible stylesheets
      }
    }

    return { primary, accent };
  }

  private isNeutralColor(hex: string): boolean {
    const h = hex.replace('#', '').toLowerCase();
    if (h.length < 6) return false;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    // Consider it neutral if all channels are close (grayscale) or very light/dark
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const spread = max - min;
    if (spread < 30 && (max > 200 || min < 40)) return true;
    return false;
  }

  private resolveUrl(href: string, origin: string): string {
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    if (href.startsWith('//')) return `https:${href}`;
    if (href.startsWith('/')) return `${origin}${href}`;
    return `${origin}/${href}`;
  }

  private extractSiteName(html: string, domain: string): string | null {
    // 1. og:site_name
    const siteName = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
    if (siteName?.[1]?.trim()) return siteName[1].trim();

    // 2. og:title
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogTitle?.[1]?.trim()) return ogTitle[1].trim();

    // 3. <title> tag — strip trailing " - ..." or " | ..." suffixes
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (title?.[1]?.trim()) {
      return title[1].trim().replace(/\s*[|\-–—].+$/, '').trim() || title[1].trim();
    }

    // 4. Derive from domain
    return this.nameFromDomain(domain);
  }

  private nameFromDomain(domain: string): string {
    const base = domain.replace(/^www\./, '').split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  private extractSiteDescription(html: string): string | null {
    // 1. og:description
    const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
    if (ogDesc?.[1]?.trim()) return ogDesc[1].trim();

    // 2. meta description
    const desc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (desc?.[1]?.trim()) return desc[1].trim();

    return null;
  }

  private async extractColorsFromManifest(html: string, origin: string): Promise<{ primary: string | null; accent: string | null }> {
    // Find manifest URL from HTML or try well-known paths
    const manifestLink = html.match(/<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/i)
      || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']manifest["']/i);

    const candidates = new Set<string>();
    if (manifestLink?.[1]) candidates.add(this.resolveUrl(manifestLink[1], origin));
    candidates.add(`${origin}/manifest.json`);
    candidates.add(`${origin}/site.webmanifest`);

    for (const url of candidates) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3_000);
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CleanCentive/1.0)' },
        });
        clearTimeout(timeout);
        if (!res.ok) continue;
        const manifest = await res.json();
        let primary: string | null = null;
        let accent: string | null = null;
        if (manifest.theme_color && !this.isNeutralColor(manifest.theme_color)) {
          primary = manifest.theme_color;
        }
        if (manifest.background_color && !this.isNeutralColor(manifest.background_color)) {
          accent = manifest.background_color;
        }
        if (primary || accent) return { primary, accent };
      } catch {
        // Skip inaccessible manifests
      }
    }

    return { primary: null, accent: null };
  }

  async reconcileTeamMemberships(teamId: string): Promise<{ added: number; removed: number }> {
    const patterns = await this.teamEmailPatternRepository.find({ where: { team_id: teamId } });
    if (patterns.length === 0) {
      // No patterns — remove all memberships that were auto-managed
      // (but since partner teams are fully pattern-driven, we remove all non-admin platform memberships)
      return { added: 0, removed: 0 };
    }

    // Find all user IDs whose emails match any pattern
    const matchedUserIds = new Set<string>();
    for (const pattern of patterns) {
      const userEmails = await this.findEmailsMatchingPattern(pattern.email_pattern);
      for (const ue of userEmails) {
        matchedUserIds.add(ue.user_id);
      }
    }

    // Stewards are always organizers of partner teams
    const platformAdminIds = await this.adminService.getAdminUserIds();
    for (const id of platformAdminIds) {
      matchedUserIds.add(id);
    }
    const platformAdminSet = new Set(platformAdminIds);

    // Current memberships
    const currentMemberships = await this.teamMembershipRepository.find({ where: { team_id: teamId } });
    const currentByUserId = new Map(currentMemberships.map((m) => [m.user_id, m]));

    let added = 0;
    let removed = 0;

    // Add missing members
    for (const userId of matchedUserIds) {
      const existing = currentByUserId.get(userId);
      const shouldBeAdmin = platformAdminSet.has(userId);

      if (!existing) {
        const membership = this.teamMembershipRepository.create({
          team_id: teamId,
          user_id: userId,
          role: shouldBeAdmin ? 'organizer' : 'member',
        });
        await this.teamMembershipRepository.save(membership);
        added++;
      } else if (shouldBeAdmin && existing.role !== 'organizer') {
        existing.role = 'organizer';
        await this.teamMembershipRepository.save(existing);
      }
    }

    // Remove members who no longer match
    for (const membership of currentMemberships) {
      if (!matchedUserIds.has(membership.user_id)) {
        await this.teamMembershipRepository.delete({ id: membership.id });
        await this.userRepository.update(
          { id: membership.user_id, active_team_id: teamId },
          { active_team_id: null, updated_by: membership.user_id },
        );
        removed++;
      }
    }

    // Check for multi-match conflicts
    await this.detectMultiMatchConflicts(teamId, matchedUserIds);

    this.logger.log(`Reconciled team ${teamId}: +${added} -${removed}`);
    return { added, removed };
  }

  @OnEvent('user-email.changed')
  async reconcileUserPartnerMemberships(payload: { userId: string }): Promise<void> {
    const { userId } = payload;
    const userEmails = await this.userEmailRepository.find({ where: { user_id: userId } });
    const allPatterns = await this.teamEmailPatternRepository.find();

    // Group patterns by team
    const patternsByTeam = new Map<string, TeamEmailPattern[]>();
    for (const pattern of allPatterns) {
      const list = patternsByTeam.get(pattern.team_id) || [];
      list.push(pattern);
      patternsByTeam.set(pattern.team_id, list);
    }

    const platformAdminIds = await this.adminService.getAdminUserIds();
    const isPlatformAdmin = platformAdminIds.includes(userId);

    const matchedTeamIds = new Set<string>();

    for (const [teamId, patterns] of patternsByTeam) {
      const matches = patterns.some((p) =>
        userEmails.some((ue) => this.emailMatchesPattern(ue.email, p.email_pattern)),
      );
      if (matches || isPlatformAdmin) {
        matchedTeamIds.add(teamId);
      }
    }

    // Get current partner team memberships for this user
    const partnerTeamIds = [...patternsByTeam.keys()];
    const currentMemberships = partnerTeamIds.length > 0
      ? await this.teamMembershipRepository.find({
          where: { user_id: userId, team_id: In(partnerTeamIds) },
        })
      : [];

    // Add missing
    for (const teamId of matchedTeamIds) {
      const existing = currentMemberships.find((m) => m.team_id === teamId);
      if (!existing) {
        const membership = this.teamMembershipRepository.create({
          team_id: teamId,
          user_id: userId,
          role: isPlatformAdmin ? 'organizer' : 'member',
        });
        await this.teamMembershipRepository.save(membership);
      } else if (isPlatformAdmin && existing.role !== 'organizer') {
        existing.role = 'organizer';
        await this.teamMembershipRepository.save(existing);
      }
    }

    // Remove from partner teams user no longer matches
    for (const membership of currentMemberships) {
      if (!matchedTeamIds.has(membership.team_id)) {
        await this.teamMembershipRepository.delete({ id: membership.id });
        await this.userRepository.update(
          { id: userId, active_team_id: membership.team_id },
          { active_team_id: null, updated_by: userId },
        );
      }
    }

    // Multi-match alerting
    if (matchedTeamIds.size > 1) {
      const teamNames = await this.teamRepository.find({
        where: { id: In([...matchedTeamIds]) },
        select: ['id', 'name'],
      });
      const names = teamNames.map((t) => t.name).join(', ');
      const email = userEmails[0]?.email || userId;
      this.logger.warn(`User ${email} matches multiple partner teams: ${names}`);
      await this.alertAdminsMultiMatch(email, teamNames.map((t) => t.name));
    }
  }

  private async findEmailsMatchingPattern(pattern: string): Promise<UserEmail[]> {
    if (isRegexPattern(pattern)) {
      return this.userEmailRepository
        .createQueryBuilder('ue')
        .where('ue.email ~ :pattern', { pattern })
        .getMany();
    }
    // Plain domain match: email ends with @domain
    return this.userEmailRepository
      .createQueryBuilder('ue')
      .where('ue.email ILIKE :suffix', { suffix: `%@${pattern}` })
      .getMany();
  }

  private emailMatchesPattern(email: string, pattern: string): boolean {
    if (isRegexPattern(pattern)) {
      try {
        return new RegExp(pattern).test(email);
      } catch {
        return false;
      }
    }
    return email.toLowerCase().endsWith(`@${pattern.toLowerCase()}`);
  }

  private async detectMultiMatchConflicts(teamId: string, matchedUserIds: Set<string>): Promise<void> {
    if (matchedUserIds.size === 0) return;

    // Check if any of these users are also matched by other partner teams
    const otherPatterns = await this.teamEmailPatternRepository
      .createQueryBuilder('p')
      .where('p.team_id != :teamId', { teamId })
      .getMany();

    if (otherPatterns.length === 0) return;

    const otherTeamIds = [...new Set(otherPatterns.map((p) => p.team_id))];
    const otherMemberships = await this.teamMembershipRepository.find({
      where: { team_id: In(otherTeamIds), user_id: In([...matchedUserIds]) },
    });

    if (otherMemberships.length > 0) {
      const conflictUserIds = [...new Set(otherMemberships.map((m) => m.user_id))];
      const conflictEmails = await this.userEmailRepository.find({
        where: { user_id: In(conflictUserIds) },
      });
      const emailList = [...new Set(conflictEmails.map((e) => e.email))].slice(0, 10);

      const allTeamIds = [teamId, ...otherTeamIds];
      const teams = await this.teamRepository.find({ where: { id: In(allTeamIds) }, select: ['id', 'name'] });
      const teamNames = teams.map((t) => t.name);

      this.logger.warn(`Multi-match conflict: ${emailList.join(', ')} match teams: ${teamNames.join(', ')}`);
      await this.alertAdminsMultiMatch(emailList.join(', '), teamNames);
    }
  }

  private async alertAdminsMultiMatch(emails: string, teamNames: string[]): Promise<void> {
    const adminIds = await this.adminService.getAdminUserIds();
    if (adminIds.length === 0) return;

    const adminEmails = await this.userEmailRepository.find({
      where: { user_id: In(adminIds), is_selected_for_login: true },
    });
    const uniqueAdminEmails = [...new Set(adminEmails.map((e) => e.email))];
    if (uniqueAdminEmails.length === 0) return;

    await this.emailService.sendCommunityMessage(uniqueAdminEmails, null, {
      subject: '[CleanCentive Admin] Partner team multi-match conflict',
      preheader: 'Email(s) match multiple partner teams',
      title: 'Partner Team Conflict',
      body: `The following email(s) match multiple partner teams:\n\n${emails}\n\nAffected teams: ${teamNames.join(', ')}\n\nPlease review the email patterns to resolve the overlap.`,
      disclosure: 'This is an automated admin notification from CleanCentive.',
    });
  }

  private async sendTeamMessageEmailFanout(teamName: string, message: TeamMessage, authorUserId: string): Promise<void> {
    // 'members' audience → all members and organizers; 'organizers' audience → organizers only
    const recipients = message.audience === 'organizers'
      ? await this.teamMembershipRepository.find({ where: { team_id: message.team_id, role: 'organizer' } })
      : await this.teamMembershipRepository.find({ where: { team_id: message.team_id } });

    const recipientIds = recipients.map((r) => r.user_id).filter((id) => id !== authorUserId);

    const recipientEmails = recipientIds.length > 0
      ? await this.userEmailRepository.find({ where: { user_id: In(recipientIds), is_selected_for_login: true } })
      : [];

    // CC the sender so they get a copy
    const senderEmails = await this.userEmailRepository.find({ where: { user_id: authorUserId, is_selected_for_login: true } });
    const senderEmail = senderEmails[0]?.email || null;

    const uniqueRecipientEmails = [...new Set(recipientEmails.map((e) => e.email))];
    await this.emailService.sendCommunityMessage(uniqueRecipientEmails, senderEmail, {
      subject: `[Team: ${teamName}] ${message.subject}`,
      preheader: 'New team message in Cleancentive',
      title: teamName,
      body: message.body,
      disclosure: 'Stewards can read team and cleanup messages for moderation purposes.',
    });
  }
}
