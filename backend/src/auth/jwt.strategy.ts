import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from './jwt-config';
import { isSessionPayload, type TokenPayload } from './token-claims';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: TokenPayload) {
    // Magic links, add-email verifications, merge confirmations and recovery
    // links are all signed with this same secret. Accepting any token with a
    // `sub` made every one of them a working bearer session.
    if (!isSessionPayload(payload)) {
      throw new UnauthorizedException('Invalid session token');
    }
    return { userId: payload.sub };
  }
}
