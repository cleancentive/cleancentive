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

  const cleanupParticipantRepository = {
    update: async (where: any, patch: any) => {
      participantUpdates.push({ where, patch });
    },
  };

  const emailService = {
    sendCleanupInvite: async (email: string, payload: any) => {
      sentEmails.push({ email, payload });
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
