import { Controller, Get, Post, Delete, Param, Query, UseGuards, Request, ParseIntPipe, ParseUUIDPipe, DefaultValuePipe, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { parseWeeksParam } from '../common/weekly-series';

@Controller('admin')
@ApiBearerAuth('Bearer')
@ApiTags('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('check')
  @UseGuards(JwtAuthGuard)
  async checkAdmin(
    @Request() req: any,
  ): Promise<{ isAdmin: boolean; stewardWikiCollectionId: string | null }> {
    const isAdmin = await this.adminService.isAdmin(req.user.userId);
    if (!isAdmin) {
      // Every signed-in user hits this on app load, so only stewards pay for
      // the collection lookup.
      return { isAdmin, stewardWikiCollectionId: null };
    }

    const stewardWikiCollectionId = await this.adminService.getStewardWikiCollectionId();
    return { isAdmin, stewardWikiCollectionId };
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('search') search?: string,
  ) {
    const validSorts = ['created_at', 'last_login'];
    const validOrders = ['ASC', 'DESC'];

    return this.adminService.getUsers({
      page,
      limit,
      sort: validSorts.includes(sort) ? sort as 'created_at' | 'last_login' : 'created_at',
      order: validOrders.includes(order?.toUpperCase()) ? order.toUpperCase() as 'ASC' | 'DESC' : 'DESC',
      search,
    });
  }

  // Must stay above the 'users/:id' route below, or ParseUUIDPipe rejects the path.
  @Get('users/signups')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getSignupsByWeek(@Query('weeks') weeks?: string) {
    return this.adminService.countSignupsByWeek(parseWeeksParam(weeks));
  }

  @Get('users/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getUserDetail(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.adminService.getUserDetail(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  @Post('users/:id/promote')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async promoteUser(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    await this.adminService.promoteToAdmin(id, req.user.userId);
    return { success: true };
  }

  @Delete('users/:id/demote')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async demoteUser(@Param('id', ParseUUIDPipe) id: string) {
    await this.adminService.demoteFromAdmin(id);
    return { success: true };
  }
}
