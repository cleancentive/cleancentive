import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';

import { CleanupService } from './cleanup.service';

interface StubDate {
  id: string;
  cleanup_id: string;
  start_at: Date;
  end_at: Date;
  latitude: number;
  longitude: number;
  location_name: string | null;
}

function makeService(opts: {
  futureDates: StubDate[];
  recipientEmails: Array<{ email: string }>;
  participantLocale?: string | null;
}) {
  const sentEmails: any[] = [];
  const participantUpdates: any[] = [];

  const cleanupDateRepository = {
    find: async ({ where }: any) => {
      const op = where?.start_at;
      const cutoff: Date | undefined = op?.value ?? op?._value;
      if (!cutoff) return opts.futureDates;
      return opts.futureDates.filter((d) => d.start_at.getTime() > cutoff.getTime());
    },
  };

  const userEmailRepository = {
    find: async () => opts.recipientEmails,
  };

  const userRepository = {
    findOne: async () => ({ id: 'u1', locale: opts.participantLocale ?? null }),
  };

  const cleanupParticipantRepository = {
    update: async (where: any, patch: any) => {
      participantUpdates.push({ where, patch });
    },
  };

  const emailService = {
    sendCleanupInvite: async (email: string, payload: any, locale?: string) => {
      sentEmails.push({ email, payload, locale });
    },
  };

  const calendarService = {
    feedUrls: () => ({
      joinedHttp: 'http://x/joined.ics',
      joinedWebcal: 'webcal://x/joined.ics',
      discoverHttp: 'http://x/discover.ics',
      discoverWebcal: 'webcal://x/discover.ics',
    }),
    getAppBaseUrl: () => 'http://localhost:5173',
    buildSingleEventForEmail: async () => ({ ics: 'ICS-CONTENT', event: null }),
  };

  // Use the prototype method directly so we don't have to instantiate every repo.
  const service: any = Object.create(CleanupService.prototype);
  service.cleanupDateRepository = cleanupDateRepository;
  service.userEmailRepository = userEmailRepository;
  service.userRepository = userRepository;
  service.cleanupParticipantRepository = cleanupParticipantRepository;
  service.emailService = emailService;
  service.calendarService = calendarService;

  return { service, sentEmails, participantUpdates };
}

function inHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

describe('CleanupService.fireCalendarEmailsForFutureDates 6h cutoff', () => {
  test('sends invite for a cleanup date >6h in the future', async () => {
    const date: StubDate = {
      id: 'cd1',
      cleanup_id: 'c1',
      start_at: inHours(7),
      end_at: inHours(9),
      latitude: 0,
      longitude: 0,
      location_name: null,
    };
    const { service, sentEmails } = makeService({
      futureDates: [date],
      recipientEmails: [{ email: 'user@example.com' }],
    });

    await service.fireCalendarEmailsForFutureDates(
      'c1',
      'u1',
      { id: 'p1', email_sequence: 0 },
      'REQUEST',
      'River Walk',
    );

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].email).toBe('user@example.com');
    expect(sentEmails[0].payload.method).toBe('REQUEST');
  });

  test('skips a cleanup date <6h in the future', async () => {
    const date: StubDate = {
      id: 'cd1',
      cleanup_id: 'c1',
      start_at: inHours(5),
      end_at: inHours(7),
      latitude: 0,
      longitude: 0,
      location_name: null,
    };
    const { service, sentEmails, participantUpdates } = makeService({
      futureDates: [date],
      recipientEmails: [{ email: 'user@example.com' }],
    });

    await service.fireCalendarEmailsForFutureDates(
      'c1',
      'u1',
      { id: 'p1', email_sequence: 0 },
      'REQUEST',
      'River Walk',
    );

    expect(sentEmails).toHaveLength(0);
    expect(participantUpdates).toHaveLength(0);
  });

  test('with mixed dates, emails only the >6h ones', async () => {
    const dates: StubDate[] = [
      {
        id: 'cd-soon',
        cleanup_id: 'c1',
        start_at: inHours(2),
        end_at: inHours(4),
        latitude: 0,
        longitude: 0,
        location_name: null,
      },
      {
        id: 'cd-later',
        cleanup_id: 'c1',
        start_at: inHours(48),
        end_at: inHours(50),
        latitude: 0,
        longitude: 0,
        location_name: null,
      },
    ];
    const { service, sentEmails } = makeService({
      futureDates: dates,
      recipientEmails: [{ email: 'user@example.com' }],
    });

    await service.fireCalendarEmailsForFutureDates(
      'c1',
      'u1',
      { id: 'p1', email_sequence: 0 },
      'CANCEL',
      'River Walk',
    );

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].payload.method).toBe('CANCEL');
  });

  test('skips entirely when user has no calendar-enabled emails', async () => {
    const date: StubDate = {
      id: 'cd1',
      cleanup_id: 'c1',
      start_at: inHours(48),
      end_at: inHours(50),
      latitude: 0,
      longitude: 0,
      location_name: null,
    };
    const { service, sentEmails } = makeService({
      futureDates: [date],
      recipientEmails: [],
    });

    await service.fireCalendarEmailsForFutureDates(
      'c1',
      'u1',
      { id: 'p1', email_sequence: 0 },
      'REQUEST',
      'River Walk',
    );

    expect(sentEmails).toHaveLength(0);
  });
});

