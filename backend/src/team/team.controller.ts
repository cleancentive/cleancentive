import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { TeamService } from './team.service';
import { AdminService } from '../admin/admin.service';

@Controller('teams')
@ApiBearerAuth('Bearer')
export class TeamController {
  constructor(
    private readonly teamService: TeamService,
    private readonly adminService: AdminService,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async searchTeams(
    @Request() req: any,
    @Query('q') query?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const userId = req.user?.userId;
    const isPlatformAdmin = userId ? await this.adminService.isAdmin(userId) : false;
    return this.teamService.searchTeams({
      query,
      includeArchived: includeArchived === 'true',
      currentUserIsPlatformAdmin: isPlatformAdmin,
      userId,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createTeam(@Request() req: any, @Body() body: { name?: string; description?: string }) {
    return this.teamService.createTeam(req.user.userId, {
      name: body.name || '',
      description: body.description || '',
    });
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async getTeam(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) teamId: string,
  ) {
    const userId = req.user?.userId;
    const isPlatformAdmin = userId ? await this.adminService.isAdmin(userId) : false;
    return this.teamService.getTeamDetail(teamId, userId, isPlatformAdmin);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async updateTeam(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) teamId: string,
    @Body() body: { name?: string; description?: string },
  ) {
    return this.teamService.updateTeam(teamId, req.user.userId, body);
  }

  @Post(':id/join')
  @UseGuards(JwtAuthGuard)
  async joinTeam(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.joinTeam(teamId, req.user.userId);
  }

  @Post(':id/leave')
  @UseGuards(JwtAuthGuard)
  async leaveTeam(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.leaveTeam(teamId, req.user.userId);
  }

  @Post(':id/activate')
  @UseGuards(JwtAuthGuard)
  async activateTeam(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.activateTeam(teamId, req.user.userId);
  }

  @Delete('active')
  @UseGuards(JwtAuthGuard)
  async deactivateTeam(@Request() req: any): Promise<{ success: boolean }> {
    await this.teamService.deactivateTeam(req.user.userId);
    return { success: true };
  }

  @Post(':id/members/:userId/promote')
  @UseGuards(JwtAuthGuard)
  async promoteTeamMember(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ success: boolean }> {
    await this.teamService.promoteMember(teamId, userId, req.user.userId);
    return { success: true };
  }

  @Post(':id/archive')
  @UseGuards(JwtAuthGuard)
  async archiveTeam(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string): Promise<{ success: boolean }> {
    await this.teamService.archiveTeam(teamId, req.user.userId);
    return { success: true };
  }

  @Get(':id/messages')
  @UseGuards(JwtAuthGuard)
  async listMessages(@Request() req: any, @Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.listMessages(teamId, req.user.userId);
  }

  @Post(':id/messages')
  @UseGuards(JwtAuthGuard)
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

  // ── Partner team admin endpoints ──

  @Get(':id/email-patterns')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getEmailPatterns(@Param('id', ParseUUIDPipe) teamId: string) {
    return this.teamService.getEmailPatterns(teamId);
  }

  @Put(':id/email-patterns')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async setEmailPatterns(
    @Param('id', ParseUUIDPipe) teamId: string,
    @Body() body: { patterns: string[] },
  ) {
    return this.teamService.setEmailPatterns(teamId, body.patterns || []);
  }

  @Put(':id/custom-css')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateCustomCss(
    @Param('id', ParseUUIDPipe) teamId: string,
    @Body() body: { custom_css: string | null },
  ) {
    return this.teamService.updateCustomCss(teamId, body.custom_css);
  }

  @Post('import-partner-url')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async importPartnerFromUrl(@Body() body: { url: string }) {
    return this.teamService.importPartnerFromUrl(body.url);
  }
}
