/**
 * Locale-specific strings for transactional emails: subjects and the dynamic
 * prose that is computed in the service (and interpolated into the markdown
 * templates) rather than living in the template files themselves.
 *
 * Static template text (labels, footers) lives in the per-locale `.md` files
 * under templates/ — see loadTemplate() in email.templates.ts.
 *
 * NOTE: DE/FR copy here is a first pass and should be reviewed by a native
 * speaker before a wider rollout.
 */
import { DEFAULT_LOCALE, type Locale } from '@cleancentive/shared';

interface EmailStrings {
  magicLinkSubject: string;
  recoverySubject: string;
  mergeSubject: string;
  cleanup: {
    goingTitle: (name: string) => string;
    cancelTitle: (name: string) => string;
    goingIntro: (name: string) => string;
    cancelIntro: (name: string) => string;
    whereLine: (location: string) => string;
    subject: (title: string, when: string) => string;
  };
}

const STRINGS: Record<Locale, EmailStrings> = {
  en: {
    magicLinkSubject: 'Your CleanCentive Magic Link',
    recoverySubject: 'CleanCentive Account Recovery',
    mergeSubject: 'CleanCentive — Someone wants to merge your account',
    cleanup: {
      goingTitle: (name) => `You're going: ${name}`,
      cancelTitle: (name) => `Cancelled: ${name}`,
      goingIntro: (name) =>
        `Thanks for joining **${name}**. We've attached a calendar invite so you don't miss it.`,
      cancelIntro: (name) =>
        `Your participation in **${name}** has been removed. This event will be cancelled in your calendar.`,
      whereLine: (location) => `**Where:** ${location}`,
      subject: (title, when) => `${title} — ${when}`,
    },
  },
  de: {
    magicLinkSubject: 'Dein CleanCentive Magic Link',
    recoverySubject: 'CleanCentive Kontowiederherstellung',
    mergeSubject: 'CleanCentive — Jemand möchte dein Konto zusammenführen',
    cleanup: {
      goingTitle: (name) => `Du bist dabei: ${name}`,
      cancelTitle: (name) => `Abgesagt: ${name}`,
      goingIntro: (name) =>
        `Danke, dass du bei **${name}** mitmachst. Wir haben eine Kalendereinladung angehängt, damit du nichts verpasst.`,
      cancelIntro: (name) =>
        `Deine Teilnahme an **${name}** wurde entfernt. Dieser Termin wird in deinem Kalender abgesagt.`,
      whereLine: (location) => `**Wo:** ${location}`,
      subject: (title, when) => `${title} — ${when}`,
    },
  },
  fr: {
    magicLinkSubject: 'Votre lien magique CleanCentive',
    recoverySubject: 'Récupération de compte CleanCentive',
    mergeSubject: 'CleanCentive — Quelqu’un veut fusionner votre compte',
    cleanup: {
      goingTitle: (name) => `Vous participez : ${name}`,
      cancelTitle: (name) => `Annulé : ${name}`,
      goingIntro: (name) =>
        `Merci de rejoindre **${name}**. Nous avons joint une invitation d’agenda pour que vous ne manquiez rien.`,
      cancelIntro: (name) =>
        `Votre participation à **${name}** a été retirée. Cet événement sera annulé dans votre agenda.`,
      whereLine: (location) => `**Où :** ${location}`,
      subject: (title, when) => `${title} — ${when}`,
    },
  },
};

export function emailStrings(locale: Locale): EmailStrings {
  return STRINGS[locale] ?? STRINGS[DEFAULT_LOCALE];
}
