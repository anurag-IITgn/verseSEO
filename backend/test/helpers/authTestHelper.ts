import type { InjectOptions } from 'light-my-request';
import { SESSION_COOKIE_NAME } from '../../src/auth/session.js';
import { db } from '../../src/db/client.js';
import { users } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

export interface TestUser {
  userId: string;
  email: string;
  sessionToken: string;
}

function extractSessionToken(setCookie: string | string[] | undefined): string {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const match = header.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    if (match) {
      return match[1];
    }
  }
  throw new Error('No session cookie was returned');
}

export async function registerUser(app: any, email: string, password = 'password123'): Promise<TestUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password },
  });
  if (res.statusCode !== 201) {
    throw new Error(`Registration failed with ${res.statusCode}: ${res.body}`);
  }
  const body = res.json();
  return {
    userId: body.user.id,
    email: body.user.email,
    sessionToken: extractSessionToken(res.headers['set-cookie']),
  };
}

export async function setUserPlan(userId: string, plan: string): Promise<void> {
  await db.update(users).set({ plan }).where(eq(users.id, userId));
}

export function injectAs(sessionToken: string, options: InjectOptions): InjectOptions {
  return {
    ...options,
    cookies: { ...(options.cookies as Record<string, string> | undefined), [SESSION_COOKIE_NAME]: sessionToken },
  };
}