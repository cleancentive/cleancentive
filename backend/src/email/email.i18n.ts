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

/**
 * Why detection needs a steward, kept structured rather than pre-formatted so the
 * text can be rendered in each recipient's own language.
 */
export type DetectionAlertReason =
  | { kind: 'worker-down' }
  | { kind: 'retryable-failed'; count: number }
  | { kind: 'stalled'; count: number };

interface EmailStrings {
  magicLinkSubject: string;
  recoverySubject: string;
  mergeSubject: string;
  detectionAlert: {
    subject: string;
    recoveredSubject: string;
    preheader: string;
    recoveredPreheader: string;
    title: string;
    recoveredTitle: string;
    intro: string;
    recoveredIntro: string;
    reasonLabel: string;
    reason: (reason: DetectionAlertReason) => string;
    action: (link: string) => string;
    disclosure: string;
  };
  costAlert: {
    subject: string;
    recoveredSubject: string;
    preheader: string;
    recoveredPreheader: string;
    title: string;
    recoveredTitle: string;
    intro: (projected: string, ceiling: string) => string;
    recoveredIntro: (projected: string, ceiling: string) => string;
    breakdownLabel: string;
    action: (link: string) => string;
    disclosure: string;
  };
  cleanupFeed: {
    subject: (team: string) => string;
    preheader: (created: number, updated: number, archived: number) => string;
    title: (team: string) => string;
    intro: (source: string) => string;
    createdLabel: string;
    adoptedLabel: string;
    updatedLabel: string;
    archivedLabel: string;
    errorsLabel: string;
    entry: (name: string, when: string) => string;
    errorEntry: (title: string, reason: string) => string;
    action: (link: string) => string;
    disclosure: string;
  };
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
    detectionAlert: {
      subject: '[CleanCentive] Detection needs attention',
      recoveredSubject: '[CleanCentive] Detection is working again',
      preheader: 'Litter detection needs a steward',
      recoveredPreheader: 'Litter detection recovered',
      title: 'Detection needs attention',
      recoveredTitle: 'Detection recovered',
      intro: 'Litter detection needs a steward to take a look.',
      recoveredIntro: 'Litter detection is working again. No action is needed.',
      reasonLabel: 'What is wrong',
      reason: (reason) => {
        switch (reason.kind) {
          case 'worker-down':
            return 'the detection worker is not reporting a heartbeat';
          case 'retryable-failed':
            return `${reason.count} spot(s) failed detection and can be retried`;
          case 'stalled':
            return `${reason.count} spot(s) have been awaiting detection for too long`;
        }
      },
      action: (link) => `[Open the operations page](${link}){button}`,
      disclosure: 'You receive this because you are a CleanCentive steward. It is sent once when the problem starts and once when it clears.',
    },
    costAlert: {
      subject: '[CleanCentive] Running costs are above the ceiling',
      recoveredSubject: '[CleanCentive] Running costs are back under the ceiling',
      preheader: 'Projected monthly spend crossed the limit',
      recoveredPreheader: 'Projected monthly spend is back under the limit',
      title: 'Running costs are above the ceiling',
      recoveredTitle: 'Running costs are back under the ceiling',
      intro: (projected, ceiling) =>
        `This month is projected to cost **${projected}**, against a ceiling of ${ceiling}.`,
      recoveredIntro: (projected, ceiling) =>
        `This month is now projected to cost **${projected}**, back under the ${ceiling} ceiling.`,
      breakdownLabel: 'By vendor',
      action: (link) => `See the breakdown: ${link}`,
      disclosure: 'You are receiving this because you are a CleanCentive steward.',
    },
    cleanupFeed: {
      subject: (team: string) => `[CleanCentive] ${team} — cleanups updated`,
      preheader: (created: number, updated: number, archived: number) =>
        `${created} created, ${updated} updated, ${archived} archived`,
      title: (team: string) => `Cleanup feed — ${team}`,
      intro: (source: string) => `The listing at ${source} was refreshed. Here is what changed.`,
      createdLabel: 'Created',
      adoptedLabel: 'Linked to the feed',
      updatedLabel: 'Updated',
      archivedLabel: 'Archived (no longer listed)',
      errorsLabel: 'Needs attention',
      entry: (name: string, when: string) => `${name} — ${when}`,
      errorEntry: (title: string, reason: string) => `${title}: ${reason}`,
      action: (link: string) => `Review them here: ${link}`,
      disclosure: 'You receive this because you are a steward or an organizer of this team.',
    },
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
    detectionAlert: {
      subject: '[CleanCentive] Erkennung braucht Aufmerksamkeit',
      recoveredSubject: '[CleanCentive] Erkennung funktioniert wieder',
      preheader: 'Die Abfallerkennung braucht einen Steward',
      recoveredPreheader: 'Abfallerkennung wiederhergestellt',
      title: 'Erkennung braucht Aufmerksamkeit',
      recoveredTitle: 'Erkennung wiederhergestellt',
      intro: 'Die Abfallerkennung braucht einen Steward, der sich das ansieht.',
      recoveredIntro: 'Die Abfallerkennung funktioniert wieder. Es ist nichts zu tun.',
      reasonLabel: 'Was nicht stimmt',
      reason: (reason) => {
        switch (reason.kind) {
          case 'worker-down':
            return 'Der Erkennungs-Worker meldet keinen Heartbeat';
          case 'retryable-failed':
            return `${reason.count} Spot(s) konnten nicht erkannt werden und lassen sich erneut versuchen`;
          case 'stalled':
            return `${reason.count} Spot(s) warten zu lange auf die Erkennung`;
        }
      },
      action: (link) => `[Betriebsseite öffnen](${link}){button}`,
      disclosure: 'Du erhältst diese Nachricht als CleanCentive-Steward. Sie wird einmal beim Auftreten und einmal bei der Behebung verschickt.',
    },
    costAlert: {
      subject: '[CleanCentive] Betriebskosten über der Obergrenze',
      recoveredSubject: '[CleanCentive] Betriebskosten wieder unter der Obergrenze',
      preheader: 'Die prognostizierten Monatskosten haben das Limit überschritten',
      recoveredPreheader: 'Die prognostizierten Monatskosten liegen wieder unter dem Limit',
      title: 'Betriebskosten über der Obergrenze',
      recoveredTitle: 'Betriebskosten wieder unter der Obergrenze',
      intro: (projected, ceiling) =>
        `Für diesen Monat werden **${projected}** erwartet, bei einer Obergrenze von ${ceiling}.`,
      recoveredIntro: (projected, ceiling) =>
        `Für diesen Monat werden jetzt **${projected}** erwartet, wieder unter der Obergrenze von ${ceiling}.`,
      breakdownLabel: 'Nach Anbieter',
      action: (link) => `Aufschlüsselung ansehen: ${link}`,
      disclosure: 'Du erhältst diese Nachricht, weil du CleanCentive-Steward bist.',
    },
    cleanupFeed: {
      subject: (team: string) => `[CleanCentive] ${team} — Cleanups aktualisiert`,
      preheader: (created: number, updated: number, archived: number) =>
        `${created} erstellt, ${updated} aktualisiert, ${archived} archiviert`,
      title: (team: string) => `Cleanup-Feed — ${team}`,
      intro: (source: string) => `Die Liste unter ${source} wurde aktualisiert. Das hat sich geändert.`,
      createdLabel: 'Erstellt',
      adoptedLabel: 'Mit dem Feed verknüpft',
      updatedLabel: 'Aktualisiert',
      archivedLabel: 'Archiviert (nicht mehr gelistet)',
      errorsLabel: 'Braucht Aufmerksamkeit',
      entry: (name: string, when: string) => `${name} — ${when}`,
      errorEntry: (title: string, reason: string) => `${title}: ${reason}`,
      action: (link: string) => `Hier ansehen: ${link}`,
      disclosure: 'Du erhältst diese E-Mail als Steward oder Organizer dieses Teams.',
    },
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
    detectionAlert: {
      subject: '[CleanCentive] La détection nécessite une intervention',
      recoveredSubject: '[CleanCentive] La détection fonctionne à nouveau',
      preheader: 'La détection de déchets nécessite un steward',
      recoveredPreheader: 'Détection rétablie',
      title: 'La détection nécessite une intervention',
      recoveredTitle: 'Détection rétablie',
      intro: 'La détection de déchets nécessite l’attention d’un steward.',
      recoveredIntro: 'La détection de déchets fonctionne à nouveau. Aucune action n’est requise.',
      reasonLabel: 'Ce qui ne va pas',
      reason: (reason) => {
        switch (reason.kind) {
          case 'worker-down':
            return 'le worker de détection n’émet plus de heartbeat';
          case 'retryable-failed':
            return `${reason.count} spot(s) en échec de détection peuvent être relancés`;
          case 'stalled':
            return `${reason.count} spot(s) attendent la détection depuis trop longtemps`;
        }
      },
      action: (link) => `[Ouvrir la page d’exploitation](${link}){button}`,
      disclosure: 'Vous recevez ce message en tant que steward CleanCentive. Il est envoyé une fois à l’apparition du problème et une fois à sa résolution.',
    },
    costAlert: {
      subject: "[CleanCentive] Les coûts d'exploitation dépassent le plafond",
      recoveredSubject: "[CleanCentive] Les coûts d'exploitation sont repassés sous le plafond",
      preheader: 'Les dépenses mensuelles prévues ont dépassé la limite',
      recoveredPreheader: 'Les dépenses mensuelles prévues sont repassées sous la limite',
      title: "Les coûts d'exploitation dépassent le plafond",
      recoveredTitle: "Les coûts d'exploitation sont repassés sous le plafond",
      intro: (projected, ceiling) =>
        `Ce mois-ci devrait coûter **${projected}**, pour un plafond de ${ceiling}.`,
      recoveredIntro: (projected, ceiling) =>
        `Ce mois-ci devrait maintenant coûter **${projected}**, de nouveau sous le plafond de ${ceiling}.`,
      breakdownLabel: 'Par fournisseur',
      action: (link) => `Voir le détail : ${link}`,
      disclosure: 'Vous recevez ce message parce que vous êtes steward CleanCentive.',
    },
    cleanupFeed: {
      subject: (team: string) => `[CleanCentive] ${team} — cleanups mis à jour`,
      preheader: (created: number, updated: number, archived: number) =>
        `${created} créés, ${updated} mis à jour, ${archived} archivés`,
      title: (team: string) => `Flux de cleanups — ${team}`,
      intro: (source: string) => `La liste sur ${source} a été actualisée. Voici ce qui a changé.`,
      createdLabel: 'Créés',
      adoptedLabel: 'Rattachés au flux',
      updatedLabel: 'Mis à jour',
      archivedLabel: 'Archivés (plus listés)',
      errorsLabel: 'À vérifier',
      entry: (name: string, when: string) => `${name} — ${when}`,
      errorEntry: (title: string, reason: string) => `${title} : ${reason}`,
      action: (link: string) => `À consulter ici : ${link}`,
      disclosure: 'Vous recevez ce message en tant que Steward ou Organizer de ce Team.',
    },
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
