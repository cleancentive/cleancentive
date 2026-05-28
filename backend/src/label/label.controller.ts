import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LabelService } from './label.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('labels')
@ApiTags('labels')
export class LabelController {
  constructor(private readonly labelService: LabelService) {}

  @Get()
  async searchLabels(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('locale') locale?: string,
    @Query('limit') limitQuery?: string,
    @Query('subjectKind') subjectKindQuery?: string,
  ) {
    const resolvedLocale = locale || 'en';
    const parsedLimit = parseInt(limitQuery || '20', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
    const subjectKind: 'litter' | 'plant' | undefined =
      subjectKindQuery === 'plant' ? 'plant' : subjectKindQuery === 'litter' ? 'litter' : undefined;

    if (type && search) {
      return this.labelService.searchLabels(type, search, resolvedLocale, limit, subjectKind);
    }

    return this.labelService.getAllByType(resolvedLocale);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async createLabel(
    @Body() body: { type: string; translations: Record<string, string> },
    @Req() req: any,
  ) {
    return this.labelService.createLabel(body.type, body.translations, req.user?.userId);
  }
}
