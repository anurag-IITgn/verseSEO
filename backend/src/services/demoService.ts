import { and, eq, sql } from 'drizzle-orm';
import type { AnalyzablePage } from '../analysis/types.js';
import { AiUnavailableError } from '../ai/errors.js';
import { analyzeMention } from '../ai/mentionDetection.js';
import { selectAiPrompts } from '../ai/prompts.js';
import { getAiProvider } from '../ai/registry.js';
import { scoreVisibility } from '../ai/scoring.js';
import { env } from '../config/env.js';
import { crawlSite } from '../crawler/crawler.js';
import { FetchError } from '../crawler/http.js';
import type { CrawlSiteConfig, CrawlerSink } from '../crawler/types.js';
import { db } from '../db/client.js';
import { aiVisibilityResults, crawledPages, seoIssues } from '../db/schema.js';
import { createCrawlRun, setCrawlRunCounters, setCrawlRunSignals, updateCrawlRunStatus } from '../repositories/crawlRepo.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import { insertCrawledPage } from '../repositories/pageRepo.js';
import { insertProject, deleteProjectById } from '../repositories/projectRepo.js';
import { extractTopics } from '../search/extract.js';
import { AppError } from '../utils/errors.js';
import { toAnalyzablePage } from '../utils/pageAdapter.js';
import { assertPublicTargetUrl } from '../utils/ssrfGuard.js';
import { performAnalysis } from './analysisService.js';

function reasonFor(input: {
  mentioned: boolean;
  cited: boolean;
  stance: string;
  topic: string;
  domain: string;
  empty: boolean;
}): string {
  if (input.empty) return `The model returned an empty response for "${input.topic}".`;
  if (!input.mentioned) return `"${input.domain}" was not mentioned in the answer to "${input.topic}".`;
  if (input.cited) return `"${input.domain}" was mentioned and linked in the answer to "${input.topic}".`;
  return `"${input.domain}" appeared in the answer to "${input.topic}" (${input.stance}).`;
}

function displayFromRaw(raw: number): number {
  return Math.min(75, Math.max(15, Math.round(raw / 5) * 5));
}

export interface DemoAiResult {
  status: 'ok' | 'unavailable';
  reason: string | null;
  message: string | null;
  overallVisibilityScore: number;
  displayScore: number;
  mentionedCount: number;
  citedCount: number;
  recommendationCount: number;
  queryCount: number;
  topCompetitors: string[];
  results: Array<{
    topic: string;
    mentioned: boolean;
    cited: boolean;
    stance: string;
    visibilityScore: number;
    reason: string;
    competitors: string[];
  }>;
}

