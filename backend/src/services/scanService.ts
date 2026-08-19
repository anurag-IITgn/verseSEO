import { findAiVisibilityResultsByCrawl } from '../repositories/aiVisibilityRepo.js';
import { findRecommendationsByCrawl } from '../repositories/contentRepo.js';
import { findCrawlRunById, type CrawlRun } from '../repositories/crawlRepo.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import { findDiscussionsByCrawl } from '../repositories/redditRepo.js';
import {
  findCompletedRunsByProject,
  findScanModuleCounts,
  type ScanModuleCounts,
} from '../repositories/scanRepo.js';
import { findIssuesByCrawl, type SeoIssue } from '../repositories/seoRepo.js';
import { findOpportunitiesByCrawl, type SearchOpportunityRow } from '../repositories/searchRepo.js';
import { AppError } from '../utils/errors.js';
import { isValidUuid } from '../utils/uuid.js';
import { requireProjectOwned } from './ownership.js';

export interface ScanSnapshot {
  id: string;
  status: string;
  completedAt: string | null;
  createdAt: string;
  healthScore: number | null;
  pagesDiscovered: number;
  pagesCrawled: number;
  robotsFound: boolean | null;
  sitemapFound: boolean | null;
  results: ScanModuleCounts;
}

export interface ScanHistoryResponse {
  projectId: string;
  total: number;
  scans: ScanSnapshot[];
}

export interface ScanDetailsResponse {
  projectId: string;
  crawl: CrawlRun;
  healthScore: number | null;
  pages: CrawledPageRow[];
  issues: SeoIssue[];
  issueCount: number;
  issueCounts: Record<string, number>;
  searchOpportunities: { total: number; items: SearchOpportunityRow[] };
  redditDiscussions: { total: number; items: Awaited<ReturnType<typeof findDiscussionsByCrawl>> };
  contentRecommendations: { total: number; items: Awaited<ReturnType<typeof findRecommendationsByCrawl>> };
  aiVisibility: { total: number; mentioned: number; cited: number; score: number; items: Awaited<ReturnType<typeof findAiVisibilityResultsByCrawl>> } | null;
}

export interface NumericDelta {
  from: number;
  to: number;
  delta: number;
}

export interface OptionalModuleDelta {
  present: boolean;
  from: number;
  to: number;
  delta: number | null;
}

export interface AiVisibilityDelta {
  present: boolean;
  score: NumericDelta | null;
  mentioned: NumericDelta | null;
  cited: NumericDelta | null;
}

export interface ScanComparisonResponse {
  projectId: string;
  hasPrevious: boolean;
  message: string | null;
  current: ScanSnapshot | null;
  previous: ScanSnapshot | null;
  changes: {
    healthScore: NumericDelta | null;
    pagesDiscovered: NumericDelta;
    pagesCrawled: NumericDelta;
    issueCount: NumericDelta;
    issueCounts: Record<string, NumericDelta>;
    opportunities: OptionalModuleDelta;
    reddit: OptionalModuleDelta;
    content: OptionalModuleDelta;
    aiVisibility: AiVisibilityDelta;
  } | null;
  improvements: string[];
  regressions: string[];
}

function toSnapshot(run: CrawlRun, results: ScanModuleCounts): ScanSnapshot {
  return {
    id: run.id,
    status: run.status,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
    healthScore: run.healthScore,
    pagesDiscovered: run.pagesDiscovered,
    pagesCrawled: run.pagesCrawled,
    robotsFound: run.robotsFound,
    sitemapFound: run.sitemapFound,
    results,
  };
}

function delta(from: number, to: number): NumericDelta {
  return { from, to, delta: to - from };
}

function optionalDelta(fromCount: number, toCount: number): OptionalModuleDelta {
  const present = fromCount > 0 && toCount > 0;
  return { present, from: fromCount, to: toCount, delta: present ? toCount - fromCount : null };
}

