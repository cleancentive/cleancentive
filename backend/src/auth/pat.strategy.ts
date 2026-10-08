import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-strategy';
import { PersonalAccessTokenService } from '../personal-access-token/personal-access-token.service';
import type { AuthenticatedUser } from './jwt.strategy';

const PAT_PREFIX = 'cc_pat_';
const BEARER_PREFIX = 'Bearer ';

type VerifyCallback = (token: string, done: (err: unknown, user?: unknown) => void) => void;

/**
 * Reads a personal access token out of the Authorization header.
 *
 * Guards run this strategy before `jwt`. A bearer that does not carry the
 * token prefix is simply not ours, so the strategy fails quietly and passport
 * moves on; `error()` would end the chain and lock every session out.
 */
class BearerPatStrategy extends Strategy {
  constructor(private readonly verify: VerifyCallback) {
    super();
  }

  authenticate(req: Request): void {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : '';
    if (!token.startsWith(PAT_PREFIX)) {
      this.fail(401);
      return;
    }
    this.verify(token, (err, user) => {
      if (err) return this.error(err as Error);
      if (!user) return this.fail(401);
      this.success(user);
    });
  }
}

@Injectable()
export class PatStrategy extends PassportStrategy(BearerPatStrategy, 'pat') {
  constructor(private readonly tokens: PersonalAccessTokenService) {
    super();
  }

  async validate(token: string): Promise<AuthenticatedUser> {
    const { userId } = await this.tokens.authenticate(token);
    return { userId, isGuest: false, authKind: 'pat' };
  }
}