async function runDemoAiVisibility(crawlId: string, domain: string): Promise<DemoAiResult> {
  const provider = getAiProvider();
  if (!provider) {
    return {
      status: 'unavailable',
      reason: 'NOT_CONFIGURED',
      message: 'AI visibility is not connected.',
      overallVisibilityScore: 0,
      displayScore: displayFromRaw(0),
      mentionedCount: 0,
      citedCount: 0,
      recommendationCount: 0,
      queryCount: 0,
      topCompetitors: [],
      results: [],
    };
  }

  const pages = await findPagesByCrawl(crawlId);
  const analyzablePages = pages.map(toAnalyzablePage);
  const topicsAnalyzed = extractTopics(analyzablePages).topics.size;
  const prompts = selectAiPrompts(analyzablePages);

  if (prompts.length === 0) {
    return {
      status: 'ok',
      reason: null,
      message: null,
      overallVisibilityScore: 0,
      displayScore: displayFromRaw(0),
      mentionedCount: 0,
      citedCount: 0,
      recommendationCount: 0,
      queryCount: 0,
      topCompetitors: [],
      results: [],
    };
  }

  const rows: (typeof aiVisibilityResults.$inferInsert)[] = [];
  try {
    for (const entry of prompts) {
      const raw = await provider.generate(entry.prompt);
      const empty = raw.trim() === '';
      const analysis = empty
        ? { mentioned: false, cited: false, stance: 'absent' as const, competitors: [] }
        : analyzeMention(raw, domain);
      const scored = scoreVisibility(analysis);
      rows.push({
        crawlRunId: crawlId,
        prompt: entry.prompt,
        provider: provider.name,
        model: provider.model,
        rawResponse: empty ? '' : raw,
        mentioned: scored.mentioned,
        cited: scored.cited,
        stance: scored.stance,
        visibilityScore: scored.visibilityScore,
        reason: reasonFor({
          mentioned: scored.mentioned,
          cited: scored.cited,
          stance: scored.stance,
          topic: entry.topic,
          domain,
          empty,
        }),
        competitors: scored.stance === 'absent' ? [] : analysis.competitors,
      });
    }
  } catch (error) {
    const message = error instanceof AiUnavailableError ? error.message : 'AI visibility is temporarily unavailable.';
    return {
      status: 'unavailable',
      reason: 'PROVIDER_ERROR',
      message,
      overallVisibilityScore: 0,
      displayScore: displayFromRaw(0),
      mentionedCount: 0,
      citedCount: 0,
      recommendationCount: 0,
      queryCount: 0,
      topCompetitors: [],
      results: [],
    };
  }

  if (rows.length > 0) {
    await db.transaction(async (tx) => {
      await tx.delete(aiVisibilityResults).where(eq(aiVisibilityResults.crawlRunId, crawlId));
      await tx.insert(aiVisibilityResults).values(rows);
    });
  }

  const mentionedCount = rows.filter((r) => r.mentioned).length;
  const citedCount = rows.filter((r) => r.cited).length;
  const recommendationCount = rows.filter((r) => r.stance === 'recommendation').length;
  const overallVisibilityScore =
    rows.length === 0 ? 0 : Math.round(rows.reduce((sum, r) => sum + (r.visibilityScore ?? 0), 0) / rows.length);

  const allCompetitors = rows.flatMap((r) => r.competitors ?? []);
  const competitorCounts = new Map<string, number>();
  for (const c of allCompetitors) {
    competitorCounts.set(c, (competitorCounts.get(c) ?? 0) + 1);
  }
  const topCompetitors = [...competitorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([host]) => host);

  return {
    status: 'ok',
    reason: null,
    message: null,
    overallVisibilityScore,
    displayScore: displayFromRaw(overallVisibilityScore),
    mentionedCount,
    citedCount,
    recommendationCount,
    queryCount: rows.length,
    topCompetitors,
    results: rows.map((r) => {
      const promptText: string = r.prompt;
      const topicMatch = promptText.match(/"([^"]+)"\??\s*$/);
      const topic = topicMatch ? topicMatch[1] : promptText;
      return {
        topic,
        mentioned: r.mentioned,
        cited: r.cited,
        stance: r.stance,
        visibilityScore: r.visibilityScore,
        reason: r.reason,
        competitors: r.competitors ?? [],
      };
    }),
  };
}

export interface DemoScanResult {
  projectId: string;
  crawlId: string;
  status: 'COMPLETED' | 'FAILED';
  errorMessage?: string;
  tech: {
    healthScore: number | null;
    pagesCrawled: number;
    pagesDiscovered: number;
    robotsFound: boolean | null;
    sitemapFound: boolean | null;
    issueCount: number;
    issueCounts: Record<string, number>;
    issues: Array<{ issueType: string; severity: string; message: string }>;
    pageStats: {
      total: number;
      http200: number;
      withTitle: number;
      withMetaDescription: number;
      withCanonical: number;
    };
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
    };
    structuredDataStats: {
      totalJsonLdBlocks: number;
      schemaTypes: string[];
    };
    socialStats: {
      pagesWithOgTags: number;
      pagesWithTwitterTags: number;
    };
    performanceStats: {
      avgResponseTimeMs: number | null;
      maxResponseTimeMs: number | null;
      avgWordCount: number | null;
    };
    httpStatusDistribution: Record<number, number>;
    serverInfo: {
      servers: string[];
      cdns: string[];
    };
  } | null;
  ai: DemoAiResult | null;
}

