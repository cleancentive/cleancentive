import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from './jwt.strategy';

/**
 * Only an interactive sign-in may pass, not a personal access token.
 *
 * Goes after JwtAuthGuard on the routes that change credentials: minting or
 * revoking tokens, refreshing a session, adding or removing emails, approving a
 * device, deleting the account. A token that could do those things could make
 * itself permanent, which is the opposite of what revocation is for.
 */
@Injectable()
export class SessionOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (user?.authKind === 'pat') {
      throw new ForbiddenException('Sign in to do this; an access token is not enough');
    }
    return true;
  }
}
