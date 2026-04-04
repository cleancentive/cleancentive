import { describe, expect, test } from 'bun:test';

import {
  FEEDBACK_CATEGORY_QUERY_VALUES,
  FEEDBACK_STATUSES,
  normalizeFeedbackListQuery,
} from './feedback-query';

describe('normalizeFeedbackListQuery', () => {
  test('defaults to all feedback (no status filter) on page 1', () => {
    expect(normalizeFeedbackListQuery({})).toEqual({
      statuses: undefined,
      category: undefined,
      page: 1,
    });
  });

  test('accepts a single status', () => {
    expect(normalizeFeedbackListQuery({ status: 'resolved' })).toEqual({
      statuses: ['resolved'],
      category: undefined,
      page: 1,
    });
  });

  test('accepts comma-separated statuses', () => {
    expect(normalizeFeedbackListQuery({ status: 'new,acknowledged' })).toEqual({
      statuses: ['new', 'acknowledged'],
      category: undefined,
      page: 1,
    });
  });

  test('ignores invalid status values in a comma list', () => {
    expect(normalizeFeedbackListQuery({ status: 'new,bogus,resolved' })).toEqual({
      statuses: ['new', 'resolved'],
      category: undefined,
      page: 1,
    });
  });

  test('returns all when every value is invalid', () => {
    expect(normalizeFeedbackListQuery({ status: 'bogus,nope' })).toEqual({
      statuses: undefined,
      category: undefined,
      page: 1,
    });
  });

  test('treats all category as unfiltered', () => {
    expect(normalizeFeedbackListQuery({ category: 'all', page: '2' })).toEqual({
      statuses: undefined,
      category: undefined,
      page: 2,
    });
  });

  test('keeps a specific category filter', () => {
    expect(normalizeFeedbackListQuery({ status: 'resolved', category: 'bug' })).toEqual({
      statuses: ['resolved'],
      category: 'bug',
      page: 1,
    });
  });
});

describe('feedback query values', () => {
  test('exposes status and category values', () => {
    expect(FEEDBACK_STATUSES).toEqual(['new', 'acknowledged', 'in_progress', 'resolved']);
    expect(FEEDBACK_CATEGORY_QUERY_VALUES).toEqual(['all', 'bug', 'suggestion', 'question']);
  });
});
