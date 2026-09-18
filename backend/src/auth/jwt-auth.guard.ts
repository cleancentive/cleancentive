import { Injectable, ForbiddenException, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from './jwt.strategy';

/**
 * Requires a signed-in account.
 *
 * Guests carry a session token too, so "the token is valid" is no longer the
 * same question as "the caller has an account". Everything behind this guard
 * wants an account; the few routes a guest may legitimately use take
 * GuestOrUserAuthGuard instead.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    const authenticated = super.handleRequest(err, user, info, context, status) as AuthenticatedUser;
    if (authenticated?.isGuest) {
      throw new ForbiddenException('Sign in with your email address to do this');
    }
    return authenticated as TUser;
  }
}
