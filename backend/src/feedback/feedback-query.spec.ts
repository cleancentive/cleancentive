import { describe, expect, test } from 'bun:test';

import {
  FEEDBACK_CATEGORY_QUERY_VALUES,
  FEEDBACK_OPEN_STATUSES,
  FEEDBACK_STATUS_QUERY_VALUES,
  normalizeFeedbackListQuery,
} from './feedback-query';

describe('normalizeFeedbackListQuery', () => {
  test('defaults to open feedback on page 1', () => {
    expect(normalizeFeedbackListQuery({})).toEqual({
      statuses: FEEDBACK_OPEN_STATUSES,
      category: undefined,
      page: 1,
    });
  });

  test('treats all category and all status as unfiltered', () => {
    expect(normalizeFeedbackListQuery({ status: 'all', category: 'all', page: '2' })).toEqual({
      statuses: undefined,
      category: undefined,
      page: 2,
    });
  });

  test('keeps a specific resolved status filter', () => {
    expect(normalizeFeedbackListQuery({ status: 'resolved', category: 'bug' })).toEqual({
      statuses: ['resolved'],
      category: 'bug',
      page: 1,
    });
  });
});

describe('feedback query values', () => {
  test('exposes status and category values for Swagger dropdowns', () => {
    expect(FEEDBACK_STATUS_QUERY_VALUES).toEqual(['open', 'all', 'new', 'acknowledged', 'in_progress', 'resolved']);
    expect(FEEDBACK_CATEGORY_QUERY_VALUES).toEqual(['all', 'bug', 'suggestion', 'question']);
  });
});