async function getPageStats(crawlId: string): Promise<{
  total: number;
  http200: number;
  withTitle: number;
  withMetaDescription: number;
  withCanonical: number;
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      http200: sql<number>`count(*) filter (where ${crawledPages.statusCode} = 200)::int`,
      withTitle: sql<number>`count(*) filter (where ${crawledPages.title} is not null and ${crawledPages.title} != '')::int`,
      withMetaDescription: sql<number>`count(*) filter (where ${crawledPages.metaDescription} is not null and ${crawledPages.metaDescription} != '')::int`,
      withCanonical: sql<number>`count(*) filter (where ${crawledPages.canonicalUrl} is not null and ${crawledPages.canonicalUrl} != '')::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));

  return {
    total: row?.total ?? 0,
    http200: row?.http200 ?? 0,
    withTitle: row?.withTitle ?? 0,
    withMetaDescription: row?.withMetaDescription ?? 0,
    withCanonical: row?.withCanonical ?? 0,
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
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return { totalImages: row?.totalImages ?? 0, totalMissingAlt: row?.totalMissingAlt ?? 0 };
}

async function getStructuredDataStats(crawlId: string) {
  const rows = await db.select({ types: crawledPages.jsonLdTypes }).from(crawledPages).where(eq(crawledPages.crawlRunId, crawlId));
  const allTypes = new Set<string>();
  let totalBlocks = 0;
  for (const row of rows) {
    if (row.types && row.types.length > 0) {
      totalBlocks += row.types.length;
      for (const t of row.types) allTypes.add(t);
    }
  }
  return { totalJsonLdBlocks: totalBlocks, schemaTypes: [...allTypes] };
}

async function getSocialStats(crawlId: string) {
  const [row] = await db
    .select({
      pagesWithOgTags: sql<number>`count(*) filter (where (${crawledPages.ogTitle} is not null and ${crawledPages.ogTitle} != '') or (${crawledPages.ogDescription} is not null and ${crawledPages.ogDescription} != ''))::int`,
      pagesWithTwitterTags: sql<number>`count(*) filter (where (${crawledPages.twitterCard} is not null and ${crawledPages.twitterCard} != ''))::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return { pagesWithOgTags: row?.pagesWithOgTags ?? 0, pagesWithTwitterTags: row?.pagesWithTwitterTags ?? 0 };
}

async function getPerformanceStats(crawlId: string) {
  const [row] = await db
    .select({
      avgResponseTimeMs: sql<number>`avg(${crawledPages.responseTimeMs})::int`,
      maxResponseTimeMs: sql<number>`max(${crawledPages.responseTimeMs})::int`,
      avgWordCount: sql<number>`avg(${crawledPages.wordCount})::int`,
    })
    .from(crawledPages)
    .where(eq(crawledPages.crawlRunId, crawlId));
  return { avgResponseTimeMs: row?.avgResponseTimeMs ?? null, maxResponseTimeMs: row?.maxResponseTimeMs ?? null, avgWordCount: row?.avgWordCount ?? null };
}

async function getHttpStatusDistribution(crawlId: string) {
  const rows = await db.select({ statusCode: crawledPages.statusCode, count: sql<number>`count(*)::int` }).from(crawledPages).where(eq(crawledPages.crawlRunId, crawlId)).groupBy(crawledPages.statusCode);
  const dist: Record<number, number> = {};
  for (const row of rows) { if (row.statusCode !== null) dist[row.statusCode] = row.count; }
  return dist;
}

async function getServerInfo(crawlId: string) {
  const rows = await db.selectDistinct({ serverHeader: crawledPages.serverHeader, cdnHeader: crawledPages.cdnHeader }).from(crawledPages).where(eq(crawledPages.crawlRunId, crawlId));
  const servers = new Set<string>();
  const cdns = new Set<string>();
  for (const row of rows) { if (row.serverHeader) servers.add(row.serverHeader); if (row.cdnHeader) cdns.add(row.cdnHeader); }
  return { servers: [...servers], cdns: [...cdns] };
}

