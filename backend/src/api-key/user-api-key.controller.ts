import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionOnlyGuard } from '../auth/session-only.guard';
import type { ApiKeyScope } from './api-key.entity';
import { ApiKeyService, type ApiKeySummary, type CreatedApiKey } from './api-key.service';

/**
 * A developer's own API keys. Like personal access tokens these are
 * session-only: a leaked credential must not be able to mint another.
 */
@Controller('user/api-keys')
@ApiTags('profile')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard, SessionOnlyGuard)
export class UserApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an API key for your own application',
    description:
      'Returns the full key exactly once. Clients send it as `X-API-Key` next to a user’s bearer token; it attributes ' +
      'their picks to your app and budgets its traffic (60 requests per minute unless a steward raises it). ' +
      'Scopes: `read`, `write:spots`. Defaults to a one-year expiry; `expiresInDays: null` never expires.',
  })
  async create(
    @Request() req: any,
    @Body() body: { name: string; scopes: ApiKeyScope[]; expiresInDays?: number | null },
  ): Promise<CreatedApiKey> {
    return this.apiKeys.createForOwner(req.user.userId, {
      name: body?.name,
      scopes: body?.scopes,
      expiresInDays: body?.expiresInDays,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List your active API keys (prefix only, never the key)' })
  async list(@Request() req: any): Promise<ApiKeySummary[]> {
    return this.apiKeys.listForOwner(req.user.userId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke one of your API keys. Requests carrying it are refused from then on.' })
  async revoke(@Request() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.apiKeys.revokeForOwner(req.user.userId, id);
  }
}
