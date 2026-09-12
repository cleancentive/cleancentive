import { Repository } from 'typeorm';
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from '@cleancentive/shared';
import { User } from './user.entity';
import { UserEmail } from './user-email.entity';

export interface NotificationRecipient {
  email: string;
  locale: Locale;
}

/**
 * Login addresses for a set of users, each paired with that user's stored locale.
 *
 * Consolidates a query that was duplicated across team, cleanup and feedback, and
 * closes the gap all three shared: none of them read `users.locale`, so every
 * recipient was rendered in the *sender's* request locale, and anything sent from
 * a background job fell back to English regardless of preference.
 *
 * Takes the repository rather than UserService so the services that already hold
 * one can use it without new module wiring.
 */
export async function resolveNotificationRecipients(
  userEmailRepository: Repository<UserEmail>,
  userIds: string[],
): Promise<NotificationRecipient[]> {
  if (userIds.length === 0) return [];

  const rows = await userEmailRepository
    .createQueryBuilder('ue')
    .innerJoin(User, 'u', 'u.id = ue.user_id')
    .select('ue.email', 'email')
    .addSelect('u.locale', 'locale')
    .where('ue.user_id IN (:...userIds)', { userIds })
    .andWhere('ue.is_selected_for_login = true')
    .getRawMany<{ email: string; locale: string | null }>();

  return dedupeByEmail(rows.map((row) => ({ email: row.email, locale: toLocale(row.locale) })));
}

export function toLocale(value: string | null | undefined): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * An address belongs to one user but a user may have several, and fan-outs union
 * several groups — dedupe on the address so nobody is mailed twice.
 */
export function dedupeByEmail(recipients: NotificationRecipient[]): NotificationRecipient[] {
  const byEmail = new Map<string, NotificationRecipient>();
  for (const recipient of recipients) {
    const email = recipient.email?.trim().toLowerCase();
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, { email, locale: recipient.locale });
  }
  return [...byEmail.values()];
}
