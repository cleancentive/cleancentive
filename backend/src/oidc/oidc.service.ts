import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes, createSign, createVerify } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { UserService } from '../user/user.service';
import {
  OidcAuthorizationCode,
  OidcRefreshToken,
  OidcClient,
  CodeChallengeMethod,
} from './oidc.entity';

const ISSUER_URL = process.env.OIDC_ISSUER_URL || 'https://cleancentive.org/api/v1/oidc';
const JWKS_PATH = process.env.JWKS_PATH || '/tmp/oidc-jwks.json';
const REFRESH_TOKEN_EXPIRY_DAYS = 365;
const ACCESS_TOKEN_EXPIRY_MINUTES = 30;
const AUTH_CODE_EXPIRY_MINUTES = 10;

interface JwksKey {
  kty: string;
  use: string;
  kid: string;
  alg: string;
  n: string;
  e: string;
}

export interface Jwks {
  keys: JwksKey[];
}

interface PrivateKey {
  key: string;
  keyId: string;
}

@Injectable()
export class OidcService implements OnModuleInit {
  private privateKey: PrivateKey | null = null;
  private publicJwks: Jwks = { keys: [] };

  constructor(
    private jwtService: JwtService,
    private userService: UserService,
    @InjectRepository(OidcAuthorizationCode)
    private authCodeRepo: Repository<OidcAuthorizationCode>,
    @InjectRepository(OidcRefreshToken)
    private refreshTokenRepo: Repository<OidcRefreshToken>,
    @InjectRepository(OidcClient)
    private clientRepo: Repository<OidcClient>,
  ) {}

  async onModuleInit() {
    await this.initializeJwks();
    await this.initializeDefaultClient();
  }

