import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Label } from './label.entity';
import { LabelTranslation } from './label-translation.entity';

export interface LabelDto {
  id: string;
  name: string;
  type: string;
}

@Injectable()
export class LabelService {
  constructor(
    @InjectRepository(Label)
    private readonly labelRepository: Repository<Label>,
    @InjectRepository(LabelTranslation)
    private readonly translationRepository: Repository<LabelTranslation>,
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

  async findByIdAndType(id: string, type: string): Promise<Label | null> {
    return this.labelRepository.findOne({ where: { id, type: type as any } });
  }
}
