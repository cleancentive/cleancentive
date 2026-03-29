import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Label } from './label.entity';
import { LabelTranslation } from './label-translation.entity';

export interface LabelDto {
  id: string;
  name: string;
  type: string;
}

@Injectable()
export class LabelService {
  private readonly logger = new Logger(LabelService.name);

  constructor(
    @InjectRepository(Label)
    private readonly labelRepository: Repository<Label>,
    @InjectRepository(LabelTranslation)
    private readonly translationRepository: Repository<LabelTranslation>,
    private readonly dataSource: DataSource,
  ) {}

  async searchLabels(type: string, search: string, locale: string, limit: number): Promise<LabelDto[]> {
    const results = await this.translationRepository
      .createQueryBuilder('lt')
      .innerJoin('lt.label', 'l')
      .select(['l.id AS id', 'lt.name AS name', 'l.type AS type'])
      .where('l.type = :type', { type })
      .andWhere('lt.locale = :locale', { locale })
      .andWhere('lt.name ILIKE :search', { search: `%${search}%` })
      .orderBy('lt.name', 'ASC')
      .limit(limit)
      .getRawMany();

    return results;
  }

  async getAllByType(locale: string): Promise<Record<string, LabelDto[]>> {
    const results = await this.translationRepository
      .createQueryBuilder('lt')
      .innerJoin('lt.label', 'l')
      .select(['l.id AS id', 'lt.name AS name', 'l.type AS type'])
      .where('lt.locale = :locale', { locale })
      .orderBy('lt.name', 'ASC')
      .getRawMany();

    const grouped: Record<string, LabelDto[]> = { object: [], material: [], brand: [] };
    for (const row of results) {
      if (grouped[row.type]) {
        grouped[row.type].push({ id: row.id, name: row.name, type: row.type });
      }
    }
    return grouped;
  }

  async createLabel(
    type: string,
    translations: Record<string, string>,
    createdBy?: string,
  ): Promise<LabelDto> {
    const validTypes = ['object', 'material', 'brand'];
    if (!validTypes.includes(type)) {
      throw new BadRequestException(`type must be one of: ${validTypes.join(', ')}`);
    }

    const locales = Object.keys(translations);
    if (locales.length === 0) {
      throw new BadRequestException('At least one translation is required');
    }

    const primaryName = translations[locales[0]].trim();
    if (!primaryName) {
      throw new BadRequestException('Translation name cannot be empty');
    }

    // Check for close duplicates in primary locale
    const existing = await this.searchLabels(type, primaryName, locales[0], 5);
    const exactMatch = existing.find(
      (l) => l.name.toLowerCase() === primaryName.toLowerCase(),
    );
    if (exactMatch) {
      return exactMatch;
    }

    return this.dataSource.transaction(async (manager) => {
      const label = manager.create(Label, { type: type as any });
      const savedLabel = await manager.save(label);

      for (const [locale, name] of Object.entries(translations)) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        const translation = manager.create(LabelTranslation, {
          label_id: savedLabel.id,
          locale,
          name: trimmed,
        });
        await manager.save(translation);
      }

      this.logger.log(
        `New label created: type=${type}, name="${primaryName}", locale=${locales[0]}, createdBy=${createdBy ?? 'unknown'}`,
      );

      return { id: savedLabel.id, name: primaryName, type };
    });
  }

  async findByIdAndType(id: string, type: string): Promise<Label | null> {
    return this.labelRepository.findOne({ where: { id, type: type as any } });
  }
}
