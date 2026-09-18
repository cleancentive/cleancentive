import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';

import { CleanupFeedService } from './cleanup-feed.service';
import type { CleanupFeedRunSummary } from './cleanup-feed.entity';

function summary(overrides: Partial<CleanupFeedRunSummary> = {}): CleanupFeedRunSummary {
  return {
    startedAt: '2026-09-18T05:15:00.000Z',
    finishedAt: '2026-09-18T05:15:30.000Z',
    dryRun: false,
    listed: 2,
    fetched: 2,
    skippedPast: 33,
    created: 0,
    adopted: 0,
    updated: 0,
    archived: 0,
    unchanged: 2,
    items: { created: [], adopted: [], updated: [], archived: [] },
    errors: [],
    ...overrides,
  };
}

const service: any = Object.create(CleanupFeedService.prototype);

describe('CleanupFeedService.shouldSendDigest', () => {
  test('a quiet run says nothing', () => {
    expect(service.shouldSendDigest(summary(), [])).toBe(false);
  });

  test('anything actually changed is worth a mail', () => {
    expect(service.shouldSendDigest(summary({ created: 1 }), [])).toBe(true);
    expect(service.shouldSendDigest(summary({ updated: 1 }), [])).toBe(true);
    expect(service.shouldSendDigest(summary({ archived: 1 }), [])).toBe(true);
    expect(service.shouldSendDigest(summary({ adopted: 1 }), [])).toBe(true);
  });

  test('a new problem is reported once', () => {
    const errors = [{ externalId: '963', title: 'Kandersteg', url: 'https://x/', reason: 'could not geocode' }];
    expect(service.shouldSendDigest(summary({ errors }), [])).toBe(true);
  });

  test('the same problem on the next run stays quiet', () => {
    const errors = [{ externalId: '963', title: 'Kandersteg', url: 'https://x/', reason: 'could not geocode' }];
    expect(service.shouldSendDigest(summary({ errors }), errors)).toBe(false);
  });

  test('a different problem with the same event speaks up again', () => {
    const previous = [{ externalId: '963', title: 'Kandersteg', url: 'https://x/', reason: 'could not geocode' }];
    const now = [{ externalId: '963', title: 'Kandersteg', url: 'https://x/', reason: 'no date found' }];
    expect(service.shouldSendDigest(summary({ errors: now }), previous)).toBe(true);
  });
});

describe('CleanupFeedService.resolveOrganizerIds', () => {
  function serviceWith(memberships: Array<{ user_id: string }>, adminIds: string[] = []): any {
    const instance: any = Object.create(CleanupFeedService.prototype);
    instance.teamMembershipRepository = { find: async () => memberships };
    instance.adminService = { getAdminUserIds: async () => adminIds };
    return instance;
  }

  test("the team's organizers get to manage what the feed creates", async () => {
    const instance = serviceWith([{ user_id: 'u-org-1' }, { user_id: 'u-org-2' }]);
    expect(await instance.resolveOrganizerIds({ created_by: 'u-steward' }, { id: 't1' })).toEqual(['u-org-1', 'u-org-2']);
  });

  test('a team without organizers falls back to whoever registered the feed', async () => {
    const instance = serviceWith([]);
    expect(await instance.resolveOrganizerIds({ created_by: 'u-steward' }, { id: 't1' })).toEqual(['u-steward']);
  });

  test('and failing that, to the stewards — never nobody', async () => {
    const instance = serviceWith([], ['u-admin']);
    expect(await instance.resolveOrganizerIds({ created_by: null }, { id: 't1' })).toEqual(['u-admin']);
  });
});

describe('CleanupFeedService.parseSettings', () => {
  test('fills in the defaults', () => {
    expect(service.parseSettings(undefined)).toEqual({ language: 'de', horizon: 'upcoming', namePrefix: '' });
  });

  test('keeps a supported language and trims the prefix', () => {
    expect(service.parseSettings({ language: 'fr', namePrefix: '  Clean-Up Tour ' })).toEqual({
      language: 'fr',
      horizon: 'upcoming',
      namePrefix: 'Clean-Up Tour',
    });
  });

  test('refuses a language the app cannot render', () => {
    expect(() => service.parseSettings({ language: 'it' })).toThrow('supported locale');
  });

  test('refuses an unreasonably long prefix', () => {
    expect(() => service.parseSettings({ namePrefix: 'x'.repeat(61) })).toThrow('60 characters');
  });
});
