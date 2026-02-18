/**
 * Mailpit client for E2E tests
 * Provides functions to interact with Mailpit HTTP API for email verification
 * API docs: https://github.com/axllent/mailpit/blob/develop/docs/apiv1/README.md
 */

const MAILPIT_BASE = 'http://localhost:8025/api/v1';

export interface MailpitMessage {
  ID: string;
  From: { Address: string; Name: string };
  To: Array<{ Address: string; Name: string }>;
  Subject: string;
  Created: string;
  Size: number;
  Snippet: string;
}

export interface MailpitMessageDetail extends MailpitMessage {
  HTML: string;
  Text: string;
}

export interface MailpitMessagesResponse {
  total: number;
  messages: MailpitMessage[];
  messages_count: number;
}

/**
 * Clear all messages from Mailpit inbox
 */
export async function clearMailpit(): Promise<void> {
  const response = await fetch(`${MAILPIT_BASE}/messages`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to clear Mailpit: ${response.statusText}`);
  }
}

/**
 * Get all messages from Mailpit
 * @returns List of messages
 */
export async function getAllMessages(): Promise<MailpitMessage[]> {
  const response = await fetch(`${MAILPIT_BASE}/messages`);
  
  if (!response.ok) {
    throw new Error(`Failed to get messages: ${response.statusText}`);
  }
  
  const data: MailpitMessagesResponse = await response.json();
  return data.messages || [];
}

/**
 * Get detailed message content by ID
 * @param messageId - The message ID
 * @returns Full message with HTML and text content
 */
export async function getMessageById(messageId: string): Promise<MailpitMessageDetail> {
  const response = await fetch(`${MAILPIT_BASE}/message/${messageId}`);
  
  if (!response.ok) {
    throw new Error(`Failed to get message ${messageId}: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Wait for an email to arrive at a specific address
 * Polls Mailpit for up to maxWaitMs milliseconds
 * @param toAddress - The recipient email address to wait for
 * @param maxWaitMs - Maximum time to wait in milliseconds (default: 10000)
 * @param pollIntervalMs - Time between poll attempts (default: 500)
 * @returns The message detail including HTML content
 */
export async function waitForEmail(
  toAddress: string,
  maxWaitMs = 10000,
  pollIntervalMs = 500
): Promise<MailpitMessageDetail> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const messages = await getAllMessages();
    const matchingMessage = messages.find(msg => 
      msg.To.some(to => to.Address.toLowerCase() === toAddress.toLowerCase())
    );
    
    if (matchingMessage) {
      return getMessageById(matchingMessage.ID);
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  throw new Error(`No email received at ${toAddress} within ${maxWaitMs}ms`);
}

/**
 * Extract magic link URL from email HTML content
 * Looks for href containing '/auth/verify?token='
 * @param html - The HTML content of the email
 * @returns The magic link URL, or null if not found
 */
export function extractMagicLink(html: string): string | null {
  // Match href="..." or href='...' containing /auth/verify?token=
  const hrefRegex = /href=["']([^"']*\/auth\/verify\?token=[^"']*)["']/i;
  const match = html.match(hrefRegex);
  
  if (match && match[1]) {
    return match[1];
  }
  
  // Fallback: look for plain URL in text
  const urlRegex = /(https?:\/\/[^\s]+\/auth\/verify\?token=[^\s<>"']+)/i;
  const urlMatch = html.match(urlRegex);
  
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  
  return null;
}

/**
 * Get the latest email sent to a specific address
 * @param toAddress - The recipient email address
 * @returns The latest message detail, or null if no messages found
 */
export async function getLatestEmailTo(toAddress: string): Promise<MailpitMessageDetail | null> {
  const messages = await getAllMessages();
  const matchingMessages = messages.filter(msg =>
    msg.To.some(to => to.Address.toLowerCase() === toAddress.toLowerCase())
  );
  
  if (matchingMessages.length === 0) {
    return null;
  }
  
  // Sort by created date descending and get the first one
  matchingMessages.sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
  return getMessageById(matchingMessages[0].ID);
}
