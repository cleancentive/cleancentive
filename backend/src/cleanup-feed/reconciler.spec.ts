import { describe, expect, test } from 'bun:test';

import { reconcile, normalizeName, type LinkedCleanupRow, type ReconcileInput } from './reconciler';
import { formatDescription } from './description-format';
import type { CleanupFeedSettings } from './cleanup-feed.entity';
import type { ExternalCleanup } from './adapters/adapter';

const NOW = new Date('2026-09-17T08:00:00Z');
const SETTINGS: CleanupFeedSettings = { language: 'de', horizon: 'upcoming', namePrefix: 'Clean-Up Tour' };
const FEED = { id: 'feed-1', teamId: 'team-1', settings: SETTINGS };

function external(overrides: Partial<ExternalCleanup> = {}): ExternalCleanup {
  return {
    externalId: '943',
    title: 'Zermatt',
    body: 'Am Freitag 18. September findet der nationale Clean-Up-Day statt.',
    url: 'https://cleanuptour.ch/de/event/zermatt/',
    registrationUrl: 'https://forms.gle/abc',
    startAt: new Date('2026-09-18T06:00:00Z'),
    endAt: new Date('2026-09-18T13:30:00Z'),
    address: 'Wiestistrasse, 44, Zermatt',
    latitude: 46.0227,
    longitude: 7.7522,
    locationName: 'Zermatt',
    version: '2026-08-13T07:35:23',
    ...overrides,
  };
}

/** A cleanup this feed already created, in sync with the given source event. */
function linkedRow(source: ExternalCleanup, overrides: Partial<LinkedCleanupRow> = {}): LinkedCleanupRow {
  const name = `Clean-Up Tour ${source.title}`;
  const description = formatDescription(source);
  return {
    id: 'cleanup-1',
    name,
    nameNormalized: normalizeName(name),
    description,
    archivedAt: null,
    teamId: FEED.teamId,
    feedId: FEED.id,
    externalId: source.externalId,
    version: source.version,
    snapshot: {
      dateId: 'date-1',
      name,
      description,
      registrationUrl: source.registrationUrl,
      startAt: source.startAt.toISOString(),
      endAt: source.endAt.toISOString(),
      address: source.address,
      latitude: source.latitude,
      longitude: source.longitude,
      locationName: source.locationName,
    },
    dates: [
      {
        id: 'date-1',
        startAt: source.startAt,
        endAt: source.endAt,
        latitude: source.latitude,
        longitude: source.longitude,
        locationName: source.locationName,
      },
    ],
    ...overrides,
  };
}

function input(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    now: NOW,
    feed: FEED,
    linked: [],
    candidatesByName: new Map(),
    externals: [],
    listedExternalIds: new Set(['943']),
    unresolved: [],
    ...overrides,
  };
}

describe('reconcile — creating', () => {
  test('a source event nobody has yet becomes a new cleanup', () => {
    const plan = reconcile(input({ externals: [external()] }));

    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].name).toBe('Clean-Up Tour Zermatt');
    expect(plan.creates[0].description).toBe(external().body);
    expect(plan.updates).toHaveLength(0);
    expect(plan.archives).toHaveLength(0);
  });

  test('a hand-entered cleanup for the same event and day is adopted, not duplicated', () => {
    const manual: LinkedCleanupRow = {
      ...linkedRow(external()),
      id: 'manual-1',
      feedId: null,
      externalId: null,
      snapshot: null,
      description: 'Written by a human',
    };
    const plan = reconcile(
      input({
        externals: [external()],
        candidatesByName: new Map([[manual.nameNormalized, manual]]),
      }),
    );

    expect(plan.creates).toHaveLength(0);
    expect(plan.adoptions).toEqual([{ cleanupId: 'manual-1', external: expect.anything() }]);
  });

  test('a same-named cleanup on a different date is not adopted; the new one is disambiguated', () => {
    const unrelated: LinkedCleanupRow = {
      ...linkedRow(external({ startAt: new Date('2026-05-01T06:00:00Z'), endAt: new Date('2026-05-01T13:00:00Z') })),
      id: 'unrelated-1',
      feedId: null,
      externalId: null,
      snapshot: null,
    };
    const plan = reconcile(
      input({
        externals: [external()],
        candidatesByName: new Map([[unrelated.nameNormalized, unrelated]]),
      }),
    );

    expect(plan.adoptions).toHaveLength(0);
    expect(plan.creates[0].name).toBe('Clean-Up Tour Zermatt (2026)');
  });

  test('next season reuses the source id, and becomes its own cleanup', () => {
    // Last year's edition is past, so it is not the row to rewrite.
    const lastYear = linkedRow(
      external({ startAt: new Date('2025-09-19T06:00:00Z'), endAt: new Date('2025-09-19T13:30:00Z') }),
    );
    const plan = reconcile(input({ linked: [lastYear], externals: [external()] }));

    expect(plan.updates).toHaveLength(0);
    expect(plan.archives).toHaveLength(0);
    expect(plan.creates[0].name).toBe('Clean-Up Tour Zermatt (2026)');
  });
});

