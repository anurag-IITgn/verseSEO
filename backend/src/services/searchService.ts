import { eq } from 'drizzle-orm';
import type { AnalyzablePage } from '../analysis/types.js';
import { db } from '../db/client.js';
import { searchOpportunities } from '../db/schema.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import { findOpportunitiesByCrawl, insertSearchOpportunities, type SearchOpportunityRow } from '../repositories/searchRepo.js';
import { extractTopics } from '../search/extract.js';
import { analyzeSearchOpportunities } from '../search/opportunities.js';
import { AppError } from '../utils/errors.js';
import { requireCrawlOwned } from './ownership.js';

export interface SearchOpportunitiesResponse {
  crawlId: string;
  total: number;
  topicsAnalyzed: number;
  opportunities: SearchOpportunityRow[];
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
 */
export async function getSearchOpportunities(userId: string, crawlId: string): Promise<SearchOpportunitiesResponse> {
  const { crawl } = await requireCrawlOwned(userId, crawlId);
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

  return {
    crawlId,
    total: opportunities.length,
    topicsAnalyzed: topicsAnalyzedFor(pages),
    opportunities,
  };
}