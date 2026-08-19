import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { aiVisibilityResults } from '../db/schema.js';

export type AiVisibilityRow = typeof aiVisibilityResults.$inferSelect;
export type NewAiVisibilityResult = typeof aiVisibilityResults.$inferInsert;

export async function findAiVisibilityResultsByCrawl(crawlId: string): Promise<AiVisibilityRow[]> {
  return db
    .select()
    .from(aiVisibilityResults)
    .where(eq(aiVisibilityResults.crawlRunId, crawlId))
    .orderBy(desc(aiVisibilityResults.visibilityScore));
}

export async function insertAiVisibilityResults(items: NewAiVisibilityResult[]): Promise<void> {
  if (items.length === 0) return;
  await db.insert(aiVisibilityResults).values(items);
}