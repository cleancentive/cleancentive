import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiKeyScope } from './api-key.entity';
import { ApiKeyService, type ResolvedApiKey } from './api-key.service';

export const API_KEY_HEADER = 'x-api-key';
const API_KEY_SCOPE_METADATA = 'apiKeyScope';

/** The scope a request's API key must carry, if it carries a key at all. */
export const RequireApiKeyScope = (scope: ApiKeyScope) => SetMetadata(API_KEY_SCOPE_METADATA, scope);

/**
 * Resolves the X-API-Key header on every request.
 *
 * Runs globally, before the controller guards, and never touches `req.user`:
 * a key says which application is calling, the bearer token says who. A
 * request without the header passes untouched. A request with a bad key is
 * refused even on a public route, so a misconfigured client finds out at
 * once rather than when its picks silently lose their attribution.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers[API_KEY_HEADER];
    if (typeof header !== 'string' || header.trim().length === 0) return true;

    const key = await this.apiKeys.authenticate(header.trim());
    await this.apiKeys.enforceRateLimit(key);

    const requiredScope = this.reflector.get<ApiKeyScope | undefined>(API_KEY_SCOPE_METADATA, context.getHandler());
    if (requiredScope && !key.scopes.includes(requiredScope)) {
      throw new ForbiddenException(`This API key lacks the ${requiredScope} scope`);
    }

    request.apiKey = key satisfies ResolvedApiKey;
    return true;
  }
}
