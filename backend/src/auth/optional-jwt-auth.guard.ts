import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ACCEPTED_BEARER_STRATEGIES } from './bearer-strategies';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard(ACCEPTED_BEARER_STRATEGIES) {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    // Don't throw on missing/invalid token — just return null. A guest token
    // resolves like any other, so `req.user.isGuest` tells the handler which
    // kind of caller it has.
    return user || null;
  }
}
