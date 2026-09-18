/**
 * Text parsing for cleanuptour.ch. The site states a date as a day and a month
 * name — "18 September :" on the German page, "18 septembre :" on the French —
 * and never the year, so the year has to be inferred from its surroundings.
 */

const MONTHS_BY_LANGUAGE: Record<string, string[]> = {
  fr: ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'],
  de: ['januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
};

/** Lower-cased and stripped of accents, so "Février" and "fevrier" agree. */
export function normalizeWord(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function monthFromName(name: string): number | null {
  const normalized = normalizeWord(name);
  for (const months of Object.values(MONTHS_BY_LANGUAGE)) {
    const index = months.indexOf(normalized);
    if (index >= 0) {
      return index + 1;
    }
  }
  return null;
}

/** Reads "18 September :" or "12 avril" into its day and month. */
export function parseDayMonth(text: string): { day: number; month: number } | null {
  const match = /(\d{1,2})\.?\s+([A-Za-zÀ-ÿ]+)/.exec(text);
  if (!match) {
    return null;
  }
  const month = monthFromName(match[2]);
  if (month === null) {
    return null;
  }
  const day = Number(match[1]);
  if (day < 1 || day > 31) {
    return null;
  }
  return { day, month };
}

interface InferYearInput {
  day: number;
  month: number;
  /** Body text of the event page, which sometimes spells the full date out. */
  bodyText: string;
  /** Year from the listing heading, e.g. "Clean-Up Tour 2026". */
  seasonYear: number | null;
  /** When the source last touched the post, and when it first published it. */
  modifiedAt: Date | null;
  publishedAt: Date | null;
}

/**
 * The year the event happens in. A page that spells its date out wins, but only
 * when it is the *event's* date — these pages also carry a registration
 * deadline, which is a different day in the same prose.
 */
export function inferYear(input: InferYearInput): number | null {
  const explicit = explicitYear(input.day, input.month, input.bodyText);
  if (explicit !== null) {
    return explicit;
  }

  const base = input.seasonYear ?? input.publishedAt?.getUTCFullYear() ?? null;
  if (base === null) {
    return null;
  }

  // Sources reuse a page from season to season. If the date we derived sits well
  // before the last edit, the page has been updated for the following edition.
  const reference = input.modifiedAt ?? input.publishedAt;
  if (reference) {
    const candidate = Date.UTC(base, input.month - 1, input.day);
    const sixMonths = 182 * 24 * 60 * 60 * 1000;
    if (candidate < reference.getTime() - sixMonths) {
      return base + 1;
    }
  }
  return base;
}

function explicitYear(day: number, month: number, bodyText: string): number | null {
  const numeric = /\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g;
  for (const match of bodyText.matchAll(numeric)) {
    if (Number(match[1]) === day && Number(match[2]) === month) {
      return Number(match[3]);
    }
  }

  const named = /\b(\d{1,2})\.?\s+([A-Za-zÀ-ÿ]+)\s+(20\d{2})\b/g;
  for (const match of bodyText.matchAll(named)) {
    if (Number(match[1]) === day && monthFromName(match[2]) === month) {
      return Number(match[3]);
    }
  }
  return null;
}

export interface DayTimes {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export const DEFAULT_TIMES: DayTimes = { startHour: 9, startMinute: 0, endHour: 15, endMinute: 0 };

/**
 * First and last clock time in the programme ("08h00 :", "08.00 - 11.30 Uhr",
 * "jusqu'à 15h30"). The trailing guard keeps dates (18.09.2026) and phone
 * numbers out.
 */
export function extractTimes(bodyText: string): DayTimes {
  const pattern = /\b([01]?\d|2[0-3])\s*(?:h\s*([0-5]\d)?|[.:]\s*([0-5]\d))(?![.\d])/g;
  const found: Array<{ hour: number; minute: number }> = [];
  for (const match of bodyText.matchAll(pattern)) {
    found.push({ hour: Number(match[1]), minute: Number(match[2] ?? match[3] ?? 0) });
  }

  if (found.length === 0) {
    return DEFAULT_TIMES;
  }

  const start = found[0];
  // A "time" before dawn or after mid-afternoon as the *start* means we matched
  // something that is not the programme; the defaults are safer than a guess.
  if (start.hour < 5 || start.hour > 14) {
    return DEFAULT_TIMES;
  }

  const last = found.reduce((latest, candidate) =>
    candidate.hour * 60 + candidate.minute > latest.hour * 60 + latest.minute ? candidate : latest,
  );

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = last.hour * 60 + last.minute;
  if (endMinutes <= startMinutes) {
    const fallbackEnd = startMinutes + 6 * 60;
    return {
      startHour: start.hour,
      startMinute: start.minute,
      endHour: Math.min(23, Math.floor(fallbackEnd / 60)),
      endMinute: fallbackEnd % 60,
    };
  }

  return { startHour: start.hour, startMinute: start.minute, endHour: last.hour, endMinute: last.minute };
}
