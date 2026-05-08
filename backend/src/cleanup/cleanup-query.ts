export const CLEANUP_STATUSES = ['past', 'ongoing', 'future'] as const;
export type CleanupStatus = (typeof CLEANUP_STATUSES)[number];

export function parseCleanupStatuses(raw: string | undefined): CleanupStatus[] | undefined {
  if (!raw) return undefined;
  const validSet = new Set<string>(CLEANUP_STATUSES);
  const statuses = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is CleanupStatus => validSet.has(s));
  return statuses.length > 0 ? statuses : undefined;
}
