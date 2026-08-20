import { eq } from 'drizzle-orm';
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
import { aiVisibilityResults, seoIssues } from '../db/schema.js';
import { createCrawlRun, setCrawlRunCounters, setCrawlRunSignals, updateCrawlRunStatus } from '../repositories/crawlRepo.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import { insertCrawledPage } from '../repositories/pageRepo.js';
import { insertProject, deleteProjectById } from '../repositories/projectRepo.js';
import { extractTopics } from '../search/extract.js';
import { AppError } from '../utils/errors.js';
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

function toAnalyzablePage(page: CrawledPageRow): AnalyzablePage {
  return {
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
  };
}

export interface DemoAiResult {
  status: 'ok' | 'unavailable';
  reason: string | null;
  message: string | null;
  provider: string | null;
  model: string | null;
  overallVisibilityScore: number;
  mentionedCount: number;
  citedCount: number;
  recommendationCount: number;
  results: Array<{
    topic: string;
    prompt: string;
    provider: string;
    model: string;
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
      provider: null,
      model: null,
      overallVisibilityScore: 0,
      mentionedCount: 0,
      citedCount: 0,
      recommendationCount: 0,
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
      provider: provider.name,
      model: provider.model,
      overallVisibilityScore: 0,
      mentionedCount: 0,
      citedCount: 0,
      recommendationCount: 0,
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
      provider: provider.name,
      model: provider.model,
      overallVisibilityScore: 0,
      mentionedCount: 0,
      citedCount: 0,
      recommendationCount: 0,
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

  return {
    status: 'ok',
    reason: null,
    message: null,
    provider: provider.name,
    model: provider.model,
    overallVisibilityScore,
    mentionedCount,
    citedCount,
    recommendationCount,
    results: rows.map((r) => ({
      topic: r.prompt,
      prompt: r.prompt,
      provider: r.provider,
      model: r.model,
      mentioned: r.mentioned,
      cited: r.cited,
      stance: r.stance,
      visibilityScore: r.visibilityScore,
      reason: r.reason,
      competitors: r.competitors ?? [],
    })),
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
  } | null;
  ai: DemoAiResult | null;
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
