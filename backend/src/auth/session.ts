import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'foundable_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}