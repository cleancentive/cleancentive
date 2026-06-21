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

  async searchLabels(
    type: string,
    search: string,
    locale: string,
    limit: number,
    subjectKind?: 'litter' | 'plant',
  ): Promise<LabelDto[]> {
    // Prefer the requested locale, fall back to the English name when a label
    // has no translation for it (e.g. brands, which are locale-agnostic).
    const qb = this.labelRepository
      .createQueryBuilder('l')
      .leftJoin('l.translations', 'loc', 'loc.locale = :locale', { locale })
      .leftJoin('l.translations', 'en', "en.locale = 'en'")
      .select(['l.id AS id', 'COALESCE(loc.name, en.name) AS name', 'l.type AS type'])
      .where('l.type = :type', { type })
      .andWhere('COALESCE(loc.name, en.name) ILIKE :search', { search: `%${search}%` })
      .orderBy('name', 'ASC')
      .limit(limit);

    if (subjectKind === 'plant' && type === 'object') {
      qb.andWhere('l.scientific_name IS NOT NULL');
    } else if (subjectKind === 'litter' && type === 'object') {
      qb.andWhere('l.scientific_name IS NULL');
    }

    return qb.getRawMany();
  }

  async getAllByType(locale: string): Promise<Record<string, LabelDto[]>> {
    const results = await this.labelRepository
      .createQueryBuilder('l')
      .leftJoin('l.translations', 'loc', 'loc.locale = :locale', { locale })
      .leftJoin('l.translations', 'en', "en.locale = 'en'")
      .select(['l.id AS id', 'COALESCE(loc.name, en.name) AS name', 'l.type AS type'])
      .where('COALESCE(loc.name, en.name) IS NOT NULL')
      .orderBy('name', 'ASC')
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
