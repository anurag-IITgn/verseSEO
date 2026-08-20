import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { searchOpportunities } from '../db/schema.js';

export type SearchOpportunityRow = typeof searchOpportunities.$inferSelect;
export type NewSearchOpportunity = typeof searchOpportunities.$inferInsert;

export async function findOpportunitiesByCrawl(crawlId: string): Promise<SearchOpportunityRow[]> {
  return db
    .select()
    .from(searchOpportunities)
    .where(eq(searchOpportunities.crawlRunId, crawlId))
    .orderBy(asc(searchOpportunities.score), asc(searchOpportunities.id));
}

export async function findOpportunityById(id: string): Promise<SearchOpportunityRow | null> {
  const [row] = await db.select().from(searchOpportunities).where(eq(searchOpportunities.id, id)).limit(1);
  return row ?? null;
}

export async function insertSearchOpportunities(items: NewSearchOpportunity[]): Promise<void> {
  if (items.length === 0) return;
  await db.insert(searchOpportunities).values(items);
}