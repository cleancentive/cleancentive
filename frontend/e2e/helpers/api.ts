/**
 * API helpers for E2E tests
 * Provides functions to interact with the backend API for test setup
 */

const API_BASE = 'http://localhost:3000/api/v1';

export interface User {
  id: string;
  nickname: string;
  full_name: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface UserEmail {
  id: string;
  email: string;
  user_id: string;
  is_selected_for_login: boolean;
}

/**
 * Create a guest user account
 * @returns The created user object with id
 */
export async function createGuestUser(): Promise<User> {
  const response = await fetch(`${API_BASE}/user/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create guest user: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Register an email for a user
 * @param userId - The user's ID
 * @param email - The email address to register
 * @returns The registration result including user, email, and needsMerge flag
 */
export async function registerUserEmail(
  userId: string,
  email: string
): Promise<{ user: User; email: UserEmail; needsMerge: boolean }> {
  const response = await fetch(`${API_BASE}/user/${userId}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to register email: ${response.statusText}`);
  }
  
  return response.json();
}

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

/**
 * Create a test user with an email address
 * Combines createGuestUser and registerUserEmail
 * @param email - Optional email address (generates unique one if not provided)
 * @returns Object with user and email
 */
export async function createTestUserWithEmail(email?: string): Promise<{
  user: User;
  email: UserEmail;
}> {
  const testEmail = email || generateTestEmail();
  const user = await createGuestUser();
  const result = await registerUserEmail(user.id, testEmail);
  
  return {
    user: result.user,
    email: result.email,
  };
}
