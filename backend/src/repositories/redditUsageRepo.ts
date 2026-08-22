import { and, eq, gte, sql } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { redditScanUsage } from '../db/schema.js';

export async function recordRedditScan(userId: string, crawlRunId: string): Promise<void> {
  await db.insert(redditScanUsage).values({ userId, crawlRunId });
}

export async function countRedditScansInWindow(userId: string, since: Date): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM reddit_scan_usage
     WHERE user_id = $1 AND scanned_at >= $2`,
    [userId, since.toISOString()],
  );
  return rows[0]?.count ?? 0;
}

export async function deleteRedditScansByCrawl(crawlRunId: string): Promise<void> {
  await db.delete(redditScanUsage).where(eq(redditScanUsage.crawlRunId, crawlRunId));
}