describe('CleanupService.formatWhen event-local timezone', () => {
  const service: any = Object.create(CleanupService.prototype);

  test('renders same-day event in its location timezone, not UTC', () => {
    // Basel, Switzerland in late May → CEST (UTC+2).
    const when = service.formatWhen(
      new Date('2026-05-29T16:00:00Z'),
      new Date('2026-05-29T18:00:00Z'),
      47.5596,
      7.5886,
    );
    // 16:00–18:00 UTC == 18:00–20:00 local, matching the website.
    expect(when).toBe('May 29, 2026, 6:00 PM – 8:00 PM GMT+2');
  });

  test('falls back to UTC for invalid coordinates', () => {
    const when = service.formatWhen(
      new Date('2026-01-15T09:00:00Z'),
      new Date('2026-01-15T11:00:00Z'),
      NaN,
      NaN,
    );
    expect(when).toBe('Jan 15, 2026, 9:00 AM – 11:00 AM UTC');
  });
});

describe('CleanupService calendar invite locale', () => {
  test("renders in the participant's stored locale, not the request locale", async () => {
    // Regression: invites were rendered with getCurrentLocale(), so a participant
    // who had chosen German got whatever locale the *acting* request carried —
    // and nothing at all when fired from a background job.
    const { service, sentEmails } = makeService({
      futureDates: [{
        id: 'cd1', cleanup_id: 'c1', start_at: inHours(7), end_at: inHours(9),
        latitude: 0, longitude: 0, location_name: null,
      }],
      recipientEmails: [{ email: 'user@example.com' }],
      participantLocale: 'de',
    });

    await service.fireCalendarEmailsForFutureDates('c1', 'u1', { id: 'p1', email_sequence: 0 }, 'REQUEST', 'River Walk');

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].locale).toBe('de');
  });

  test('falls back to the default when the participant has no stored locale', async () => {
    const { service, sentEmails } = makeService({
      futureDates: [{
        id: 'cd1', cleanup_id: 'c1', start_at: inHours(7), end_at: inHours(9),
        latitude: 0, longitude: 0, location_name: null,
      }],
      recipientEmails: [{ email: 'user@example.com' }],
      participantLocale: null,
    });

    await service.fireCalendarEmailsForFutureDates('c1', 'u1', { id: 'p1', email_sequence: 0 }, 'REQUEST', 'River Walk');

    expect(sentEmails[0].locale).toBe('en');
  });
});

/**
 * Team-linked cleanups: who may edit them, and whose team name is shown.
 * Built the same way as the harness above — prototype methods over stub repos.
 */
