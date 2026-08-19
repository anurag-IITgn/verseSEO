import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { contentRecommendations } from '../db/schema.js';

export type ContentRecommendationRow = typeof contentRecommendations.$inferSelect;
export type NewContentRecommendation = typeof contentRecommendations.$inferInsert;

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