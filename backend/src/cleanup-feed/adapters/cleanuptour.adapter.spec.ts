import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { cleanuptourAdapter, parseEventPage } from './cleanuptour.adapter';
import type { AdapterContext, ExternalListing } from './adapter';
import type { CleanupFeed } from '../cleanup-feed.entity';

const FIXTURES = join(__dirname, '__fixtures__', 'cleanuptour');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

const events = JSON.parse(fixture('events.json'));

function makeFeed(language: 'de' | 'fr' | 'en' = 'de'): CleanupFeed {
  return {
    url: 'https://cleanuptour.ch/participer/',
    settings: { language, horizon: 'upcoming', namePrefix: 'Clean-Up Tour' },
  } as CleanupFeed;
}

function makeContext(pages: Record<string, string>): { ctx: AdapterContext; requested: string[] } {
  const requested: string[] = [];
  const ctx: AdapterContext = {
    now: new Date('2026-09-17T08:00:00Z'),
    async fetchHtml(url) {
      requested.push(url);
      const page = pages[url];
      if (page === undefined) throw new Error(`unexpected fetch: ${url}`);
      return page;
    },
    async fetchJson<T>(url: string) {
      requested.push(url);
      return {
        body: events as T,
        headers: new Headers({ 'x-wp-total': String(events.length), 'x-wp-totalpages': '1' }),
      };
    },
    logger: { log: () => {}, warn: () => {} },
  };
  return { ctx, requested };
}

describe('cleanuptourAdapter.list', () => {
  test('merges the REST listing with the dates shown on the listing page', async () => {
    const { ctx } = makeContext({ 'https://cleanuptour.ch/participer/': fixture('participer.html') });
    const listings = await cleanuptourAdapter.list(makeFeed(), ctx);

    expect(listings).toHaveLength(events.length);

    const zermatt = listings.find((l) => l.url.includes('/zermatt/'));
    expect(zermatt.externalId).toBe('943');
    expect(zermatt.startsOn).toBe('2026-09-18');
    expect(zermatt.version).toBe('2026-08-13T07:35:23');

    const kandersteg = listings.find((l) => l.url.includes('/kandersteg/'));
    expect(kandersteg.startsOn).toBe('2026-10-17');
  });

  test('decodes entities in the title', async () => {
    const { ctx } = makeContext({ 'https://cleanuptour.ch/participer/': fixture('participer.html') });
    const listings = await cleanuptourAdapter.list(makeFeed(), ctx);
    expect(listings.find((l) => l.url.includes('thyon')).title).toBe('Thyon & Veysonnaz');
  });

  test('a short listing fails the run rather than looking like withdrawals', async () => {
    const { ctx } = makeContext({ 'https://cleanuptour.ch/participer/': fixture('participer.html') });
    const truncated: AdapterContext = {
      ...ctx,
      async fetchJson<T>() {
        return {
          body: events.slice(0, 2) as T,
          headers: new Headers({ 'x-wp-total': '35', 'x-wp-totalpages': '1' }),
        };
      },
    };
    await expect(cleanuptourAdapter.list(makeFeed(), truncated)).rejects.toThrow('listing is incomplete');
  });
});

describe('cleanuptourAdapter.fetchDetail', () => {
  const zermattListing: ExternalListing = {
    externalId: '943',
    url: 'https://cleanuptour.ch/event/zermatt/',
    title: 'Zermatt',
    version: '2026-08-13T07:35:23',
    startsOn: '2026-09-18',
  };

  test('reads the German page into a cleanup', async () => {
    const { ctx, requested } = makeContext({
      'https://cleanuptour.ch/de/event/zermatt/': fixture('event-zermatt.de.html'),
    });
    const detail = await cleanuptourAdapter.fetchDetail(zermattListing, makeFeed('de'), ctx);

    expect(requested).toEqual(['https://cleanuptour.ch/de/event/zermatt/']);
    expect(detail.title).toBe('Zermatt');
    // 18 Sep 2026, 08:00–15:30 Zurich time (CEST, UTC+2).
    expect(detail.startAt.toISOString()).toBe('2026-09-18T06:00:00.000Z');
    expect(detail.endAt.toISOString()).toBe('2026-09-18T13:30:00.000Z');
    expect(detail.address).toBe('Wiestistrasse, 44, Zermatt, Wallis, 3920, Suisse');
    expect(detail.registrationUrl).toContain('docs.google.com/forms');
    expect(detail.body).toContain('Freitag 18. September');
    expect(detail.body).toContain('Treffpunkt');
    expect(detail.locationName).toBe('Zermatt');
    expect(detail.latitude).toBeNull();
  });

  test('reads the French page when the feed asks for French', async () => {
    const { ctx, requested } = makeContext({
      'https://cleanuptour.ch/event/zermatt/': fixture('event-zermatt.fr.html'),
    });
    const detail = await cleanuptourAdapter.fetchDetail(zermattListing, makeFeed('fr'), ctx);

    expect(requested).toEqual(['https://cleanuptour.ch/event/zermatt/']);
    expect(detail.body).toContain('Lieu de rendez-vous');
    expect(detail.startAt.toISOString()).toBe('2026-09-18T06:00:00.000Z');
  });

  test('falls back to the source language when the translation is missing', async () => {
    const { ctx, requested } = makeContext({
      'https://cleanuptour.ch/de/event/zermatt/': '<html><body><h1 class="brxe-post-title">Zermatt</h1></body></html>',
      'https://cleanuptour.ch/event/zermatt/': fixture('event-zermatt.fr.html'),
    });
    const detail = await cleanuptourAdapter.fetchDetail(zermattListing, makeFeed('de'), ctx);

    expect(requested).toHaveLength(2);
    expect(detail.url).toBe('https://cleanuptour.ch/event/zermatt/');
    expect(detail.body).toContain('Lieu de rendez-vous');
  });

  test('the description leaves out a past event\'s recap counters and teasers', async () => {
    const adelboden: ExternalListing = {
      externalId: '788',
      url: 'https://cleanuptour.ch/event/adelboden/',
      title: 'Adelboden',
      version: '2026-05-12T14:00:51',
      startsOn: '2026-05-10',
    };
    const { ctx } = makeContext({
      'https://cleanuptour.ch/event/adelboden/': fixture('event-adelboden.fr.html'),
    });
    const detail = await cleanuptourAdapter.fetchDetail(adelboden, makeFeed('fr'), ctx);

    expect(detail.startAt.toISOString()).toBe('2026-05-10T07:00:00.000Z');
    expect(detail.body).not.toContain('Bénévoles étaient présents');
    expect(detail.body).not.toContain('Nos prochains Clean-Ups');
    expect(detail.address).toBe('Adelboden, Bern, 3715, Suisse');
  });
});

describe('parseEventPage', () => {
  test('finds every anchor on a real page', () => {
    const page = parseEventPage(fixture('event-zermatt.de.html'));
    expect(page.title).toBe('Zermatt');
    expect(page.dateText).toBe('18 September :');
    expect(page.address).toBe('Wiestistrasse, 44, Zermatt, Wallis, 3920, Suisse');
    expect(page.registrationUrl).toContain('docs.google.com/forms');
    expect(page.body.length).toBeGreaterThan(200);
  });

  test('a page without the expected markup yields empties rather than throwing', () => {
    const page = parseEventPage('<html><body><p>nothing here</p></body></html>');
    expect(page.title).toBe('');
    expect(page.dateText).toBe('');
    expect(page.body).toBe('');
    expect(page.address).toBeNull();
    expect(page.registrationUrl).toBeNull();
  });
});
