import { describe, test, expect, beforeEach } from 'bun:test';
import { lookupInvasive, resetInfoFloraCache } from './infoflora';

describe('lookupInvasive', () => {
  beforeEach(() => {
    resetInfoFloraCache();
  });

  test('returns black-list entry for Japanese knotweed (exact case)', () => {
    const hit = lookupInvasive('Reynoutria japonica');
    expect(hit).not.toBeNull();
    expect(hit?.list).toBe('infoflora_black');
    expect(hit?.commonNameEn).toBe('Japanese knotweed');
    expect(hit?.recommendedAction).toContain('Do not uproot');
  });

  test('lookup is case-insensitive', () => {
    expect(lookupInvasive('reynoutria japonica')).not.toBeNull();
    expect(lookupInvasive('REYNOUTRIA JAPONICA')).not.toBeNull();
  });

  test('lookup tolerates surrounding whitespace', () => {
    expect(lookupInvasive('  Heracleum mantegazzianum  ')).not.toBeNull();
  });

  test('returns watch-list entry for Robinia pseudoacacia', () => {
    const hit = lookupInvasive('Robinia pseudoacacia');
    expect(hit?.list).toBe('infoflora_watch');
  });

  test('returns null for unknown species', () => {
    expect(lookupInvasive('Taraxacum officinale')).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(lookupInvasive('')).toBeNull();
  });
});