describe('reconcile — updating', () => {
  test('nothing to do when the source has not moved', () => {
    const plan = reconcile(input({ linked: [linkedRow(external())], externals: [external()] }));

    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toEqual(['943']);
  });

  test('a moved date is written back', () => {
    const moved = external({ startAt: new Date('2026-09-19T06:00:00Z'), endAt: new Date('2026-09-19T13:30:00Z') });
    const plan = reconcile(input({ linked: [linkedRow(external())], externals: [moved] }));

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].changes.startAt).toBe('2026-09-19T06:00:00.000Z');
    expect(plan.updates[0].dateId).toBe('date-1');
    expect(plan.updates[0].changes.latitude).toBeUndefined();
  });

  test("an organizer's corrected coordinate survives an unrelated source change", () => {
    const row = linkedRow(external());
    // The organizer moved the pin; the snapshot still holds what the feed wrote.
    row.dates[0].latitude = 46.0299;
    row.dates[0].longitude = 7.7491;

    const retitled = external({ title: 'Zermatt Matterhorn' });
    const plan = reconcile(input({ linked: [row], externals: [retitled] }));

    expect(plan.updates[0].changes.name).toBe('Clean-Up Tour Zermatt Matterhorn');
    expect(plan.updates[0].changes.latitude).toBeUndefined();
    expect(plan.updates[0].changes.longitude).toBeUndefined();
  });

  test('a registration link the source changed is written back', () => {
    const moved = external({ registrationUrl: 'https://forms.gle/new' });
    const plan = reconcile(input({ linked: [linkedRow(external())], externals: [moved] }));

    expect(plan.updates[0].changes.registrationUrl).toBe('https://forms.gle/new');
  });

  test('a cleanup stored before the feed tracked registration links picks one up', () => {
    // Snapshots written by earlier versions have no registrationUrl; the first
    // refresh after the upgrade fills it in rather than leaving it empty.
    const row = linkedRow(external());
    delete row.snapshot.registrationUrl;
    const plan = reconcile(input({ linked: [row], externals: [external()] }));

    expect(plan.updates[0].changes.registrationUrl).toBe('https://forms.gle/abc');
  });

  test('a coordinate the source itself moved is written back', () => {
    const relocated = external({ latitude: 46.1, longitude: 7.8 });
    const plan = reconcile(input({ linked: [linkedRow(external())], externals: [relocated] }));

    expect(plan.updates[0].changes.latitude).toBe(46.1);
    expect(plan.updates[0].changes.longitude).toBe(7.8);
  });

  test('a failed geocode never blanks coordinates that already exist', () => {
    const unlocated = external({ latitude: null, longitude: null, title: 'Zermatt Dorf' });
    const plan = reconcile(input({ linked: [linkedRow(external())], externals: [unlocated] }));

    expect(plan.updates[0].changes.name).toBe('Clean-Up Tour Zermatt Dorf');
    expect(plan.updates[0].changes.latitude).toBeUndefined();
  });

  test('a date an organizer deleted is reported instead of guessed at', () => {
    const row = linkedRow(external());
    row.dates = [{ ...row.dates[0], id: 'date-added-by-hand' }];
    const plan = reconcile(input({ linked: [row], externals: [external()] }));

    expect(plan.updates).toHaveLength(0);
    expect(plan.errors[0].reason).toContain('removed by an organizer');
  });
});

describe('reconcile — archiving', () => {
  test('an upcoming cleanup the source withdrew is archived', () => {
    const plan = reconcile(input({ linked: [linkedRow(external())], externals: [], listedExternalIds: new Set() }));

    expect(plan.archives).toEqual([{ cleanupId: 'cleanup-1', externalId: '943', name: 'Clean-Up Tour Zermatt' }]);
  });

  test('a past cleanup is left alone even when the source drops it', () => {
    const past = linkedRow(
      external({ startAt: new Date('2026-05-10T07:00:00Z'), endAt: new Date('2026-05-10T13:00:00Z') }),
    );
    const plan = reconcile(input({ linked: [past], externals: [], listedExternalIds: new Set() }));

    expect(plan.archives).toHaveLength(0);
  });

  test('an already archived cleanup is not archived twice', () => {
    const archived = linkedRow(external());
    archived.archivedAt = new Date('2026-09-01T00:00:00Z');
    const plan = reconcile(input({ linked: [archived], externals: [], listedExternalIds: new Set() }));

    expect(plan.archives).toHaveLength(0);
  });

  test('an event still listed but not fetched this run is left alone', () => {
    // Unchanged events are skipped before the fetch; they must not look withdrawn.
    const plan = reconcile(input({ linked: [linkedRow(external())], externals: [], listedExternalIds: new Set(['943']) }));

    expect(plan.archives).toHaveLength(0);
  });
});

describe('reconcile — errors', () => {
  test('a listing that could not be resolved is reported', () => {
    const plan = reconcile(
      input({
        unresolved: [
          {
            listing: { externalId: '963', url: 'https://cleanuptour.ch/event/kandersteg/', title: 'Kandersteg', version: null, startsOn: null },
            reason: 'could not geocode "Kandersteg, Bern"',
          },
        ],
      }),
    );

    expect(plan.errors).toEqual([
      {
        externalId: '963',
        title: 'Kandersteg',
        url: 'https://cleanuptour.ch/event/kandersteg/',
        reason: 'could not geocode "Kandersteg, Bern"',
      },
    ]);
  });
});
