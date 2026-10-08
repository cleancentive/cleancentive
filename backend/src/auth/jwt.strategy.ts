import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../user/user.service';
import { getJwtSecret } from './jwt-config';
import { isGuestPayload, isSessionPayload, type TokenPayload } from './token-claims';

export type AuthKind = 'session' | 'pat';

export interface AuthenticatedUser {
  userId: string;
  /** True for an anonymous visitor who has not claimed an account yet. */
  isGuest: boolean;
  /** How the caller proved who they are: an interactive session, or a personal access token. */
  authKind: AuthKind;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly userService: UserService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: TokenPayload): Promise<AuthenticatedUser> {
    // Magic links, add-email verifications, merge confirmations and recovery
    // links are all signed with this same secret. Accepting any token with a
    // `sub` made every one of them a working bearer session.
    if (!isSessionPayload(payload)) {
      throw new UnauthorizedException('Invalid session token');
    }

    const isGuest = isGuestPayload(payload);

    // A guest token outlives the guest. Once that id belongs to a real account
    // the token must stop working, or an old one would keep reaching the
    // account it grew into.
    if (isGuest && !(await this.userService.isUnclaimedGuest(payload.sub as string))) {
      throw new UnauthorizedException('Guest session has been claimed. Sign in again.');
    }

    return { userId: payload.sub as string, isGuest, authKind: 'session' };
  }
}
