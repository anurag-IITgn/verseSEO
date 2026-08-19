import { and, eq, inArray } from 'drizzle-orm';
import type { CrawlStatus } from '../crawler/types.js';
import { db } from '../db/client.js';
import { crawlRuns } from '../db/schema.js';

export type CrawlRun = typeof crawlRuns.$inferSelect;

const ACTIVE_STATUSES = ['PENDING', 'RUNNING'] as const;

export async function createCrawlRun(projectId: string): Promise<CrawlRun> {
  const [row] = await db.insert(crawlRuns).values({ projectId }).returning();
  if (!row) {
    throw new Error('Failed to create crawl run');
  }
  return row;
}

export async function findCrawlRunById(id: string): Promise<CrawlRun | null> {
  const [row] = await db.select().from(crawlRuns).where(eq(crawlRuns.id, id)).limit(1);
  return row ?? null;
}

export async function findActiveCrawlRunByProject(projectId: string): Promise<CrawlRun | null> {
  const [row] = await db
    .select()
    .from(crawlRuns)
    .where(and(eq(crawlRuns.projectId, projectId), inArray(crawlRuns.status, [...ACTIVE_STATUSES])))
    .limit(1);
  return row ?? null;
}

export async function updateCrawlRunStatus(
  id: string,
  status: CrawlStatus,
  fields?: {
    startedAt?: Date;
    completedAt?: Date;
    robotsFound?: boolean;
    sitemapFound?: boolean;
    healthScore?: number;
    errorMessage?: string | null;
  },
): Promise<void> {
  await db.update(crawlRuns).set({ status, ...fields }).where(eq(crawlRuns.id, id));
}

export async function setCrawlRunSignals(id: string, robotsFound: boolean, sitemapFound: boolean): Promise<void> {
  await db.update(crawlRuns).set({ robotsFound, sitemapFound }).where(eq(crawlRuns.id, id));
}

export async function setCrawlRunCounters(id: string, pagesCrawled: number, pagesDiscovered: number): Promise<void> {
  await db.update(crawlRuns).set({ pagesCrawled, pagesDiscovered }).where(eq(crawlRuns.id, id));
}