function makeTeamService(opts: {
  cleanup: { id: string; team_id: string | null; archived_at?: Date | null };
  participants?: Array<{ cleanup_id: string; user_id: string; role: string }>;
  memberships?: Array<{ team_id: string; user_id: string; role: string }>;
  teams?: Array<{ id: string; name: string; is_unlisted?: boolean; archived_at?: Date | null; system_key?: string | null }>;
}) {
  const saved: any[] = [];
  const participants = opts.participants ?? [];
  const memberships = opts.memberships ?? [];
  const teams = opts.teams ?? [];

  const service: any = Object.create(CleanupService.prototype);
  service.cleanupRepository = {
    findOne: async ({ where }: any) => {
      if (where?.name_normalized) return null;
      return where?.id === opts.cleanup.id ? { ...opts.cleanup } : null;
    },
    save: async (row: any) => {
      saved.push(row);
      return row;
    },
  };
  service.cleanupParticipantRepository = {
    findOne: async ({ where }: any) =>
      participants.find((p) => p.cleanup_id === where.cleanup_id && p.user_id === where.user_id) ?? null,
  };
  service.teamMembershipRepository = {
    findOne: async ({ where }: any) =>
      memberships.find((m) => m.team_id === where.team_id && m.user_id === where.user_id) ?? null,
    find: async ({ where }: any) => {
      const wanted: string[] = where.team_id?._value ?? where.team_id?.value ?? [];
      return memberships.filter((m) => m.user_id === where.user_id && wanted.includes(m.team_id));
    },
  };
  service.teamRepository = {
    findOne: async ({ where }: any) => teams.find((t) => t.id === where.id) ?? null,
    find: async ({ where }: any) => {
      const wanted: string[] = where.id?._value ?? where.id?.value ?? [];
      return teams.filter((t) => wanted.includes(t.id));
    },
  };
  service.userEmailRepository = { count: async () => 1 };

  return { service, saved };
}

describe('CleanupService team-organized cleanups', () => {
  test('a team organizer may edit a team cleanup they never joined', async () => {
    const { service, saved } = makeTeamService({
      cleanup: { id: 'c1', team_id: 't1', archived_at: null },
      memberships: [{ team_id: 't1', user_id: 'u-org', role: 'organizer' }],
      teams: [{ id: 't1', name: 'Summit', system_key: null }],
    });

    await service.updateCleanup('c1', 'u-org', { description: 'edited by the team' });

    expect(saved).toHaveLength(1);
    expect(saved[0].description).toBe('edited by the team');
  });

  test('a plain team member may not edit a team cleanup', async () => {
    const { service } = makeTeamService({
      cleanup: { id: 'c1', team_id: 't1', archived_at: null },
      memberships: [{ team_id: 't1', user_id: 'u-member', role: 'member' }],
      teams: [{ id: 't1', name: 'Summit', system_key: null }],
    });

    await expect(service.updateCleanup('c1', 'u-member', { description: 'nope' })).rejects.toThrow(
      'You are not a participant in this cleanup',
    );
  });

  test('assigning a team you do not organize is refused', async () => {
    const { service } = makeTeamService({
      cleanup: { id: 'c1', team_id: null, archived_at: null },
      participants: [{ cleanup_id: 'c1', user_id: 'u1', role: 'organizer' }],
      memberships: [{ team_id: 't1', user_id: 'u1', role: 'member' }],
      teams: [{ id: 't1', name: 'Summit', system_key: null }],
    });

    await expect(service.updateCleanup('c1', 'u1', { teamId: 't1' })).rejects.toThrow(
      'Team organizer permissions required',
    );
  });

  test('clearing the team is allowed for the cleanup organizer', async () => {
    const { service, saved } = makeTeamService({
      cleanup: { id: 'c1', team_id: 't1', archived_at: null },
      participants: [{ cleanup_id: 'c1', user_id: 'u1', role: 'organizer' }],
      teams: [{ id: 't1', name: 'Summit', system_key: null }],
    });

    await service.updateCleanup('c1', 'u1', { teamId: null });

    expect(saved[0].team_id).toBeNull();
  });

  test('an unlisted team is not named to outsiders', async () => {
    const { service } = makeTeamService({
      cleanup: { id: 'c1', team_id: 't1' },
      teams: [{ id: 't1', name: 'Secret', is_unlisted: true }],
    });

    const outsider = await service.resolveTeamSummaries(['t1'], 'u-outsider', false);
    expect(outsider.get('t1')).toBeUndefined();
  });

  test('an unlisted team is named to its members and to stewards', async () => {
    const { service } = makeTeamService({
      cleanup: { id: 'c1', team_id: 't1' },
      memberships: [{ team_id: 't1', user_id: 'u-member', role: 'member' }],
      teams: [{ id: 't1', name: 'Secret', is_unlisted: true }],
    });

    const member = await service.resolveTeamSummaries(['t1'], 'u-member', false);
    expect(member.get('t1').name).toBe('Secret');

    const steward = await service.resolveTeamSummaries(['t1'], 'u-steward', true);
    expect(steward.get('t1').name).toBe('Secret');
  });
});