export async function runDemoScan(websiteUrl: string): Promise<DemoScanResult> {
  if (!env.CRAWL_ALLOW_PRIVATE_NETWORKS) {
    await assertPublicTargetUrl(websiteUrl);
  }

  const domain = websiteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./i, '');

  const project = await insertProject({
    userId: null,
    name: null,
    websiteUrl,
    domain,
  });

  try {
    const run = await createCrawlRun(project.id);

    await updateCrawlRunStatus(run.id, 'RUNNING', { startedAt: new Date() });

    const config: CrawlSiteConfig = {
      websiteUrl: project.websiteUrl,
      domain: project.domain,
      maxPages: Math.min(env.MAX_PAGES, 30),
      timeoutMs: env.CRAWL_TIMEOUT_MS,
      userAgent: env.CRAWL_USER_AGENT,
    };

    const sink: CrawlerSink = {
      savePage: (page) => insertCrawledPage({ ...page, crawlRunId: run.id }),
      updateCounters: (pagesCrawled, pagesDiscovered) => setCrawlRunCounters(run.id, pagesCrawled, pagesDiscovered),
    };

    const summary = await crawlSite(config, sink);

    if (summary.pagesCrawled === 0) {
      await updateCrawlRunStatus(run.id, 'FAILED', {
        completedAt: new Date(),
        errorMessage: 'Crawl failed: no pages could be fetched',
      });
      return {
        projectId: project.id,
        crawlId: run.id,
        status: 'FAILED',
        errorMessage: 'Crawl failed: no pages could be fetched',
        tech: null,
        ai: null,
      };
    }

    await setCrawlRunSignals(run.id, summary.robotsFound, summary.sitemapFound);

    const analysis = await performAnalysis(run.id);

    await updateCrawlRunStatus(run.id, 'COMPLETED', {
      completedAt: new Date(),
      healthScore: analysis.healthScore,
    });

    const issues = await db
      .select()
      .from(seoIssues)
      .where(eq(seoIssues.crawlRunId, run.id));

    const pageStats = await getPageStats(run.id);
    const headingStats = await getHeadingStats(run.id);
    const imageStats = await getImageStats(run.id);
    const structuredDataStats = await getStructuredDataStats(run.id);
    const socialStats = await getSocialStats(run.id);
    const performanceStats = await getPerformanceStats(run.id);
    const httpStatusDistribution = await getHttpStatusDistribution(run.id);
    const serverInfo = await getServerInfo(run.id);

    let aiResult: DemoAiResult | null = null;
    try {
      aiResult = await runDemoAiVisibility(run.id, domain);
    } catch {
      // AI visibility is optional for demo
    }

    scheduleDemoCleanup(project.id);

    return {
      projectId: project.id,
      crawlId: run.id,
      status: 'COMPLETED',
      tech: {
        healthScore: analysis.healthScore,
        pagesCrawled: summary.pagesCrawled,
        pagesDiscovered: summary.pagesDiscovered,
        robotsFound: summary.robotsFound,
        sitemapFound: summary.sitemapFound,
        issueCount: analysis.issueCount,
        issueCounts: analysis.issueCounts,
        issues: issues.map((i) => ({ issueType: i.issueType, severity: i.severity, message: i.message })),
        pageStats,
        headingStats,
        imageStats,
        structuredDataStats,
        socialStats,
        performanceStats,
        httpStatusDistribution,
        serverInfo,
      },
      ai: aiResult,
    };
  } catch (error) {
    console.error(`[demo:${project.id}] scan failed`, error);
    const message =
      error instanceof FetchError
        ? error.reason === 'TIMEOUT'
          ? 'Crawl timed out while fetching pages'
          : error.reason === 'REDIRECT_LIMIT'
            ? 'Crawl failed: too many redirects'
            : 'Crawl failed to connect to the website'
        : 'Scan failed unexpectedly';
    return {
      projectId: project.id,
      crawlId: '',
      status: 'FAILED',
      errorMessage: message,
      tech: null,
      ai: null,
    };
  }
}

const CLEANUP_DELAY_MS = 10 * 60 * 1000; // 10 minutes

function scheduleDemoCleanup(projectId: string): void {
  setTimeout(async () => {
    try {
      await deleteProjectById(projectId);
      console.log(`[demo] cleaned up project ${projectId}`);
    } catch (error) {
      console.error(`[demo] failed to clean up project ${projectId}`, error);
    }
  }, CLEANUP_DELAY_MS);
}

export async function cleanupDemoProject(projectId: string): Promise<void> {
  await deleteProjectById(projectId);
}
