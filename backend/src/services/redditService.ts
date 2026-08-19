import { eq } from 'drizzle-orm';
import type { AnalyzablePage } from '../analysis/types.js';
import { db } from '../db/client.js';
import { redditDiscussions } from '../db/schema.js';
import { RedditUnavailableError } from '../reddit/errors.js';
import { selectRedditQueries } from '../reddit/queries.js';
import { getRedditProvider } from '../reddit/registry.js';
import { scoreDiscussion, type ScoredDiscussion } from '../reddit/scoring.js';
import { extractTopics } from '../search/extract.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import {
  findDiscussionsByCrawl,
  insertRedditDiscussions,
  type RedditDiscussionRow,
} from '../repositories/redditRepo.js';
import { AppError } from '../utils/errors.js';
import { requireCrawlOwned } from './ownership.js';

export interface RedditOpportunitiesResponse {
  crawlId: string;
  status: 'ok' | 'unavailable';
  reason: string | null;
  message: string | null;
  total: number;
  topicsAnalyzed: number;
  discussions: RedditDiscussionRow[];
}

const MAX_DISCUSSIONS = 12;
const RESULTS_PER_QUERY = 5;

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

/**
 * Reddit opportunity discovery for a completed crawl. Real discussions are
 * fetched from the official Reddit API (when configured), scored with a
 * deterministic relevance model and persisted against the crawl so repeated
 * calls are idempotent. When Reddit is not configured or the provider fails,
 * an honest "unavailable" response is returned — never fabricated data.
 */
export async function getRedditOpportunities(userId: string, crawlId: string): Promise<RedditOpportunitiesResponse> {
  const { crawl } = await requireCrawlOwned(userId, crawlId);
  if (crawl.status !== 'COMPLETED') {
    throw new AppError(409, 'Crawl run is not completed', 'CRAWL_NOT_COMPLETED');
  }

  const pages = await findPagesByCrawl(crawlId);
  const analyzablePages = pages.map(toAnalyzablePage);
  const topicsAnalyzed = extractTopics(analyzablePages).topics.size;

  const stored = await findDiscussionsByCrawl(crawlId);
  if (stored.length > 0) {
    return { crawlId, status: 'ok', reason: null, message: null, total: stored.length, topicsAnalyzed, discussions: stored };
  }

  const provider = getRedditProvider();
  if (!provider) {
    return {
      crawlId,
      status: 'unavailable',
      reason: 'NOT_CONFIGURED',
      message: 'Reddit discovery is not connected. Add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (official Reddit API) to enable it.',
      total: 0,
      topicsAnalyzed,
      discussions: [],
    };
  }

  const { queries, coreTopicTerms } = selectRedditQueries(analyzablePages);
  if (queries.length === 0) {
    return { crawlId, status: 'ok', reason: null, message: null, total: 0, topicsAnalyzed, discussions: [] };
  }

  let scored: ScoredDiscussion[] = [];
  try {
    for (const query of queries) {
      const posts = await provider.search(query, { limit: RESULTS_PER_QUERY });
      for (const post of posts) {
        scored.push(scoreDiscussion(post, query, coreTopicTerms));
      }
    }
  } catch (error) {
    const message = error instanceof RedditUnavailableError ? error.message : 'Reddit discovery is temporarily unavailable.';
    return { crawlId, status: 'unavailable', reason: 'PROVIDER_ERROR', message, total: 0, topicsAnalyzed, discussions: [] };
  }

  const seen = new Set<string>();
  const unique = scored.filter((discussion) => {
    if (seen.has(discussion.permalink)) return false;
    seen.add(discussion.permalink);
    return true;
  });
  const final = unique.sort((a, b) => b.opportunityScore - a.opportunityScore || a.permalink.localeCompare(b.permalink)).slice(0, MAX_DISCUSSIONS);

  if (final.length > 0) {
    const rows = final.map((discussion) => ({
      crawlRunId: crawlId,
      subreddit: discussion.subreddit,
      postTitle: discussion.title,
      postUrl: `https://www.reddit.com${discussion.permalink}`,
      permalink: discussion.permalink,
      author: discussion.author,
      score: discussion.score,
      numComments: discussion.numComments,
      postedAt: discussion.postedAt !== null ? new Date(discussion.postedAt) : null,
      bodySnippet: discussion.bodySnippet,
      topic: discussion.topic,
      relevance: discussion.relevance,
      impact: discussion.impact,
      confidence: discussion.confidence,
      opportunityScore: discussion.opportunityScore,
      priority: discussion.priority,
      reason: discussion.reason,
    }));
    await db.transaction(async (tx) => {
      await tx.delete(redditDiscussions).where(eq(redditDiscussions.crawlRunId, crawlId));
      await tx.insert(redditDiscussions).values(rows);
    });
  }

  const discussions = await findDiscussionsByCrawl(crawlId);
  return { crawlId, status: 'ok', reason: null, message: null, total: discussions.length, topicsAnalyzed, discussions };
}