import { analyzeSite } from '../analysis/analyze.js';
import { DEFAULT_SEVERITY, computeTechnicalHealthScore } from '../analysis/rules.js';
import type { IssueType, IssueSeverity } from '../analysis/types.js';
import { db } from '../db/client.js';
import { crawledPages, seoIssues, users } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { findCrawlRunById, updateCrawlRunStatus, type CrawlRun } from '../repositories/crawlRepo.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import { findProjectById } from '../repositories/projectRepo.js';
import { deleteIssuesByCrawl, findIssuesByCrawl, insertSeoIssues, type SeoIssue } from '../repositories/seoRepo.js';
import { AppError } from '../utils/errors.js';
import { toAnalyzablePage } from '../utils/pageAdapter.js';
import { isValidUuid } from '../utils/uuid.js';
import { requireCrawlOwned } from './ownership.js';

export interface AnalysisResultResponse {
  crawlId: string;
  healthScore: number;
  crawlState: string;
  crawlStateReason: string | null;
  dimensions: {
    technicalCorrectness: number;
    metadataQuality: number;
    crawlCoverage: number;
    architecture: number;
    contentPerformance: number;
  };
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
  plan: string;
  headingStats: {
    totalH1: number;
    totalH2: number;
    totalH3: number;
    totalH4: number;
    totalH5: number;
    totalH6: number;
    pagesWithH1: number;
    pagesWithMultipleH1: number;
  };
  imageStats: {
    totalImages: number;
    totalMissingAlt: number;
    pagesWithImages: number;
    pagesWithNoImages: number;
  };
  structuredDataStats: {
    totalJsonLdBlocks: number;
    schemaTypes: string[];
    pagesWithSchema: number;
    pagesWithoutSchema: number;
  };
  socialStats: {
    pagesWithOgTags: number;
    pagesWithTwitterTags: number;
    pagesWithOgImage: number;
    pagesWithTwitterImage: number;
  };
  performanceStats: {
    avgResponseTimeMs: number | null;
    maxResponseTimeMs: number | null;
    minResponseTimeMs: number | null;
    avgWordCount: number | null;
    slowPages: number;
    responseTimeDistribution: Record<string, number>;
  };
  httpStatusDistribution: Record<number, number>;
  serverInfo: {
    servers: string[];
    cdns: string[];
  };
  pageStats: {
    total: number;
    http200: number;
    withTitle: number;
    withMeta: number;
    withCanonical: number;
    withViewport: number;
    withCharset: number;
    withFavicon: number;
    withLang: number;
    indexable: number;
    nonIndexable: number;
    htmlPages: number;
    nonHtmlPages: number;
    thinContent: number;
  };
  titleLengthStats: {
    avg: number | null;
    min: number | null;
    max: number | null;
    tooShort: number;
    tooLong: number;
    missing: number;
  };
  metaLengthStats: {
    avg: number | null;
    missing: number;
  };
  wordCountStats: {
    avg: number | null;
    min: number | null;
    max: number | null;
    thin: number;
    zeroWords: number;
  };
  internalLinkStats: {
    avgLinks: number | null;
    maxLinks: number | null;
    pagesWithZeroLinks: number;
    pagesWithFewLinks: number;
  };
}

