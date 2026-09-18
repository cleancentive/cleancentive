/**
 * API helpers for E2E tests
 * Provides functions to interact with the backend API for test setup
 */

const API_BASE = 'http://localhost:3000/api/v1';

/**
 * Request a magic link to be sent to an email address
 * @param email - The email address to send the magic link to
 * @returns void (API returns 201 on success, no body)
 */
export async function requestMagicLink(email: string): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error(`Failed to request magic link: ${response.statusText}`);
  }
}

/**
 * Generate a unique test email address
 * @param prefix - Optional prefix for the email (default: 'test')
 * @returns A unique email address like 'test-1234567890@example.com'
 */
export function generateTestEmail(prefix = 'test'): string {
  return `${prefix}-${Date.now()}@example.com`;
}
