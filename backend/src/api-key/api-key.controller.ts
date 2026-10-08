import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import type { ApiKeyScope } from './api-key.entity';
import { ApiKeyService, ApiKeySummary, CreatedApiKey } from './api-key.service';

@Controller('admin/api-keys')
@ApiTags('admin')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Post()
  @ApiOperation({
    summary: 'Issue an API key for an application',
    description:
      'Returns the full key exactly once. Clients send it as `X-API-Key` alongside the user’s own bearer token; ' +
      'it attributes their picks and budgets their traffic, it never stands in for a user.',
  })
  async create(
    @Request() req: any,
    @Body()
    body: {
      name: string;
      contactEmail: string;
      scopes: ApiKeyScope[];
      rateLimitPerMinute?: number;
      expiresInDays?: number | null;
    },
  ): Promise<CreatedApiKey> {
    return this.apiKeys.create(
      {
        name: body?.name,
        contactEmail: body?.contactEmail,
        scopes: body?.scopes,
        rateLimitPerMinute: body?.rateLimitPerMinute,
        expiresInDays: body?.expiresInDays,
      },
      req.user.userId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List API keys, revoked ones included (prefix only, never the key)' })
  async list(): Promise<ApiKeySummary[]> {
    return this.apiKeys.list();
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an API key. Requests carrying it are refused from then on.' })
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.apiKeys.revoke(id);
  }
}
