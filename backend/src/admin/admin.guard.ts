import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private adminService: AdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;

    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    // Steward actions are the most consequential thing an account can do, and
    // a personal access token is the credential most likely to end up in a
    // script or a client. Keep them apart.
    if (request.user.authKind === 'pat') {
      throw new ForbiddenException('Steward actions need an interactive sign-in');
    }

    const isAdmin = await this.adminService.isAdmin(userId);
    if (!isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
