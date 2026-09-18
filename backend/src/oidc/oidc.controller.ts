import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  Req,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { OidcService } from './oidc.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntegrationQueueService } from '../integrations/integration-queue.service';

/** Constant-time compare, so a wrong secret cannot be found byte by byte. */
function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

@Controller('oidc')
export class OidcController {
  constructor(
    private readonly oidcService: OidcService,
    private readonly integrationQueueService: IntegrationQueueService,
  ) {}

  @Get('.well-known/openid-configuration')
  getDiscoveryDocument() {
    return this.oidcService.getDiscoveryDocument();
  }

  @Get('.well-known/jwks.json')
  getJwks() {
    return this.oidcService.getJwks();
  }

  @Get('authorize')
  async authorize(
    @Req() req: Request,
    @Res() res: Response,
    @Query('response_type') responseType: string,
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('scope') scope: string,
    @Query('state') state: string,
    @Query('code_challenge') _codeChallenge?: string,
    @Query('code_challenge_method') _codeChallengeMethod?: string,
    @Query('nonce') _nonce?: string,
  ) {
    // Validate the client and its redirect target *before* redirecting
    // anywhere. Error responses used to bounce to whatever redirect_uri the
    // caller supplied, so `?response_type=token&redirect_uri=https://evil`
    // made this a redirector wearing our domain.
    const client = await this.oidcService.getClient(clientId);
    if (!client) {
      throw new HttpException('Unknown client', HttpStatus.BAD_REQUEST);
    }

    if (!(await this.oidcService.validateRedirectUri(clientId, redirectUri))) {
      throw new HttpException('Invalid redirect URI', HttpStatus.BAD_REQUEST);
    }

    // Past this point the target is one we registered, so reporting an error
    // by redirecting to it is safe and is what the spec asks for.
    if (responseType !== 'code') {
      return res.redirect(
        this.buildErrorUrl(redirectUri, 'unsupported_response_type', 'Response type must be "code"', state),
      );
    }

    // Top-level navigation from an SSO client (e.g. Outline) has no way to
    // carry the user's Bearer session token, so we always hand the flow off
    // to the frontend, which reads the token from localStorage and calls
    // `authorize/complete` below with it attached.
    const frontendUrl = process.env.FRONTEND_URL || 'https://cleancentive.local';
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(`${frontendUrl}/oidc/authorize${qs}`);
  }

  @Post('authorize/complete')
  @UseGuards(JwtAuthGuard)
  async authorizeComplete(
    @Req() req: Request,
    @Body() body: {
      response_type: string;
      client_id: string;
      redirect_uri: string;
      scope: string;
      state?: string;
      code_challenge?: string;
      code_challenge_method?: string;
      nonce?: string;
    },
  ): Promise<{ redirectUrl: string }> {
    const userId = (req as any).user?.userId;
    if (!userId) throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);

    // Block guests (no verified email) from wiki SSO.
    const claims = await this.oidcService.getUserInfo(userId);
    if (!claims.email) {
      throw new HttpException('Wiki access requires a verified email. Sign in with a magic link first.', HttpStatus.FORBIDDEN);
    }

    if (body.response_type !== 'code') {
      throw new HttpException('response_type must be "code"', HttpStatus.BAD_REQUEST);
    }

    const client = await this.oidcService.getClient(body.client_id);
    if (!client) throw new HttpException('Unknown client', HttpStatus.BAD_REQUEST);

    if (!(await this.oidcService.validateRedirectUri(body.client_id, body.redirect_uri))) {
      throw new HttpException('Invalid redirect URI', HttpStatus.BAD_REQUEST);
    }

    const code = await this.oidcService.createAuthorizationCode({
      userId,
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      scope: body.scope,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method as any,
      nonce: body.nonce,
    });

    const redirectUrl = new URL(body.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (body.state) redirectUrl.searchParams.set('state', body.state);
    return { redirectUrl: redirectUrl.toString() };
  }

  @Post('token')
  async token(
    @Body() body: {
      grant_type: string;
      code?: string;
      redirect_uri?: string;
      client_id?: string;
      client_secret?: string;
      code_verifier?: string;
      refresh_token?: string;
    },
    @Res() res: Response,
  ) {
    const { grant_type, code, redirect_uri, client_id, client_secret, code_verifier, refresh_token } = body;

    // Validate client credentials
    const validSecret = await this.oidcService.getClientSecret(client_id || 'outline');
    if (!validSecret || !secretsMatch(client_secret, validSecret)) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        error: 'invalid_client',
        error_description: 'Client authentication failed',
      });
    }

    if (grant_type === 'authorization_code') {
      if (!code || !redirect_uri) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: 'invalid_request',
          error_description: 'Missing code or redirect_uri',
        });
      }

      const codeData = await this.oidcService.validateAuthorizationCode({
        code,
        clientId: client_id || 'outline',
        redirectUri: redirect_uri,
        codeVerifier: code_verifier,
      });

      if (!codeData) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: 'invalid_grant',
          error_description: 'Invalid or expired authorization code',
        });
      }

      const tokens = await this.oidcService.exchangeCodeForTokens({
        userId: codeData.userId,
        clientId: client_id || 'outline',
        scope: codeData.scope,
        nonce: codeData.nonce,
      });

      if ((client_id || 'outline') === 'outline') {
        await this.integrationQueueService.enqueueOutlineBootstrap({ userId: codeData.userId });
      }

      return res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        id_token: tokens.idToken,
        token_type: tokens.tokenType,
        expires_in: tokens.expiresIn,
      });
    }

    if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: 'invalid_request',
          error_description: 'Missing refresh_token',
        });
      }

      const newTokens = await this.oidcService.refreshAccessToken(
        refresh_token,
        client_id || 'outline',
      );

      if (!newTokens) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: 'invalid_grant',
          error_description: 'Invalid or expired refresh token',
        });
      }

      return res.json({
        access_token: newTokens.accessToken,
        token_type: newTokens.tokenType,
        expires_in: newTokens.expiresIn,
      });
    }

    return res.status(HttpStatus.BAD_REQUEST).json({
      error: 'unsupported_grant_type',
      error_description: 'Grant type must be authorization_code or refresh_token',
    });
  }

  @Get('userinfo')
  @UseGuards(JwtAuthGuard)
  async userInfo(@Req() req: Request) {
    const userId = (req as any).user?.userId;
    if (!userId) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    return this.oidcService.getUserInfo(userId);
  }

  @Post('revoke')
  async revoke(
    @Body() body: { token: string; token_type_hint?: string },
    @Res() res: Response,
  ) {
    await this.oidcService.revokeToken(body.token, body.token_type_hint);
    return res.status(HttpStatus.OK).json({});
  }

  private buildErrorUrl(redirectUri: string, error: string, description: string, state?: string): string {
    try {
      const url = new URL(redirectUri);
      url.searchParams.set('error', error);
      url.searchParams.set('error_description', description);
      if (state) {
        url.searchParams.set('state', state);
      }
      return url.toString();
    } catch (e) {
      // Invalid redirect URI, return a simple error
      return `?error=${error}&error_description=${encodeURIComponent(description)}`;
    }
  }
}
