export const FEEDBACK_OPEN_STATUSES = ['new', 'acknowledged', 'in_progress'] as const;
export const FEEDBACK_STATUS_QUERY_VALUES = ['open', 'all', 'new', 'acknowledged', 'in_progress', 'resolved'] as const;
export const FEEDBACK_CATEGORY_QUERY_VALUES = ['all', 'bug', 'suggestion', 'question'] as const;

type FeedbackStatusQueryValue = (typeof FEEDBACK_STATUS_QUERY_VALUES)[number];
type FeedbackCategoryQueryValue = (typeof FEEDBACK_CATEGORY_QUERY_VALUES)[number];

export function normalizeFeedbackListQuery(query: {
  status?: string;
  category?: string;
  page?: string;
}): {
  statuses?: readonly string[];
  category?: string;
  page: number;
} {
  const status = query.status as FeedbackStatusQueryValue | undefined;
  const category = query.category as FeedbackCategoryQueryValue | undefined;
  const parsedPage = query.page ? Number.parseInt(query.page, 10) : Number.NaN;

  return {
    statuses:
      !status || status === 'open'
        ? FEEDBACK_OPEN_STATUSES
        : status === 'all'
          ? undefined
          : [status],
    category: !category || category === 'all' ? undefined : category,
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
}
