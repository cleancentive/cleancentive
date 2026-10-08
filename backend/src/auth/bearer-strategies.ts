/**
 * The passport strategies a bearer token may satisfy, tried in this order.
 *
 * `pat` goes first because it can tell at a glance whether the token is a
 * personal access token and fails quietly when it is not; `jwt` first would
 * report every token as malformed before `pat` got a look.
 */
export const ACCEPTED_BEARER_STRATEGIES = ['pat', 'jwt'];
