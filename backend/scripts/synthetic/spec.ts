// Layer specification: one spec = one generated bundle.
//
// A spec is fully declarative and deterministic. The same spec + the same TACO
// dataset always produces the same bundle. Compose worlds by applying multiple
// self-contained layers (distinct `layerId`s) via sequential `db-import --merge`.

import { readFileSync } from 'node:fs';

export interface GeoBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface CitySpec {
  name: string;
  box: GeoBox;
  weight: number; // relative share of users/spots that belong to this city
}

export interface TeamSpec {
  name: string;
  description?: string;
  members?: number; // total members incl. organizers (default derived from users)
  organizers?: number; // default 1
  isUnlisted?: boolean;
}

export interface CleanupSpec {
  name: string;
  description?: string;
  city?: string; // which city's geo box the dates sit in (default: first city)
  dates?: number; // number of cleanup_dates (default 4)
}

export interface LayerSpec {
  layerId: string; // slug; namespaces every id and unique field in this layer
  seed: number;
  scenarioType: 'base' | 'pack' | 'augmentation';
  window: { start: string; end: string }; // ISO dates; ~18 months for a base world
  cities: CitySpec[];
  counts: { users: number; spots: number };
  teams: TeamSpec[];
  cleanups: CleanupSpec[];
  feedback?: { count: number };
  taco?: { maxImages?: number; downscaleMaxPx?: number | null };
}

// City geo boxes (lat/lng bounding boxes around the city centre).
export const CITY_BOXES: Record<string, GeoBox> = {
  Basel: { minLat: 47.532, maxLat: 47.589, minLng: 7.557, maxLng: 7.633 },
  'Zürich': { minLat: 47.345, maxLat: 47.41, minLng: 8.49, maxLng: 8.59 },
  Bern: { minLat: 46.93, maxLat: 46.97, minLng: 7.41, maxLng: 7.49 },
  Lausanne: { minLat: 46.5, maxLat: 46.54, minLng: 6.6, maxLng: 6.67 },
};

// Name pools (Swiss-German flavour) for users.
export const FIRST_NAMES = [
  'Lena', 'Noah', 'Mia', 'Liam', 'Emma', 'Luca', 'Anna', 'Elias', 'Lara', 'Nico',
  'Sara', 'Jonas', 'Lea', 'David', 'Nina', 'Tim', 'Sofia', 'Jan', 'Lina', 'Levin',
  'Alina', 'Yves', 'Chiara', 'Andri', 'Selina', 'Marco', 'Jana', 'Reto', 'Petra', 'Urs',
  'Sandra', 'Beat', 'Claudia', 'Stefan', 'Nadia', 'Fabian', 'Carla', 'Simon', 'Vera', 'Ramon',
];

export const LAST_NAMES = [
  'Müller', 'Meier', 'Schmid', 'Keller', 'Weber', 'Huber', 'Schneider', 'Brunner', 'Baumann', 'Frei',
  'Gerber', 'Widmer', 'Steiner', 'Moser', 'Fischer', 'Graf', 'Roth', 'Suter', 'Bachmann', 'Hofer',
  'Kunz', 'Lehmann', 'Bucher', 'Marti', 'Koch', 'Wyss', 'Vogel', 'Sutter', 'Zimmermann', 'Stucki',
];

export const CLEANUP_LOCATION_NAMES = [
  'Rheinufer', 'Stadtpark', 'Bahnhofplatz', 'Schulhausplatz', 'Seepromenade',
  'Waldrand', 'Quartierpark', 'Flussufer', 'Sportplatz', 'Marktplatz',
];

export const TEAM_MESSAGE_SUBJECTS = [
  'Nächster Einsatz', 'Danke fürs Mitmachen!', 'Neue Handschuhe verfügbar',
  'Wetter-Update', 'Treffpunkt geändert', 'Monatsrückblick',
];

export const CLEANUP_MESSAGE_SUBJECTS = [
  'Anmeldung offen', 'Treffpunkt & Material', 'Verschiebung wegen Regen',
  'Vielen Dank!', 'Erinnerung: morgen', 'Fundstücke der Woche',
];

const MESSAGE_BODIES = [
  'Hallo zusammen, wir treffen uns wie besprochen. Bringt Handschuhe und gute Laune mit!',
  'Danke an alle, die letzte Woche dabei waren — wir haben richtig viel gesammelt.',
  'Kurze Info: der Treffpunkt verschiebt sich leicht, Details folgen.',
  'Das Wetter sieht gut aus, der Einsatz findet wie geplant statt.',
  'Super Arbeit alle zusammen, bis zum nächsten Mal!',
];

export function messageBody(rng: { pick: <T>(a: readonly T[]) => T }): string {
  return rng.pick(MESSAGE_BODIES);
}

export function loadSpec(path: string): LayerSpec {
  const spec = JSON.parse(readFileSync(path, 'utf8')) as LayerSpec;
  validateSpec(spec);
  return spec;
}

// A deterministic default base world (Basel + one team) used when no --spec is
// passed. The window is a fixed ~18-month range so output stays reproducible.
export function defaultBaseSpec(): LayerSpec {
  return {
    layerId: 'base-basel',
    seed: 42,
    scenarioType: 'base',
    window: { start: '2024-12-01', end: '2026-05-25' },
    cities: [{ name: 'Basel', box: CITY_BOXES.Basel, weight: 1 }],
    counts: { users: 24, spots: 400 },
    teams: [
      { name: 'Pfadfinder Basel', description: 'Wir halten unsere Stadt sauber.', organizers: 2 },
    ],
    cleanups: [
      { name: 'Rheinputz Basel', description: 'Monatlicher Cleanup am Rheinufer.', city: 'Basel', dates: 6 },
    ],
    feedback: { count: 8 },
    taco: { downscaleMaxPx: null },
  };
}

export function validateSpec(spec: LayerSpec): void {
  const fail = (msg: string): never => {
    throw new Error(`Invalid layer spec: ${msg}`);
  };
  if (!spec.layerId || !/^[a-z0-9-]+$/.test(spec.layerId)) fail('layerId must be a non-empty kebab-case slug');
  if (typeof spec.seed !== 'number') fail('seed must be a number');
  if (!['base', 'pack', 'augmentation'].includes(spec.scenarioType)) fail('scenarioType must be base|pack|augmentation');
  if (!spec.window?.start || !spec.window?.end) fail('window.start and window.end are required');
  if (Number.isNaN(Date.parse(spec.window.start)) || Number.isNaN(Date.parse(spec.window.end))) fail('window dates must be parseable');
  if (Date.parse(spec.window.start) >= Date.parse(spec.window.end)) fail('window.start must be before window.end');
  if (!Array.isArray(spec.cities) || spec.cities.length === 0) fail('at least one city is required');
  for (const c of spec.cities) {
    if (!c.name || !c.box || !(c.weight > 0)) fail(`city ${c.name ?? '?'} must have name, box and positive weight`);
  }
  if (!(spec.counts?.users > 0)) fail('counts.users must be > 0');
  if (!(spec.counts?.spots >= 0)) fail('counts.spots must be >= 0');
}
