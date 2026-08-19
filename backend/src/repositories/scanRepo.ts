import { and, desc, eq } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { crawlRuns } from '../db/schema.js';

export type CrawlRun = typeof crawlRuns.$inferSelect;

export interface ScanModuleCounts {
  issueCount: number;
  issueCounts: Record<string, number>;
  opportunities: number;
  reddit: number;
  content: number;
  aiVisibility: { total: number; mentioned: number; cited: number; score: number } | null;
}

export async function findCompletedRunsByProject(projectId: string): Promise<CrawlRun[]> {
  return db
    .select()
    .from(crawlRuns)
    .where(and(eq(crawlRuns.projectId, projectId), eq(crawlRuns.status, 'COMPLETED')))
    .orderBy(desc(crawlRuns.createdAt));
}

export async function findRunsByProject(projectId: string): Promise<CrawlRun[]> {
  return db
    .select()
    .from(crawlRuns)
    .where(eq(crawlRuns.projectId, projectId))
    .orderBy(desc(crawlRuns.createdAt));
}

export async function findScanModuleCounts(crawlId: string): Promise<ScanModuleCounts> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM seo_issues WHERE crawl_run_id = $1)::int AS issue_count,
       (SELECT COUNT(*) FROM search_opportunities WHERE crawl_run_id = $1)::int AS opportunities,
       (SELECT COUNT(*) FROM reddit_discussions WHERE crawl_run_id = $1)::int AS reddit,
       (SELECT COUNT(*) FROM content_recommendations WHERE crawl_run_id = $1)::int AS content,
       (SELECT COUNT(*) FROM ai_visibility_results WHERE crawl_run_id = $1)::int AS ai_total,
       (SELECT COUNT(*) FROM ai_visibility_results WHERE crawl_run_id = $1 AND mentioned)::int AS ai_mentioned,
       (SELECT COUNT(*) FROM ai_visibility_results WHERE crawl_run_id = $1 AND cited)::int AS ai_cited,
       (SELECT AVG(visibility_score) FROM ai_visibility_results WHERE crawl_run_id = $1)::float8 AS ai_score`,
    [crawlId],
  );
  const row = rows[0];
  const issueCounts = await findIssueCountsByCrawl(crawlId);
  const aiTotal = row.ai_total ?? 0;
  return {
    issueCount: row.issue_count,
    issueCounts,
    opportunities: row.opportunities,
    reddit: row.reddit,
    content: row.content,
    aiVisibility:
      aiTotal > 0
        ? {
            total: aiTotal,
            mentioned: row.ai_mentioned ?? 0,
            cited: row.ai_cited ?? 0,
            score: row.ai_score === null ? 0 : Math.round(row.ai_score),
          }
        : null,
  };
}

async function findIssueCountsByCrawl(crawlId: string): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    'SELECT issue_type AS type, COUNT(*)::int AS count FROM seo_issues WHERE crawl_run_id = $1 GROUP BY issue_type',
    [crawlId],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.type] = row.count;
  }
  return counts;
}