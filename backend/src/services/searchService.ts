import { eq } from 'drizzle-orm';
import type { AnalyzablePage } from '../analysis/types.js';
import { db } from '../db/client.js';
import { searchOpportunities, users } from '../db/schema.js';
import type { GscSummary } from '../gsc/types.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import { findOpportunitiesByCrawl, insertSearchOpportunities, type SearchOpportunityRow } from '../repositories/searchRepo.js';
import { extractTopics } from '../search/extract.js';
import { analyzeSearchOpportunities } from '../search/opportunities.js';
import { AppError } from '../utils/errors.js';
import { enrichSearchOpportunities } from './gscService.js';
import { requireCrawlOwned } from './ownership.js';

export interface SearchOpportunityAggregate {
  high: number;
  medium: number;
  low: number;
  typeCounts: Record<string, number>;
  intentCounts: Record<string, number>;
  coverageCounts: Record<string, number>;
}

export interface SearchOpportunitiesResponse {
  crawlId: string;
  total: number;
  topicsAnalyzed: number;
  opportunities: SearchOpportunityRow[];
  gsc: GscSummary | null;
  plan: string;
  aggregate: SearchOpportunityAggregate;
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

function topicsAnalyzedFor(pages: CrawledPageRow[]): number {
  return extractTopics(pages.map(toAnalyzablePage)).topics.size;
}

/**
 * Returns the search opportunities for a completed crawl. Opportunities are
 * computed deterministically from the crawled pages and stored against the
 * crawl, so repeated calls are idempotent and never produce duplicates.
 *
 * Free users receive aggregate stats (counts, distributions) for ALL
 * opportunities, but only the top 3 individual opportunity records.
 * Pro users receive the complete dataset.
 */
export async function getSearchOpportunities(userId: string, crawlId: string): Promise<SearchOpportunitiesResponse> {
  const { crawl, project } = await requireCrawlOwned(userId, crawlId);
  if (crawl.status !== 'COMPLETED') {
    throw new AppError(409, 'Crawl run is not completed', 'CRAWL_NOT_COMPLETED');
  }

  const pages = await findPagesByCrawl(crawlId);

  let opportunities = await findOpportunitiesByCrawl(crawlId);
  if (opportunities.length === 0) {
    const result = analyzeSearchOpportunities(pages.map(toAnalyzablePage));
    const rows = result.opportunities.map((o) => ({
      crawlRunId: crawlId,
      query: o.query,
      opportunityType: o.type,
      intent: o.intent,
      coverage: o.coverage,
      evidence: o.evidence,
      score: o.score.total,
      priority: o.score.priority,
      relevance: o.score.relevance,
      impact: o.score.impact,
      confidence: o.score.confidence,
      reason: o.reason,
      suggestedAction: o.suggestedAction,
      relatedPageId: o.relatedPageId,
      relatedPageUrl: o.relatedPageUrl,
    }));
    if (rows.length > 0) {
      await db.transaction(async (tx) => {
        await tx.delete(searchOpportunities).where(eq(searchOpportunities.crawlRunId, crawlId));
        await tx.insert(searchOpportunities).values(rows);
      });
    }
    opportunities = await findOpportunitiesByCrawl(crawlId);
  }

  const gsc = await enrichSearchOpportunities(userId, crawlId, project, opportunities);
  if (gsc?.status === 'ok') {
    opportunities = await findOpportunitiesByCrawl(crawlId);
  }

  // Compute aggregate stats from ALL opportunities (always complete)
  const aggregate: SearchOpportunityAggregate = {
    high: opportunities.filter(o => o.priority === 'high').length,
    medium: opportunities.filter(o => o.priority === 'medium').length,
    low: opportunities.filter(o => o.priority === 'low').length,
    typeCounts: {},
    intentCounts: {},
    coverageCounts: {},
  };
  for (const o of opportunities) {
    aggregate.typeCounts[o.opportunityType] = (aggregate.typeCounts[o.opportunityType] || 0) + 1;
    aggregate.intentCounts[o.intent] = (aggregate.intentCounts[o.intent] || 0) + 1;
    aggregate.coverageCounts[o.coverage] = (aggregate.coverageCounts[o.coverage] || 0) + 1;
  }

  // Get user plan
  const [userRow] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
  const plan = userRow?.plan ?? 'free';

  // Server-side enforcement: Free users only receive top 3 individual opportunities
  let filteredOpportunities = opportunities;
  if (plan !== 'pro') {
    filteredOpportunities = [...opportunities]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  return {
    crawlId,
    total: opportunities.length,
    topicsAnalyzed: topicsAnalyzedFor(pages),
    opportunities: filteredOpportunities,
    gsc,
    plan,
    aggregate,
  };
}