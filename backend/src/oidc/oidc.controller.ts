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
import { OidcService } from './oidc.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('oidc')
export class OidcController {
  private readonly issuerUrl: string;

  constructor(
    private readonly oidcService: OidcService,
    private readonly authService: AuthService,
  ) {
    this.issuerUrl = process.env.OIDC_ISSUER_URL || 'https://cleancentive.org/api/v1/oidc';
  }

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
    @Query('code_challenge') codeChallenge?: string,
    @Query('code_challenge_method') codeChallengeMethod?: string,
    @Query('nonce') nonce?: string,
  ) {
    // Validate response_type
    if (responseType !== 'code') {
      const errorUrl = this.buildErrorUrl(redirectUri, 'unsupported_response_type', 'Response type must be "code"', state);
      return res.redirect(errorUrl);
    }

    // Validate client_id
    const client = await this.oidcService.getClient(clientId);
    if (!client) {
      const errorUrl = this.buildErrorUrl(redirectUri, 'invalid_client', 'Unknown client', state);
      return res.redirect(errorUrl);
    }

    // Validate redirect_uri
    if (!(await this.oidcService.validateRedirectUri(clientId, redirectUri))) {
      const errorUrl = this.buildErrorUrl(redirectUri, 'invalid_request', 'Invalid redirect URI', state);
      return res.redirect(errorUrl);
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

    // Validate client credentials (simplified for MVP)
    const validSecret = await this.oidcService.getClientSecret(client_id || 'outline');
    if (!validSecret || client_secret !== validSecret) {
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

  @Get('callback')
  async callback(@Query('token') token: string, @Res() res: Response) {
    // This endpoint is called after magic link login
    // The token is the session token from the magic link flow
    // We redirect to the authorize endpoint with the session
    try {
      const payload = await this.authService.validateSessionToken(token);
      // Re-run the authorize flow with the session
      const authorizeUrl = `${this.issuerUrl}/authorize${token ? `?session_token=${token}` : ''}`;
      return res.redirect(authorizeUrl);
    } catch (e) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}?oidcError=invalid_session`);
    }
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