  private async initializeJwks() {
    try {
      const content = await readFile(JWKS_PATH, 'utf-8');
      const data = JSON.parse(content);
      if (data.privateKey && data.publicJwks && data.keyId) {
        this.privateKey = { key: data.privateKey, keyId: data.keyId };
        this.publicJwks = data.publicJwks;
        return;
      }
    } catch (e) {
      // File doesn't exist or is invalid, generate new keys
    }

    // Generate new RSA key pair
    const { publicKey, privateKey } = generateKeyPair();
    const keyId = uuidv4().slice(0, 8);

    this.privateKey = { key: privateKey, keyId };
    this.publicJwks = convertToJwks(publicKey, keyId);

    // Persist to file
    try {
      const dir = join(JWKS_PATH, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(
        JWKS_PATH,
        JSON.stringify({
          privateKey,
          publicJwks: this.publicJwks,
          keyId,
        }),
      );
    } catch (e) {
      console.error('Failed to persist JWKS:', e);
    }
  }

  private async initializeDefaultClient() {
    const existing = await this.clientRepo.findOne({ where: { clientId: 'outline' } });
    const redirectUris = (process.env.OIDC_REDIRECT_URIS ?? 'https://wiki.cleancentive.org/auth/oidc.callback')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    // If an env-provided secret is set, keep the DB in sync with it (dev seeds
    // a known secret that Outline's env also references). Otherwise on first
    // create generate a random one and persist it.
    const envSecret = process.env.OIDC_CLIENT_SECRET?.trim() || null;
    if (!existing) {
      await this.clientRepo.save({
        clientId: 'outline',
        clientSecret: envSecret ?? randomBytes(32).toString('hex'),
        redirectUris,
        enabled: true,
      });
      return;
    }
    const patch: Partial<OidcClient> = {};
    if (
      existing.redirectUris.length !== redirectUris.length ||
      existing.redirectUris.some((u, i) => u !== redirectUris[i])
    ) {
      patch.redirectUris = redirectUris;
    }
    if (envSecret && existing.clientSecret !== envSecret) {
      patch.clientSecret = envSecret;
    }
    if (Object.keys(patch).length > 0) {
      await this.clientRepo.update({ clientId: 'outline' }, patch);
    }
  }

  async getClientSecret(clientId: string): Promise<string | null> {
    const client = await this.clientRepo.findOne({ where: { clientId, enabled: true } });
    return client?.clientSecret ?? null;
  }

  getDiscoveryDocument() {
    return {
      issuer: ISSUER_URL,
      authorization_endpoint: `${ISSUER_URL}/authorize`,
      token_endpoint: `${ISSUER_URL}/token`,
      userinfo_endpoint: `${ISSUER_URL}/userinfo`,
      jwks_uri: `${ISSUER_URL}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      claims_supported: ['sub', 'name', 'preferred_username', 'email', 'email_verified'],
      code_challenge_methods_supported: ['plain', 'S256'],
    };
  }

  getJwks() {
    return this.publicJwks;
  }

  async createAuthorizationCode(params: {
    userId: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    codeChallenge?: string;
    codeChallengeMethod?: CodeChallengeMethod;
    nonce?: string;
  }): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + AUTH_CODE_EXPIRY_MINUTES * 60 * 1000);

    await this.authCodeRepo.save({
      id,
      code,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      redirectUri: params.redirectUri,
      clientId: params.clientId,
      scope: params.scope,
      userId: params.userId,
      nonce: params.nonce || '',
      expiresAt,
    });

    return code;
  }

  async validateAuthorizationCode(params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<{ userId: string; scope: string; nonce: string } | null> {
    const authCode = await this.authCodeRepo.findOne({
      where: { code: params.code, clientId: params.clientId },
    });

    if (!authCode) {
      return null;
    }

    if (authCode.expiresAt < new Date()) {
      await this.authCodeRepo.delete(authCode.id);
      return null;
    }

    if (authCode.redirectUri !== params.redirectUri) {
      return null;
    }

    // Validate PKCE
    if (authCode.codeChallenge) {
      if (!params.codeVerifier) {
        return null;
      }

      let codeVerifierHash: string;
      if (authCode.codeChallengeMethod === CodeChallengeMethod.S256) {
        codeVerifierHash = base64UrlEncode(sha256(params.codeVerifier));
      } else {
        codeVerifierHash = params.codeVerifier;
      }

      if (codeVerifierHash !== authCode.codeChallenge) {
        return null;
      }
    }

    // Delete the code (one-time use)
    await this.authCodeRepo.delete(authCode.id);

    return {
      userId: authCode.userId,
      scope: authCode.scope,
      nonce: authCode.nonce,
    };
  }

  async exchangeCodeForTokens(params: {
    userId: string;
    clientId: string;
    scope: string;
    nonce: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    idToken: string;
    expiresIn: number;
    tokenType: string;
  }> {
    const user = await this.userService.findById(params.userId);
    if (!user) {
      throw new Error('User not found');
    }

    const identity = buildIdentityClaims(params.userId, user);

    // Access token (short-lived) - sign with RSA manually
    const accessTokenPayload = { sub: params.userId, clientId: params.clientId, scope: params.scope };
    const accessToken = await this.signWithRsa({
      ...accessTokenPayload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY_MINUTES * 60,
    });

    // ID token
    const idTokenPayload = {
      iss: ISSUER_URL,
      aud: params.clientId,
      exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY_MINUTES * 60,
      iat: Math.floor(Date.now() / 1000),
      nonce: params.nonce,
      ...identity,
    };

    const idToken = await this.signWithRsa(idTokenPayload);

    // Refresh token (long-lived, stored in DB)
    const refreshTokenId = uuidv4();
    const refreshTokenValue = randomBytes(32).toString('base64url');
    const refreshTokenHash = createHash('sha256').update(refreshTokenValue).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.refreshTokenRepo.save({
      id: refreshTokenId,
      tokenHash: refreshTokenHash,
      userId: params.userId,
      clientId: params.clientId,
      scope: params.scope,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      idToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_MINUTES * 60,
      tokenType: 'Bearer',
    };
  }

  async refreshAccessToken(refreshTokenValue: string, clientId: string): Promise<{
    accessToken: string;
    expiresIn: number;
    tokenType: string;
  } | null> {
    const refreshTokenHash = createHash('sha256').update(refreshTokenValue).digest('hex');

    const refreshToken = await this.refreshTokenRepo.findOne({
      where: { tokenHash: refreshTokenHash, clientId },
    });

    if (!refreshToken) {
      return null;
    }

    if (refreshToken.expiresAt < new Date()) {
      await this.refreshTokenRepo.delete(refreshToken.id);
      return null;
    }

    // Issue new access token (reuse scope from stored refresh token)
    const accessToken = this.jwtService.sign(
      { sub: refreshToken.userId, clientId, scope: refreshToken.scope },
      { expiresIn: `${ACCESS_TOKEN_EXPIRY_MINUTES}m`, algorithm: 'RS256' },
    );

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_MINUTES * 60,
      tokenType: 'Bearer',
    };
  }

  async revokeToken(token: string, tokenTypeHint?: string): Promise<boolean> {
    // Try to find as refresh token
    const refreshTokenHash = createHash('sha256').update(token).digest('hex');
    const refreshToken = await this.refreshTokenRepo.findOne({
      where: { tokenHash: refreshTokenHash },
    });

    if (refreshToken) {
      await this.refreshTokenRepo.delete(refreshToken.id);
      return true;
    }

    // For access tokens, we'd need to implement a blacklist
    // For MVP, we'll just return true (simplest)
    return true;
  }

  async getUserInfo(userId: string): Promise<{
    sub: string;
    email?: string;
    email_verified?: boolean;
    preferred_username?: string;
    name?: string;
  }> {
    const user = await this.userService.findById(userId);
    if (!user) {
      return { sub: userId };
    }
    return buildIdentityClaims(userId, user);
  }

  private async signWithRsa(payload: object): Promise<string> {
    if (!this.privateKey) {
      throw new Error('RSA key not initialized');
    }

    const crypto = require('node:crypto');
    const privateKey = crypto.createPrivateKey(this.privateKey.key);
    
    const header = { alg: 'RS256', typ: 'JWT', kid: this.privateKey.keyId };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${headerB64}.${payloadB64}`);
    const signature = sign.sign(privateKey, 'base64url');
    
    return `${headerB64}.${payloadB64}.${signature}`;
  }

  async validateRedirectUri(clientId: string, redirectUri: string): Promise<boolean> {
    const client = await this.clientRepo.findOne({ where: { clientId, enabled: true } });
    return client?.redirectUris.includes(redirectUri) ?? false;
  }

  async getClient(clientId: string): Promise<OidcClient | null> {
    return this.clientRepo.findOne({ where: { clientId, enabled: true } });
  }
}

/**
 * Build the identity claim set shared by the ID token and the userinfo
 * endpoint. Outline (and most OIDC clients) require at least one of
 * `preferred_username`, `name`, or `username` — so we always emit
 * `preferred_username` derived from the email local-part, and fall back to
 * the email itself for `name` when the nickname is the "guest" placeholder.
 */
function buildIdentityClaims(
  userId: string,
  user: { nickname: string; full_name?: string | null; emails?: Array<{ email: string }> },
): {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
} {
  const primaryEmail = user.emails?.[0]?.email;
  const emailLocalPart = primaryEmail?.split('@')[0];
  const displayName =
    (user.full_name && user.full_name.trim()) ||
    (user.nickname && user.nickname !== 'guest' ? user.nickname : null) ||
    emailLocalPart ||
    userId;
  return {
    sub: userId,
    ...(primaryEmail ? { email: primaryEmail, email_verified: true } : {}),
    ...(emailLocalPart ? { preferred_username: emailLocalPart } : {}),
    name: displayName,
  };
}

function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = require('node:crypto').generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function convertToJwks(publicKey: string, keyId: string): Jwks {
  const crypto = require('node:crypto');
  const keyObject = crypto.createPublicKey(publicKey);
  const jwk = keyObject.export({ format: 'jwk' });

  return {
    keys: [
      {
        kty: 'RSA',
        use: 'sig',
        kid: keyId,
        alg: 'RS256',
        n: jwk.n,
        e: jwk.e,
      },
    ],
  };
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function sha256(data: string): Buffer {
  return createHash('sha256').update(data).digest();
}
