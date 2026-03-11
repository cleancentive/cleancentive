import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Team } from './team.entity';
import { TeamMembership } from './team-membership.entity';
import { TeamMessage } from './team-message.entity';
import { User } from '../user/user.entity';
import { AdminService } from '../admin/admin.service';
import { UserEmail } from '../user/user-email.entity';
import { EmailService } from '../email/email.service';

interface SearchTeamsInput {
  query?: string;
  includeArchived?: boolean;
  currentUserIsPlatformAdmin: boolean;
}

interface CreateTeamInput {
  name: string;
  description: string;
}

interface CreateTeamMessageInput {
  teamId: string;
  authorUserId: string;
  audience: 'members' | 'admins';
  subject: string;
  body: string;
}

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMembership)
    private readonly teamMembershipRepository: Repository<TeamMembership>,
    @InjectRepository(TeamMessage)
    private readonly teamMessageRepository: Repository<TeamMessage>,
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

  private async ensureAdmin(teamId: string, userId: string): Promise<TeamMembership> {
    const membership = await this.getMembershipOrThrow(teamId, userId);
    if (membership.role !== 'admin') {
      throw new ForbiddenException('Team admin permissions required');
    }
    return membership;
  }

  private async ensureRegisteredUser(userId: string): Promise<void> {
    const emailCount = await this.userEmailRepository.count({ where: { user_id: userId } });
    if (emailCount === 0) {
      throw new ForbiddenException('Community features require a registered account');
    }
  }

  async searchTeams(input: SearchTeamsInput): Promise<Team[]> {
    const qb = this.teamRepository.createQueryBuilder('team').orderBy('team.created_at', 'DESC');
    if (input.query?.trim()) {
      const query = `%${input.query.trim()}%`;
      qb.where('(team.name ILIKE :query OR team.description ILIKE :query)', { query });
    }

    if (input.includeArchived) {
      if (!input.currentUserIsPlatformAdmin) {
        throw new ForbiddenException('Only platform admins can include archived teams');
      }
    } else {
      qb.andWhere('team.archived_at IS NULL');
    }

    return qb.getMany();
  }

  async createTeam(userId: string, input: CreateTeamInput): Promise<Team> {
    await this.ensureRegisteredUser(userId);
    const trimmedName = input.name?.trim();
    const trimmedDescription = input.description?.trim();
    if (!trimmedName) {
      throw new BadRequestException('name is required');
    }
    if (!trimmedDescription) {
      throw new BadRequestException('description is required');
    }

    const nameNormalized = this.normalizeName(trimmedName);
    const existing = await this.teamRepository.findOne({ where: { name_normalized: nameNormalized } });
    if (existing) {
      throw new BadRequestException('Team name already exists');
    }

    const team = this.teamRepository.create({
      name: trimmedName,
      name_normalized: nameNormalized,
      description: trimmedDescription,
      created_by: userId,
      updated_by: userId,
      archived_at: null,
      archived_by: null,
    });
    const savedTeam = await this.teamRepository.save(team);

    const membership = this.teamMembershipRepository.create({
      team_id: savedTeam.id,
      user_id: userId,
      role: 'admin',
      created_by: userId,
      updated_by: userId,
    });
    await this.teamMembershipRepository.save(membership);

    await this.userRepository.update({ id: userId }, { active_team_id: savedTeam.id });
    return savedTeam;
  }

  async getTeam(teamId: string): Promise<Team> {
    const team = await this.getTeamOrThrow(teamId);
    if (team.archived_at) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  async joinTeam(teamId: string, userId: string): Promise<{ joined: boolean }> {
    await this.ensureRegisteredUser(userId);
    const team = await this.getTeamOrThrow(teamId);
    await this.ensureTeamNotArchived(team);

    const existing = await this.getMembership(teamId, userId);
    if (existing) {
      return { joined: false };
    }

    const membership = this.teamMembershipRepository.create({
      team_id: teamId,
      user_id: userId,
      role: 'member',
      created_by: userId,
      updated_by: userId,
    });
    await this.teamMembershipRepository.save(membership);
    return { joined: true };
  }

  async leaveTeam(teamId: string, userId: string): Promise<{ left: boolean }> {
    await this.ensureRegisteredUser(userId);
    const membership = await this.getMembership(teamId, userId);
    if (!membership) {
      return { left: false };
    }

    if (membership.role === 'admin') {
      const remainingAdminCount = await this.teamMembershipRepository.count({
        where: { team_id: teamId, role: 'admin' },
      });

      if (remainingAdminCount <= 1) {
        await this.promotePlatformAdmins(teamId, userId);
      }
    }

    await this.teamMembershipRepository.delete({ id: membership.id });
    await this.userRepository.update({ id: userId, active_team_id: teamId }, { active_team_id: null });
    return { left: true };
  }

  private async promotePlatformAdmins(teamId: string, updatedBy: string): Promise<void> {
    const platformAdminIds = await this.adminService.getAdminUserIds();
    if (platformAdminIds.length === 0) {
      throw new BadRequestException('Cannot leave team because no platform admins are available for fallback promotion');
    }

    const existingMemberships = await this.teamMembershipRepository.find({
      where: {
        team_id: teamId,
        user_id: In(platformAdminIds),
      },
    });

    const membershipByUserId = new Map(existingMemberships.map((membership) => [membership.user_id, membership]));

    for (const adminUserId of platformAdminIds) {
      const existingMembership = membershipByUserId.get(adminUserId);
      if (!existingMembership) {
        const membership = this.teamMembershipRepository.create({
          team_id: teamId,
          user_id: adminUserId,
          role: 'admin',
          created_by: updatedBy,
          updated_by: updatedBy,
        });
        await this.teamMembershipRepository.save(membership);
        continue;
      }

      if (existingMembership.role !== 'admin') {
        existingMembership.role = 'admin';
        existingMembership.updated_by = updatedBy;
        await this.teamMembershipRepository.save(existingMembership);
      }
    }
  }

  async activateTeam(teamId: string, userId: string): Promise<{ activeTeamId: string }> {
    await this.ensureRegisteredUser(userId);
    const team = await this.getTeamOrThrow(teamId);
    await this.ensureTeamNotArchived(team);
    await this.getMembershipOrThrow(teamId, userId);
    await this.userRepository.update({ id: userId }, { active_team_id: teamId });
    return { activeTeamId: teamId };
  }

  async deactivateTeam(userId: string): Promise<void> {
    await this.userRepository.update({ id: userId }, { active_team_id: null });
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
      await this.userRepository.update({ id: userId }, { active_team_id: null });
      return null;
    }

    return membership.team;
  }

  async promoteMember(teamId: string, targetUserId: string, actorUserId: string): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    const team = await this.getTeamOrThrow(teamId);
    await this.ensureTeamNotArchived(team);
    await this.ensureAdmin(teamId, actorUserId);

    const membership = await this.getMembership(teamId, targetUserId);
    if (!membership) {
      throw new NotFoundException('Target user is not a team member');
    }

    if (membership.role === 'admin') {
      return;
    }

    membership.role = 'admin';
    membership.updated_by = actorUserId;
    await this.teamMembershipRepository.save(membership);
  }

  async archiveTeam(teamId: string, actorUserId: string): Promise<void> {
    await this.ensureRegisteredUser(actorUserId);
    const team = await this.getTeamOrThrow(teamId);
    await this.ensureAdmin(teamId, actorUserId);
    if (team.archived_at) {
      return;
    }
    team.archived_at = new Date();
    team.archived_by = actorUserId;
    team.updated_by = actorUserId;
    await this.teamRepository.save(team);

    await this.userRepository.update({ active_team_id: teamId }, { active_team_id: null });
  }

  async listMessages(teamId: string, userId: string): Promise<TeamMessage[]> {
    await this.ensureRegisteredUser(userId);
    const membership = await this.getMembership(teamId, userId);
    if (!membership) {
      const isPlatformAdmin = await this.adminService.isAdmin(userId);
      if (!isPlatformAdmin) {
        throw new ForbiddenException('You are not allowed to view team messages');
      }
    }
    return this.teamMessageRepository.find({
      where: { team_id: teamId },
      order: { created_at: 'DESC' },
      take: 100,
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

    if (membership.role !== 'admin' && input.audience !== 'admins') {
      throw new ForbiddenException('Team members can only message team admins');
    }

    const message = this.teamMessageRepository.create({
      team_id: input.teamId,
      author_user_id: input.authorUserId,
      audience: input.audience,
      subject,
      body,
      created_by: input.authorUserId,
      updated_by: input.authorUserId,
    });
    const saved = await this.teamMessageRepository.save(message);

    await this.sendTeamMessageEmailFanout(team.name, saved, input.authorUserId);
    return saved;
  }

  private async sendTeamMessageEmailFanout(teamName: string, message: TeamMessage, authorUserId: string): Promise<void> {
    const recipientRole = message.audience === 'admins' ? 'admin' : 'member';
    const recipients = await this.teamMembershipRepository.find({
      where: { team_id: message.team_id, role: recipientRole },
    });
    const recipientIds = recipients.map((recipient) => recipient.user_id).filter((id) => id !== authorUserId);
    if (recipientIds.length === 0) {
      return;
    }

    const recipientEmails = await this.userEmailRepository.find({
      where: {
        user_id: In(recipientIds),
        is_selected_for_login: true,
      },
    });

    const uniqueEmails = [...new Set(recipientEmails.map((recipientEmail) => recipientEmail.email))];
    await this.emailService.sendCommunityMessage(uniqueEmails, {
      subject: `[Team: ${teamName}] ${message.subject}`,
      preheader: 'New team message in Cleancentive',
      title: teamName,
      body: message.body,
      disclosure: 'Platform admins can read team and event messages for moderation purposes.',
    });
  }
}