async function getHeadingStats(crawlId: string) {
  const [row] = await db
    .select({
      totalH1: sql<number>`coalesce(sum(${crawledPages.h1Count}), 0)::int`,
      totalH2: sql<number>`coalesce(sum(${crawledPages.h2Count}), 0)::int`,
      totalH3: sql<number>`coalesce(sum(${crawledPages.h3Count}), 0)::int`,
      totalH4: sql<number>`coalesce(sum(${crawledPages.h4Count}), 0)::int`,
      totalH5: sql<number>`coalesce(sum(${crawledPages.h5Count}), 0)::int`,
      totalH6: sql<number>`coalesce(sum(${crawledPages.h6Count}), 0)::int`,
      pagesWithH1: sql<number>`count(*) filter (where ${crawledPages.h1Count} > 0)::int`,
      pagesWithMultipleH1: sql<number>`count(*) filter (where ${crawledPages.h1Count} > 1)::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return {
    totalH1: row?.totalH1 ?? 0,
    totalH2: row?.totalH2 ?? 0,
    totalH3: row?.totalH3 ?? 0,
    totalH4: row?.totalH4 ?? 0,
    totalH5: row?.totalH5 ?? 0,
    totalH6: row?.totalH6 ?? 0,
    pagesWithH1: row?.pagesWithH1 ?? 0,
    pagesWithMultipleH1: row?.pagesWithMultipleH1 ?? 0,
  };
}

async function getImageStats(crawlId: string) {
  const [row] = await db
    .select({
      totalImages: sql<number>`coalesce(sum(${crawledPages.imageCount}), 0)::int`,
      totalMissingAlt: sql<number>`coalesce(sum(${crawledPages.imagesMissingAlt}), 0)::int`,
      pagesWithImages: sql<number>`count(*) filter (where ${crawledPages.imageCount} > 0)::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  const total = row?.pagesWithImages ?? 0;
  return {
    totalImages: row?.totalImages ?? 0,
    totalMissingAlt: row?.totalMissingAlt ?? 0,
    pagesWithImages: total,
    pagesWithNoImages: 0,
  };
}

async function getStructuredDataStats(crawlId: string) {
  const rows = await db
    .select({ types: crawledPages.jsonLdTypes })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  const allTypes = new Set<string>();
  let totalBlocks = 0;
  let pagesWithSchema = 0;
  for (const row of rows) {
    if (row.types && row.types.length > 0) {
      totalBlocks += row.types.length;
      pagesWithSchema++;
      for (const t of row.types) allTypes.add(t);
    }
  }
  return {
    totalJsonLdBlocks: totalBlocks,
    schemaTypes: [...allTypes],
    pagesWithSchema,
    pagesWithoutSchema: rows.length - pagesWithSchema,
  };
}

async function getSocialStats(crawlId: string) {
  const [row] = await db
    .select({
      pagesWithOgTags: sql<number>`count(*) filter (where (${crawledPages.ogTitle} is not null and ${crawledPages.ogTitle} != '') or (${crawledPages.ogDescription} is not null and ${crawledPages.ogDescription} != ''))::int`,
      pagesWithTwitterTags: sql<number>`count(*) filter (where (${crawledPages.twitterCard} is not null and ${crawledPages.twitterCard} != ''))::int`,
      pagesWithOgImage: sql<number>`count(*) filter (where ${crawledPages.ogImage} is not null and ${crawledPages.ogImage} != '')::int`,
      pagesWithTwitterImage: sql<number>`count(*) filter (where ${crawledPages.twitterImage} is not null and ${crawledPages.twitterImage} != '')::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return {
    pagesWithOgTags: row?.pagesWithOgTags ?? 0,
    pagesWithTwitterTags: row?.pagesWithTwitterTags ?? 0,
    pagesWithOgImage: row?.pagesWithOgImage ?? 0,
    pagesWithTwitterImage: row?.pagesWithTwitterImage ?? 0,
  };
}

async function getPerformanceStats(crawlId: string) {
  const [row] = await db
    .select({
      avgResponseTimeMs: sql<number>`avg(${crawledPages.responseTimeMs})::int`,
      maxResponseTimeMs: sql<number>`max(${crawledPages.responseTimeMs})::int`,
      minResponseTimeMs: sql<number>`min(${crawledPages.responseTimeMs})::int`,
      avgWordCount: sql<number>`avg(${crawledPages.wordCount})::int`,
      slowPages: sql<number>`count(*) filter (where ${crawledPages.responseTimeMs} > 3000)::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));

  const distRows = await db
    .select({
      bucket: sql<string>`
        case
          when ${crawledPages.responseTimeMs} < 500 then 'under500'
          when ${crawledPages.responseTimeMs} < 1000 then '500to1000'
          when ${crawledPages.responseTimeMs} < 2000 then '1000to2000'
          when ${crawledPages.responseTimeMs} < 3000 then '2000to3000'
          else 'over3000'
        end
      `,
      count: sql<number>`count(*)::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId))
    .groupBy(sql`case
      when ${crawledPages.responseTimeMs} < 500 then 'under500'
      when ${crawledPages.responseTimeMs} < 1000 then '500to1000'
      when ${crawledPages.responseTimeMs} < 2000 then '1000to2000'
      when ${crawledPages.responseTimeMs} < 3000 then '2000to3000'
      else 'over3000'
    end`);

  const responseTimeDistribution: Record<string, number> = {
    under500: 0,
    '500to1000': 0,
    '1000to2000': 0,
    '2000to3000': 0,
    over3000: 0,
  };
  for (const d of distRows) {
    if (d.bucket in responseTimeDistribution) responseTimeDistribution[d.bucket] = d.count;
  }

  return {
    avgResponseTimeMs: row?.avgResponseTimeMs ?? null,
    maxResponseTimeMs: row?.maxResponseTimeMs ?? null,
    minResponseTimeMs: row?.minResponseTimeMs ?? null,
    avgWordCount: row?.avgWordCount ?? null,
    slowPages: row?.slowPages ?? 0,
    responseTimeDistribution,
  };
}

async function getHttpStatusDistribution(crawlId: string) {
  const rows = await db
    .select({
      statusCode: crawledPages.statusCode,
      count: sql<number>`count(*)::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId))
    .groupBy(crawledPages.statusCode);
  const dist: Record<number, number> = {};
  for (const row of rows) {
    if (row.statusCode !== null) dist[row.statusCode] = row.count;
  }
  return dist;
}

async function getServerInfo(crawlId: string) {
  const rows = await db
    .selectDistinct({ serverHeader: crawledPages.serverHeader, cdnHeader: crawledPages.cdnHeader })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  const servers = new Set<string>();
  const cdns = new Set<string>();
  for (const row of rows) {
    if (row.serverHeader) servers.add(row.serverHeader);
    if (row.cdnHeader) cdns.add(row.cdnHeader);
  }
  return { servers: [...servers], cdns: [...cdns] };
}

async function getPageStats(crawlId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      http200: sql<number>`count(*) filter (where ${crawledPages.statusCode} = 200)::int`,
      withTitle: sql<number>`count(*) filter (where ${crawledPages.title} is not null and ${crawledPages.title} != '')::int`,
      withMeta: sql<number>`count(*) filter (where ${crawledPages.metaDescription} is not null and ${crawledPages.metaDescription} != '')::int`,
      withCanonical: sql<number>`count(*) filter (where ${crawledPages.canonicalUrl} is not null and ${crawledPages.canonicalUrl} != '')::int`,
      withViewport: sql<number>`count(*) filter (where ${crawledPages.hasViewport} = true)::int`,
      withCharset: sql<number>`count(*) filter (where ${crawledPages.hasCharset} = true)::int`,
      withFavicon: sql<number>`count(*) filter (where ${crawledPages.hasFavicon} = true)::int`,
      withLang: sql<number>`count(*) filter (where ${crawledPages.htmlLang} is not null and ${crawledPages.htmlLang} != '')::int`,
      indexable: sql<number>`count(*) filter (where ${crawledPages.isIndexable} is not false)::int`,
      nonIndexable: sql<number>`count(*) filter (where ${crawledPages.isIndexable} = false)::int`,
      htmlPages: sql<number>`count(*) filter (where ${crawledPages.contentType} like '%text/html%')::int`,
      nonHtmlPages: sql<number>`count(*) filter (where ${crawledPages.contentType} is null or ${crawledPages.contentType} not like '%text/html%')::int`,
      thinContent: sql<number>`count(*) filter (where ${crawledPages.wordCount} is not null and ${crawledPages.wordCount} < 300)::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return {
    total: row?.total ?? 0,
    http200: row?.http200 ?? 0,
    withTitle: row?.withTitle ?? 0,
    withMeta: row?.withMeta ?? 0,
    withCanonical: row?.withCanonical ?? 0,
    withViewport: row?.withViewport ?? 0,
    withCharset: row?.withCharset ?? 0,
    withFavicon: row?.withFavicon ?? 0,
    withLang: row?.withLang ?? 0,
    indexable: row?.indexable ?? 0,
    nonIndexable: row?.nonIndexable ?? 0,
    htmlPages: row?.htmlPages ?? 0,
    nonHtmlPages: row?.nonHtmlPages ?? 0,
    thinContent: row?.thinContent ?? 0,
  };
}

async function getTitleLengthStats(crawlId: string) {
  const [row] = await db
    .select({
      avg: sql<number>`avg(length(${crawledPages.title}))::int`,
      min: sql<number>`min(length(${crawledPages.title}))::int`,
      max: sql<number>`max(length(${crawledPages.title}))::int`,
      tooShort: sql<number>`count(*) filter (where ${crawledPages.title} is not null and length(${crawledPages.title}) < 30 and ${crawledPages.title} != '')::int`,
      tooLong: sql<number>`count(*) filter (where ${crawledPages.title} is not null and length(${crawledPages.title}) > 60)::int`,
      missing: sql<number>`count(*) filter (where ${crawledPages.title} is null or ${crawledPages.title} = '')::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return {
    avg: row?.avg ?? null,
    min: row?.min ?? null,
    max: row?.max ?? null,
    tooShort: row?.tooShort ?? 0,
    tooLong: row?.tooLong ?? 0,
    missing: row?.missing ?? 0,
  };
}

async function getMetaLengthStats(crawlId: string) {
  const [row] = await db
    .select({
      avg: sql<number>`avg(length(${crawledPages.metaDescription}))::int`,
      missing: sql<number>`count(*) filter (where ${crawledPages.metaDescription} is null or ${crawledPages.metaDescription} = '')::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return {
    avg: row?.avg ?? null,
    missing: row?.missing ?? 0,
  };
}

async function getWordCountStats(crawlId: string) {
  const [row] = await db
    .select({
      avg: sql<number>`avg(${crawledPages.wordCount})::int`,
      min: sql<number>`min(${crawledPages.wordCount})::int`,
      max: sql<number>`max(${crawledPages.wordCount})::int`,
      thin: sql<number>`count(*) filter (where ${crawledPages.wordCount} is not null and ${crawledPages.wordCount} < 300)::int`,
      zeroWords: sql<number>`count(*) filter (where ${crawledPages.wordCount} = 0 or ${crawledPages.wordCount} is null)::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return {
    avg: row?.avg ?? null,
    min: row?.min ?? null,
    max: row?.max ?? null,
    thin: row?.thin ?? 0,
    zeroWords: row?.zeroWords ?? 0,
  };
}

async function getInternalLinkStats(crawlId: string) {
  const [row] = await db
    .select({
      avgLinks: sql<number>`avg(array_length(${crawledPages.internalLinks}, 1))::int`,
      maxLinks: sql<number>`max(array_length(${crawledPages.internalLinks}, 1))::int`,
      pagesWithZeroLinks: sql<number>`count(*) filter (where array_length(${crawledPages.internalLinks}, 1) = 0 or ${crawledPages.internalLinks} is null or array_length(${crawledPages.internalLinks}, 1) = 0)::int`,
      pagesWithFewLinks: sql<number>`count(*) filter (where array_length(${crawledPages.internalLinks}, 1) > 0 and array_length(${crawledPages.internalLinks}, 1) < 3)::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return {
    avgLinks: row?.avgLinks ?? null,
    maxLinks: row?.maxLinks ?? null,
    pagesWithZeroLinks: row?.pagesWithZeroLinks ?? 0,
    pagesWithFewLinks: row?.pagesWithFewLinks ?? 0,
  };
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
    pages.map(toAnalyzablePage),
    { pagesDiscovered: run.pagesDiscovered ?? 0, pagesCrawled: run.pagesCrawled ?? 0 },
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

  return {
    crawlId,
    healthScore: result.healthScore,
    crawlState: result.crawlState,
    crawlStateReason: result.crawlStateReason,
    dimensions: result.dimensions,
    issueCount: result.issueCount,
    issueCounts: result.issueCounts,
  };
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

  // Get user plan
  const [userRow] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
  const plan = userRow?.plan ?? 'free';

  let issues = await findIssuesByCrawl(crawlId);
  if (issues.length === 0) {
    await performAnalysis(crawlId);
    issues = await findIssuesByCrawl(crawlId);
  }

  let healthScore = run.healthScore;
  if (healthScore === null) {
    const project = await findProjectById(run.projectId);
    const pages = await findPagesByCrawl(crawlId);
    const { healthScore: computed } = computeTechnicalHealthScore(
      { websiteUrl: project?.websiteUrl ?? 'https://unknown.com', robotsFound: run.robotsFound ?? false, sitemapFound: run.sitemapFound ?? false },
      pages.map(toAnalyzablePage),
      { pagesDiscovered: run.pagesDiscovered ?? 0, pagesCrawled: run.pagesCrawled ?? 0 },
    );
    healthScore = computed;
  }
  const issueCounts = Object.fromEntries(
    Object.keys(DEFAULT_SEVERITY).map((type) => [type, 0]),
  ) as Record<IssueType, number>;
  for (const issue of issues) {
    issueCounts[issue.issueType as IssueType] += 1;
  }

  const [headingStats, imageStats, structuredDataStats, socialStats, performanceStats, httpStatusDistribution, serverInfo, pageStats, titleLengthStats, metaLengthStats, wordCountStats, internalLinkStats] = await Promise.all([
    getHeadingStats(crawlId),
    getImageStats(crawlId),
    getStructuredDataStats(crawlId),
    getSocialStats(crawlId),
    getPerformanceStats(crawlId),
    getHttpStatusDistribution(crawlId),
    getServerInfo(crawlId),
    getPageStats(crawlId),
    getTitleLengthStats(crawlId),
    getMetaLengthStats(crawlId),
    getWordCountStats(crawlId),
    getInternalLinkStats(crawlId),
  ]);

  return {
    crawl: run,
    pages: await findPagesByCrawl(crawlId),
    issues,
    healthScore,
    issueCount: issues.length,
    issueCounts,
    plan,
    headingStats,
    imageStats,
    structuredDataStats,
    socialStats,
    performanceStats,
    httpStatusDistribution,
    serverInfo,
    pageStats,
    titleLengthStats,
    metaLengthStats,
    wordCountStats,
    internalLinkStats,
  };
}