function aiDelta(
  from: ScanModuleCounts['aiVisibility'],
  to: ScanModuleCounts['aiVisibility'],
): AiVisibilityDelta {
  const present = from !== null && to !== null;
  return {
    present,
    score: present ? delta(from!.score, to!.score) : null,
    mentioned: present ? delta(from!.mentioned, to!.mentioned) : null,
    cited: present ? delta(from!.cited, to!.cited) : null,
  };
}

async function requireProject(userId: string, projectId: string) {
  return requireProjectOwned(userId, projectId);
}

export async function getScanHistory(userId: string, projectId: string): Promise<ScanHistoryResponse> {
  await requireProject(userId, projectId);
  const runs = await findCompletedRunsByProject(projectId);
  const scans: ScanSnapshot[] = [];
  for (const run of runs) {
    scans.push(toSnapshot(run, await findScanModuleCounts(run.id)));
  }
  return { projectId, total: scans.length, scans };
}

export async function getScanDetails(userId: string, projectId: string, crawlId: string): Promise<ScanDetailsResponse> {
  await requireProject(userId, projectId);
  if (!isValidUuid(crawlId)) {
    throw new AppError(400, 'Invalid crawl id', 'INVALID_CRAWL_ID');
  }
  const run = await findCrawlRunById(crawlId);
  if (!run || run.projectId !== projectId) {
    throw new AppError(404, 'Scan not found', 'SCAN_NOT_FOUND');
  }
  if (run.status !== 'COMPLETED') {
    throw new AppError(409, 'Scan is not completed', 'SCAN_NOT_COMPLETED');
  }

  const [issues, pages, opportunities, reddit, content, ai] = await Promise.all([
    findIssuesByCrawl(crawlId),
    findPagesByCrawl(crawlId),
    findOpportunitiesByCrawl(crawlId),
    findDiscussionsByCrawl(crawlId),
    findRecommendationsByCrawl(crawlId),
    findAiVisibilityResultsByCrawl(crawlId),
  ]);

  const issueCounts: Record<string, number> = {};
  for (const issue of issues) {
    issueCounts[issue.issueType] = (issueCounts[issue.issueType] ?? 0) + 1;
  }

  return {
    projectId,
    crawl: run,
    healthScore: run.healthScore,
    pages,
    issues,
    issueCount: issues.length,
    issueCounts,
    searchOpportunities: { total: opportunities.length, items: opportunities },
    redditDiscussions: { total: reddit.length, items: reddit },
    contentRecommendations: { total: content.length, items: content },
    aiVisibility:
      ai.length > 0
        ? {
            total: ai.length,
            mentioned: ai.filter((r) => r.mentioned).length,
            cited: ai.filter((r) => r.cited).length,
            score: Math.round(ai.reduce((sum, r) => sum + r.visibilityScore, 0) / ai.length),
            items: ai,
          }
        : null,
  };
}

