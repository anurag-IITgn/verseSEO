import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tokens } from '../db/schema.js';

export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;

export async function insertToken(input: NewToken): Promise<Token> {
  const [row] = await db.insert(tokens).values(input).returning();
  if (!row) {
    throw new Error('Failed to create token');
  }
  return row;
}

export async function findValidToken(tokenHash: string, type: string): Promise<Token | null> {
  const [row] = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.tokenHash, tokenHash), eq(tokens.type, type), isNull(tokens.usedAt)))
    .limit(1);
  return row ?? null;
}

export async function consumeToken(id: string): Promise<void> {
  await db.update(tokens).set({ usedAt: new Date() }).where(eq(tokens.id, id));
}

export async function deleteTokensByUserAndType(userId: string, type: string): Promise<void> {
  await db.delete(tokens).where(and(eq(tokens.userId, userId), eq(tokens.type, type)));
}

export async function deleteExpiredTokens(): Promise<void> {
  const now = new Date();
  const allTokens = await db.select().from(tokens);
  for (const token of allTokens) {
    if (token.expiresAt.getTime() <= now.getTime()) {
      await db.delete(tokens).where(eq(tokens.id, token.id));
    }
  }
}
