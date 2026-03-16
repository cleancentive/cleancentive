import { Controller, Get, Query } from '@nestjs/common';
import { LabelService } from './label.service';

@Controller('labels')
export class LabelController {
  constructor(private readonly labelService: LabelService) {}

  @Get()
  async searchLabels(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('locale') locale?: string,
    @Query('limit') limitQuery?: string,
  ) {
    const resolvedLocale = locale || 'en';
    const parsedLimit = parseInt(limitQuery || '20', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;

    if (type && search) {
      return this.labelService.searchLabels(type, search, resolvedLocale, limit);
    }

    return this.labelService.getAllByType(resolvedLocale);
  }
}
