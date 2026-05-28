import rawEntries from './neophytes.json';

export type InvasiveList = 'infoflora_black' | 'infoflora_watch';

export interface InfoFloraEntry {
  scientificName: string;
  commonNameEn: string;
  list: InvasiveList;
  recommendedAction: string;
}

interface RawEntry {
  scientific_name: string;
  common_name_en: string;
  list: 'black' | 'watch';
  recommended_action: string;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function buildIndex(): Map<string, InfoFloraEntry> {
  const index = new Map<string, InfoFloraEntry>();
  for (const entry of rawEntries as RawEntry[]) {
    index.set(normalizeName(entry.scientific_name), {
      scientificName: entry.scientific_name,
      commonNameEn: entry.common_name_en,
      list: entry.list === 'black' ? 'infoflora_black' : 'infoflora_watch',
      recommendedAction: entry.recommended_action,
    });
  }
  return index;
}

let cachedIndex: Map<string, InfoFloraEntry> | null = null;

export function lookupInvasive(scientificName: string): InfoFloraEntry | null {
  if (!scientificName) return null;
  if (!cachedIndex) cachedIndex = buildIndex();
  return cachedIndex.get(normalizeName(scientificName)) ?? null;
}

export function resetInfoFloraCache(): void {
  cachedIndex = null;
}
