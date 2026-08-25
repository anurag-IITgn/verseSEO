import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { subscriptions, users } from '../db/schema.js';

export type SubscriptionRecord = typeof subscriptions.$inferSelect;
export type NewSubscriptionRecord = typeof subscriptions.$inferInsert;

export async function upsertSubscription(input: NewSubscriptionRecord): Promise<SubscriptionRecord> {
  const [row] = await db
    .insert(subscriptions)
    .values(input)
    .onConflictDoUpdate({
      target: subscriptions.providerSubscriptionId,
      set: {
        userId: input.userId,
        plan: input.plan ?? 'pro',
        status: input.status,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) {
    throw new Error('Failed to upsert subscription');
  }

  return row;
}

export async function findSubscriptionsByUserId(userId: string): Promise<SubscriptionRecord[]> {
  return db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
}

export async function findSubscriptionByProviderId(providerSubscriptionId: string): Promise<SubscriptionRecord | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId))
    .limit(1);

  return row ?? null;
}

export async function updateUserPlan(userId: string, plan: 'free' | 'pro' | string): Promise<void> {
  await db
    .update(users)
    .set({
      plan,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}
