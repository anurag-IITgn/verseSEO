import { desc, eq } from 'drizzle-orm';
import type { OpportunityContentBrief } from '../content/types.js';
import { db } from '../db/client.js';
import { contentGenerations, contentRecommendations } from '../db/schema.js';

export type ContentRecommendationRow = typeof contentRecommendations.$inferSelect;
export type NewContentRecommendation = typeof contentRecommendations.$inferInsert;
export type ContentGenerationRow = typeof contentGenerations.$inferSelect;

export async function findRecommendationsByCrawl(crawlId: string): Promise<ContentRecommendationRow[]> {
  return db
    .select()
    .from(contentRecommendations)
    .where(eq(contentRecommendations.crawlRunId, crawlId))
    .orderBy(desc(contentRecommendations.createdAt));
}

export async function insertContentRecommendations(items: NewContentRecommendation[]): Promise<void> {
  if (items.length === 0) return;
  await db.insert(contentRecommendations).values(items);
}

export async function findGenerationByOpportunity(opportunityId: string): Promise<ContentGenerationRow | null> {
  const [row] = await db.select().from(contentGenerations).where(eq(contentGenerations.opportunityId, opportunityId)).limit(1);
  return row ?? null;
}

export async function upsertContentGeneration(input: {
  crawlRunId: string;
  opportunityId: string;
  brief: OpportunityContentBrief;
  title: string;
  intent: string;
  draft: string;
  status: string;
  provider: string;
  model: string;
}): Promise<ContentGenerationRow> {
  const [row] = await db
    .insert(contentGenerations)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: contentGenerations.opportunityId,
      set: {
        crawlRunId: input.crawlRunId,
        brief: input.brief,
        title: input.title,
        intent: input.intent,
        draft: input.draft,
        status: input.status,
        provider: input.provider,
        model: input.model,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) {
    throw new Error('Failed to persist content generation');
  }
  return row;
}