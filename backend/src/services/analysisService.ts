import { analyzeSite } from '../analysis/analyze.js';
import { calculateHealthScore, DEFAULT_SEVERITY } from '../analysis/rules.js';
import type { IssueType, IssueSeverity } from '../analysis/types.js';
import { db } from '../db/client.js';
import { seoIssues } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { findCrawlRunById, updateCrawlRunStatus, type CrawlRun } from '../repositories/crawlRepo.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import { findProjectById } from '../repositories/projectRepo.js';
import { deleteIssuesByCrawl, findIssuesByCrawl, insertSeoIssues, type SeoIssue } from '../repositories/seoRepo.js';
import { AppError } from '../utils/errors.js';
import { isValidUuid } from '../utils/uuid.js';
import { requireCrawlOwned } from './ownership.js';

export interface AnalysisResultResponse {
  crawlId: string;
  healthScore: number;
  issueCount: number;
  issueCounts: Record<IssueType, number>;
}

export interface CrawlResultsResponse {
  crawl: CrawlRun;
  pages: CrawledPageRow[];
  issues: SeoIssue[];
  healthScore: number | null;
  issueCount: number;
  issueCounts: Record<IssueType, number>;
}

/**
 * Runs the deterministic SEO analysis for a crawl and replaces any existing
 * issues for that crawl. Re-running is safe: it never produces duplicates.
 */
export async function performAnalysis(crawlId: string): Promise<AnalysisResultResponse> {
  const run = await findCrawlRunById(crawlId);
  if (!run) {
    throw new AppError(404, 'Crawl run not found', 'CRAWL_NOT_FOUND');
  }

  const project = await findProjectById(run.projectId);
  if (!project) {
    throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
  }

  const pages = await findPagesByCrawl(crawlId);
  const result = analyzeSite(
    {
      websiteUrl: project.websiteUrl,
      robotsFound: run.robotsFound ?? false,
      sitemapFound: run.sitemapFound ?? false,
    },
    pages.map((page) => ({
      id: page.id,
      url: page.url,
      statusCode: page.statusCode,
      contentType: page.contentType,
      title: page.title,
      metaDescription: page.metaDescription,
      canonicalUrl: page.canonicalUrl,
      robotsDirective: page.robotsDirective,
      isIndexable: page.isIndexable,
      wordCount: page.wordCount,
      responseTimeMs: page.responseTimeMs,
      internalLinks: page.internalLinks ?? [],
    })),
  );

  const rows = result.issues.map((i) => ({
    crawlRunId: crawlId,
    pageId: i.pageId,
    issueType: i.issueType,
    severity: i.severity,
    message: i.message,
  }));

  await db.transaction(async (tx) => {
    await tx.delete(seoIssues).where(eq(seoIssues.crawlRunId, crawlId));
    if (rows.length > 0) {
      await tx.insert(seoIssues).values(rows);
    }
  });

  return { crawlId, healthScore: result.healthScore, issueCount: result.issueCount, issueCounts: result.issueCounts };
}

export async function analyzeCrawl(userId: string, crawlId: string): Promise<AnalysisResultResponse> {
  if (!isValidUuid(crawlId)) {
    throw new AppError(400, 'Invalid crawl id', 'INVALID_CRAWL_ID');
  }

  await requireCrawlOwned(userId, crawlId);

  const run = await findCrawlRunById(crawlId);
  if (!run) {
    throw new AppError(404, 'Crawl run not found', 'CRAWL_NOT_FOUND');
  }
  if (run.status !== 'COMPLETED') {
    throw new AppError(409, 'Crawl run is not completed', 'CRAWL_NOT_COMPLETED');
  }

  const result = await performAnalysis(crawlId);
  await updateCrawlRunStatus(crawlId, 'COMPLETED', { healthScore: result.healthScore });
  return result;
}

export async function getCrawlResults(userId: string, crawlId: string): Promise<CrawlResultsResponse> {
  if (!isValidUuid(crawlId)) {
    throw new AppError(400, 'Invalid crawl id', 'INVALID_CRAWL_ID');
  }

  await requireCrawlOwned(userId, crawlId);

  const run = await findCrawlRunById(crawlId);
  if (!run) {
    throw new AppError(404, 'Crawl run not found', 'CRAWL_NOT_FOUND');
  }
  if (run.status !== 'COMPLETED') {
    throw new AppError(409, 'Crawl run is not completed', 'CRAWL_NOT_COMPLETED');
  }

  let issues = await findIssuesByCrawl(crawlId);
  if (issues.length === 0) {
    await performAnalysis(crawlId);
    issues = await findIssuesByCrawl(crawlId);
  }

  const healthScore = run.healthScore ?? calculateHealthScore(issues.map((i) => ({ severity: i.severity as IssueSeverity })));
  const issueCounts = Object.fromEntries(
    Object.keys(DEFAULT_SEVERITY).map((type) => [type, 0]),
  ) as Record<IssueType, number>;
  for (const issue of issues) {
    issueCounts[issue.issueType as IssueType] += 1;
  }
  return {
    crawl: run,
    pages: await findPagesByCrawl(crawlId),
    issues,
    healthScore,
    issueCount: issues.length,
    issueCounts,
  };
}