export async function getScanComparison(userId: string, projectId: string): Promise<ScanComparisonResponse> {
  await requireProject(userId, projectId);
  const runs = await findCompletedRunsByProject(projectId);
  const currentRun = runs[0] ?? null;
  const previousRun = runs[1] ?? null;

  if (!currentRun) {
    return {
      projectId,
      hasPrevious: false,
      message: 'No completed scans available yet.',
      current: null,
      previous: null,
      changes: null,
      improvements: [],
      regressions: [],
    };
  }

  const currentCounts = await findScanModuleCounts(currentRun.id);
  const current = toSnapshot(currentRun, currentCounts);

  if (!previousRun) {
    return {
      projectId,
      hasPrevious: false,
      message: 'No previous scan available yet.',
      current,
      previous: null,
      changes: null,
      improvements: [],
      regressions: [],
    };
  }

  const previousCounts = await findScanModuleCounts(previousRun.id);
  const previous = toSnapshot(previousRun, previousCounts);

  const healthScore =
    previous.healthScore === null || current.healthScore === null
      ? null
      : delta(previous.healthScore, current.healthScore);

  const issueCountKeys = new Set([
    ...Object.keys(previous.results.issueCounts),
    ...Object.keys(current.results.issueCounts),
  ]);
  const issueCounts: Record<string, NumericDelta> = {};
  for (const type of issueCountKeys) {
    issueCounts[type] = delta(previous.results.issueCounts[type] ?? 0, current.results.issueCounts[type] ?? 0);
  }

  const changes = {
    healthScore,
    pagesDiscovered: delta(previous.pagesDiscovered, current.pagesDiscovered),
    pagesCrawled: delta(previous.pagesCrawled, current.pagesCrawled),
    issueCount: delta(previous.results.issueCount, current.results.issueCount),
    issueCounts,
    opportunities: optionalDelta(previous.results.opportunities, current.results.opportunities),
    reddit: optionalDelta(previous.results.reddit, current.results.reddit),
    content: optionalDelta(previous.results.content, current.results.content),
    aiVisibility: aiDelta(previous.results.aiVisibility, current.results.aiVisibility),
  };

  const improvements: string[] = [];
  const regressions: string[] = [];

  if (changes.healthScore && changes.healthScore.delta > 0) {
    improvements.push(`Health score improved +${changes.healthScore.delta} (${changes.healthScore.from} → ${changes.healthScore.to}).`);
  } else if (changes.healthScore && changes.healthScore.delta < 0) {
    regressions.push(`Health score declined ${changes.healthScore.delta} (${changes.healthScore.from} → ${changes.healthScore.to}).`);
  }

  if (changes.issueCount.delta < 0) {
    improvements.push(`Technical issues reduced by ${-changes.issueCount.delta} (${changes.issueCount.from} → ${changes.issueCount.to}).`);
  } else if (changes.issueCount.delta > 0) {
    regressions.push(`Technical issues increased by +${changes.issueCount.delta} (${changes.issueCount.from} → ${changes.issueCount.to}).`);
  }

  if (changes.pagesCrawled.delta > 0) {
    improvements.push(`Crawl coverage grew from ${changes.pagesCrawled.from} to ${changes.pagesCrawled.to} pages.`);
  } else if (changes.pagesCrawled.delta < 0) {
    regressions.push(`Crawl coverage shrank from ${changes.pagesCrawled.from} to ${changes.pagesCrawled.to} pages.`);
  }

  if (changes.opportunities.present && changes.opportunities.delta !== null) {
    if (changes.opportunities.delta > 0) {
      improvements.push(`+${changes.opportunities.delta} more search opportunities identified.`);
    } else if (changes.opportunities.delta < 0) {
      regressions.push(`${-changes.opportunities.delta} fewer search opportunities identified.`);
    }
  }

  if (changes.content.present && changes.content.delta !== null) {
    if (changes.content.delta > 0) {
      improvements.push(`+${changes.content.delta} more content recommendations generated.`);
    } else if (changes.content.delta < 0) {
      regressions.push(`${-changes.content.delta} fewer content recommendations generated.`);
    }
  }

  if (changes.aiVisibility.present) {
    if (changes.aiVisibility.score && changes.aiVisibility.score.delta > 0) {
      improvements.push(`AI visibility score improved +${changes.aiVisibility.score.delta}.`);
    } else if (changes.aiVisibility.score && changes.aiVisibility.score.delta < 0) {
      regressions.push(`AI visibility score declined ${changes.aiVisibility.score.delta}.`);
    }
    if (changes.aiVisibility.cited && changes.aiVisibility.cited.delta > 0) {
      improvements.push(`+${changes.aiVisibility.cited.delta} more AI citations detected.`);
    } else if (changes.aiVisibility.cited && changes.aiVisibility.cited.delta < 0) {
      regressions.push(`${-changes.aiVisibility.cited.delta} fewer AI citations detected.`);
    }
  }

  return {
    projectId,
    hasPrevious: true,
    message: null,
    current,
    previous,
    changes,
    improvements,
    regressions,
  };
}