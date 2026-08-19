import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { crawledPages } from '../db/schema.js';

export type NewCrawledPage = typeof crawledPages.$inferInsert;
export type CrawledPageRow = typeof crawledPages.$inferSelect;

export async function insertCrawledPage(input: NewCrawledPage): Promise<void> {
  await db.insert(crawledPages).values(input);
}

export async function findPagesByCrawl(crawlId: string): Promise<CrawledPageRow[]> {
  return db.select().from(crawledPages).where(eq(crawledPages.crawlRunId, crawlId));
}