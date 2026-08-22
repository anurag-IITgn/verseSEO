import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export async function findUserByEmail(email: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function insertUser(input: NewUser): Promise<User> {
  const [row] = await db.insert(users).values(input).returning();
  if (!row) {
    throw new Error('Failed to create user');
  }
  return row;
}

export async function deleteUserById(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}