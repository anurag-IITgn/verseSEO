import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sessions } from '../db/schema.js';

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export async function insertSession(input: NewSession): Promise<Session> {
  const [row] = await db.insert(sessions).values(input).returning();
  if (!row) {
    throw new Error('Failed to create session');
  }
  return row;
}

export async function findSessionByTokenHash(tokenHash: string): Promise<Session | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  return row ?? null;
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(eq(sessions.expiresAt, new Date(0)));
}