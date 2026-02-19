import { Controller, Get, Post, Delete, Param, Query, UseGuards, Request, ParseIntPipe, DefaultValuePipe, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('check')
  @UseGuards(JwtAuthGuard)
  async checkAdmin(@Request() req: any): Promise<{ isAdmin: boolean }> {
    const isAdmin = await this.adminService.isAdmin(req.user.userId);
    return { isAdmin };
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

  @Get('users/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getUserDetail(@Param('id') id: string) {
    const user = await this.adminService.getUserDetail(id);
    if (!user) {
      throw new BadRequestException('User not found');
    }
    return user;
  }

  @Post('users/:id/promote')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async promoteUser(@Request() req: any, @Param('id') id: string) {
    await this.adminService.promoteToAdmin(id, req.user.userId);
    return { success: true };
  }

  @Delete('users/:id/demote')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async demoteUser(@Param('id') id: string) {
    await this.adminService.demoteFromAdmin(id);
    return { success: true };
  }
}
