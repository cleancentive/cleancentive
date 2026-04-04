export const FEEDBACK_STATUSES = ['new', 'acknowledged', 'in_progress', 'resolved'] as const;
export const FEEDBACK_CATEGORY_QUERY_VALUES = ['all', 'bug', 'suggestion', 'question'] as const;

type FeedbackCategoryQueryValue = (typeof FEEDBACK_CATEGORY_QUERY_VALUES)[number];

export function normalizeFeedbackListQuery(query: {
  status?: string;
  category?: string;
  page?: string;
}): {
  statuses?: string[];
  category?: string;
  page: number;
} {
  const category = query.category as FeedbackCategoryQueryValue | undefined;
  const parsedPage = query.page ? Number.parseInt(query.page, 10) : Number.NaN;

  // Comma-separated statuses with OR logic; omit or empty → return all
  const validSet = new Set<string>(FEEDBACK_STATUSES);
  const statuses = query.status
    ? query.status.split(',').map(s => s.trim()).filter(s => validSet.has(s))
    : [];

  return {
    statuses: statuses.length > 0 ? statuses : undefined,
    category: !category || category === 'all' ? undefined : category,
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
}
