import { eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { crawlSite } from '../crawler/crawler.js';
import { FetchError } from '../crawler/http.js';
import type { CrawlSiteConfig, CrawlerSink } from '../crawler/types.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { createCrawlRun, countCrawlsByUserId, findActiveCrawlRunByProject, findCrawlRunById, setCrawlRunCounters, setCrawlRunSignals, updateCrawlRunStatus, type CrawlRun } from '../repositories/crawlRepo.js';
import { insertCrawledPage } from '../repositories/pageRepo.js';
import { findProjectById, listProjectsByOwner } from '../repositories/projectRepo.js';
import { AppError } from '../utils/errors.js';
import { assertPublicTargetUrl } from '../utils/ssrfGuard.js';
import { requireCrawlOwned, requireProjectOwned } from './ownership.js';
import { performAnalysis } from './analysisService.js';

export interface CreateCrawlResult {
  id: string;
  projectId: string;
  status: 'PENDING';
}

export async function createCrawl(userId: string, projectId: string): Promise<CreateCrawlResult> {
  await requireProjectOwned(userId, projectId);

  const project = await findProjectById(projectId);
  if (!project) {
    throw new AppError(404, 'Project not found', 'PROJECT_NOT_FOUND');
  }

  if (!env.CRAWL_ALLOW_PRIVATE_NETWORKS) {
    await assertPublicTargetUrl(project.websiteUrl);
  }

  const active = await findActiveCrawlRunByProject(projectId);
  if (active) {
    throw new AppError(409, 'A scan is already in progress for this project', 'CRAWL_IN_PROGRESS');
  }

  const run = await createCrawlRun(project.id);

  setImmediate(() => {
    void executeCrawl(run.id);
  });

  return { id: run.id, projectId: run.projectId, status: 'PENDING' };
}

export async function getCrawl(userId: string, crawlId: string): Promise<CrawlRun> {
  const { crawl } = await requireCrawlOwned(userId, crawlId);
  return crawl;
}

async function executeCrawl(crawlId: string): Promise<void> {
  try {
    const run = await findCrawlRunById(crawlId);
    if (!run) return;

    const project = await findProjectById(run.projectId);
    if (!project) {
      await updateCrawlRunStatus(crawlId, 'FAILED', {
        completedAt: new Date(),
        errorMessage: 'Project no longer exists',
      });
      return;
    }

    await updateCrawlRunStatus(crawlId, 'RUNNING', { startedAt: new Date() });

    const config: CrawlSiteConfig = {
      websiteUrl: project.websiteUrl,
      domain: project.domain,
      maxPages: env.MAX_PAGES,
      timeoutMs: env.CRAWL_TIMEOUT_MS,
      userAgent: env.CRAWL_USER_AGENT,
    };

    const sink: CrawlerSink = {
      savePage: (page) => insertCrawledPage({ ...page, crawlRunId: crawlId }),
      updateCounters: (pagesCrawled, pagesDiscovered) => setCrawlRunCounters(crawlId, pagesCrawled, pagesDiscovered),
    };

    const summary = await crawlSite(config, sink);

    if (summary.pagesCrawled === 0) {
      await updateCrawlRunStatus(crawlId, 'FAILED', {
        completedAt: new Date(),
        errorMessage: 'Crawl failed: no pages could be fetched',
      });
      return;
    }

    await setCrawlRunSignals(crawlId, summary.robotsFound, summary.sitemapFound);

    const analysis = await performAnalysis(crawlId);

    await updateCrawlRunStatus(crawlId, 'COMPLETED', {
      completedAt: new Date(),
      healthScore: analysis.healthScore,
    });
  } catch (error) {
    // Log the real error server-side, but never persist implementation details
    // that could be exposed through the crawl status / scan history APIs.
    console.error(`[crawl:${crawlId}] failed`, error);
    const message =
      error instanceof FetchError
        ? error.reason === 'TIMEOUT'
          ? 'Crawl timed out while fetching pages'
          : error.reason === 'REDIRECT_LIMIT'
            ? 'Crawl failed: too many redirects'
            : 'Crawl failed to connect to the website'
        : 'Crawl failed unexpectedly';
    await updateCrawlRunStatus(crawlId, 'FAILED', {
      completedAt: new Date(),
      errorMessage: message,
    });
  }
}

const FREE_PROJECT_LIMIT = 1;
const FREE_SCAN_LIMIT = 1;

export interface UserScanStatus {
  plan: string;
  projectCount: number;
  scanCount: number;
  canScan: boolean;
  reason?: string;
}

export async function getUserScanStatus(userId: string): Promise<UserScanStatus> {
  const [user] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
  const plan = user?.plan ?? 'free';

  if (plan === 'pro') {
    return { plan, projectCount: 0, scanCount: 0, canScan: true };
  }

  const projects = await listProjectsByOwner(userId);
  const projectCount = projects.length;

  if (projectCount >= FREE_PROJECT_LIMIT) {
    const scanCount = await countCrawlsByUserId(userId);
    if (scanCount >= FREE_SCAN_LIMIT) {
      return { plan, projectCount, scanCount, canScan: false, reason: 'FREE_SCAN_LIMIT' };
    }
  }

  return { plan, projectCount, scanCount: await countCrawlsByUserId(userId), canScan: true };
}