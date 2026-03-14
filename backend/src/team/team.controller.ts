import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TeamService } from './team.service';
import { AdminService } from '../admin/admin.service';

@Controller('teams')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard)
export class TeamController {
  constructor(
    private readonly teamService: TeamService,
    private readonly adminService: AdminService,
  ) {}

  @Get()
  async searchTeams(
    @Request() req: any,
    @Query('q') query?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const isPlatformAdmin = await this.adminService.isAdmin(req.user.userId);
    return this.teamService.searchTeams({
      query,
      includeArchived: includeArchived === 'true',
      currentUserIsPlatformAdmin: isPlatformAdmin,
    });
  }

  @Post()
  async createTeam(@Request() req: any, @Body() body: { name?: string; description?: string }) {
    return this.teamService.createTeam(req.user.userId, {
      name: body.name || '',
      description: body.description || '',
    });
  }

  @Get(':id')
  async getTeam(@Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.getTeam(teamId);
  }

  @Post(':id/join')
  async joinTeam(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.joinTeam(teamId, req.user.userId);
  }

  @Post(':id/leave')
  async leaveTeam(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.leaveTeam(teamId, req.user.userId);
  }

  @Post(':id/activate')
  async activateTeam(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.activateTeam(teamId, req.user.userId);
  }

  @Delete('active')
  async deactivateTeam(@Request() req: any): Promise<{ success: boolean }> {
    await this.teamService.deactivateTeam(req.user.userId);
    return { success: true };
  }

  @Post(':id/members/:userId/promote')
  async promoteTeamMember(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ success: boolean }> {
    await this.teamService.promoteMember(teamId, userId, req.user.userId);
    return { success: true };
  }

  @Post(':id/archive')
  async archiveTeam(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string): Promise<{ success: boolean }> {
    await this.teamService.archiveTeam(teamId, req.user.userId);
    return { success: true };
  }

  @Get(':id/messages')
  async listMessages(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.listMessages(teamId, req.user.userId);
  }

  @Post(':id/messages')
  async createMessage(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) teamId: string,
    @Body() body: { audience?: 'members' | 'admins'; subject?: string; body?: string },
  ) {
    const message = await this.teamService.createMessage({
      teamId,
      authorUserId: req.user.userId,
      audience: body.audience || 'members',
      subject: body.subject || '',
      body: body.body || '',
    });

    return {
      message,
      disclosure: 'Platform admins can read team and event messages.',
    };
  }
}
