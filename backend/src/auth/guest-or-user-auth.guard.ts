import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a session, and accepts a guest one.
 *
 * For the things a visitor can legitimately do before they have an account:
 * log a pick, look at their own history, delete their own data. The plain
 * JwtAuthGuard turns guests away, so it stays the right choice everywhere
 * else — this guard is the deliberate exception, not the default.
 *
 * Either way `req.user` comes from a signed token. What it replaces is a
 * `guestId` query parameter that the caller chose freely.
 */
@Injectable()
export class GuestOrUserAuthGuard extends AuthGuard('jwt') {}
