import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionOnlyGuard } from '../auth/session-only.guard';
import {
  CreatedPersonalAccessToken,
  PersonalAccessTokenService,
  PersonalAccessTokenSummary,
} from './personal-access-token.service';

@Controller('user/tokens')
@ApiTags('profile')
@ApiBearerAuth('Bearer')
// Session-only: a token must not be able to mint or revoke tokens, or a leaked
// one could quietly grant itself permanence.
@UseGuards(JwtAuthGuard, SessionOnlyGuard)
export class PersonalAccessTokenController {
  constructor(private readonly tokens: PersonalAccessTokenService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a personal access token',
    description:
      'Returns the full token exactly once. Send it as `Authorization: Bearer cc_pat_…`. ' +
      'Defaults to a 90-day expiry; pass `expiresInDays: null` for a token that never expires.',
  })
  async create(
    @Request() req: any,
    @Body() body: { name: string; expiresInDays?: number | null },
  ): Promise<CreatedPersonalAccessToken> {
    return this.tokens.create(req.user.userId, { name: body?.name, expiresInDays: body?.expiresInDays });
  }

  @Get()
  @ApiOperation({ summary: 'List your active personal access tokens (prefix only, never the token)' })
  async list(@Request() req: any): Promise<PersonalAccessTokenSummary[]> {
    return this.tokens.list(req.user.userId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a personal access token. Anything using it stops working immediately.' })
  async revoke(@Request() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tokens.revoke(req.user.userId, id);
  }
}
