import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { seoIssues } from '../db/schema.js';

export type SeoIssue = typeof seoIssues.$inferSelect;
export type NewSeoIssue = typeof seoIssues.$inferInsert;

export async function findIssuesByCrawl(crawlId: string): Promise<SeoIssue[]> {
  return db.select().from(seoIssues).where(eq(seoIssues.crawlRunId, crawlId)).orderBy(seoIssues.createdAt);
}

export async function countIssuesByCrawl(crawlId: string): Promise<number> {
  const rows = await db.select({ id: seoIssues.id }).from(seoIssues).where(eq(seoIssues.crawlRunId, crawlId));
  return rows.length;
}

export async function deleteIssuesByCrawl(crawlId: string): Promise<void> {
  await db.delete(seoIssues).where(eq(seoIssues.crawlRunId, crawlId));
}

export async function insertSeoIssues(items: NewSeoIssue[]): Promise<void> {
  if (items.length === 0) return;
  await db.insert(seoIssues).values(items);
}