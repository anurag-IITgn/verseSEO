import { scoreToPriority } from '../search/rules.js';
import { significantTokens } from '../search/extract.js';
import type { RedditPost } from './types.js';

export interface ScoredDiscussion {
  subreddit: string;
  title: string;
  permalink: string;
  author: string | null;
  score: number;
  numComments: number;
  postedAt: string | null;
  bodySnippet: string | null;
  topic: string;
  relevance: number;
  impact: number;
  confidence: number;
  opportunityScore: number;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

export const RELEVANCE_MAX = 40;
export const IMPACT_MAX = 30;
export const CONFIDENCE_MAX = 30;

const min = (a: number, b: number): number => (a < b ? a : b);
const max = (a: number, b: number): number => (a > b ? a : b);

/**
 * Deterministic opportunity scoring for a Reddit discussion, derived only
 * from real provider data plus the site's own extracted topics.
 *
 * opportunityScore = relevance (0-40) + impact (0-30) + confidence (0-30).
 * - relevance: how closely the post title/body matches the site topic.
 * - impact: real community engagement (comments, points, log-scaled and
 *   capped) plus recency when a real post date is available.
 * - confidence: how many data signals the post carries (title length,
 *   author, body text, post date).
 *
 * This is our opportunity score, NOT Reddit's own ranking or popularity.
 */
export function scoreDiscussion(post: RedditPost, query: string, coreTopicTerms: string[], nowMs: number = Date.now()): ScoredDiscussion {
  const titleTokens = significantTokens(post.title);
  const bodyTokens = significantTokens(post.bodySnippet ?? '');
  const queryTokens = significantTokens(query);

  const matchedQueryTokens = queryTokens.filter((token) => titleTokens.includes(token)).length;
  const queryMatch = queryTokens.length === 0 ? 0 : matchedQueryTokens / queryTokens.length;

  const coreTokens = new Set<string>();
  for (const term of coreTopicTerms) {
    for (const token of significantTokens(term)) coreTokens.add(token);
  }
  let coreMatchCount = 0;
  for (const token of titleTokens) if (coreTokens.has(token)) coreMatchCount += 1;
  for (const token of bodyTokens) if (coreTokens.has(token)) coreMatchCount += 1;

  const relevance = Math.round(min(RELEVANCE_MAX, 8 + 12 * queryMatch + 3 * Math.min(coreMatchCount, 6)));

  const commentFactor = Math.min(1, Math.log2(post.numComments + 1) / 5);
  const scoreFactor = Math.min(1, Math.log10(post.score + 1) / 3);
  let recencyPoints = 0;
  let ageDays: number | null = null;
  if (post.createdAt !== null) {
    const parsed = Date.parse(post.createdAt);
    if (Number.isFinite(parsed)) {
      ageDays = Math.max(0, (nowMs - parsed) / 86_400_000);
      recencyPoints = ageDays < 30 ? 5 : ageDays < 180 ? 3 : 0;
    }
  }
  const impact = Math.round(min(IMPACT_MAX, commentFactor * 15 + scoreFactor * 10 + recencyPoints));

  const confidence = Math.round(
    min(
      CONFIDENCE_MAX,
      10 + (post.title.length >= 15 ? 6 : 0) + (post.author !== null ? 5 : 0) + (post.bodySnippet !== null ? 6 : 0) + (post.createdAt !== null ? 4 : 0),
    ),
  );

  const opportunityScore = max(0, min(100, relevance + impact + confidence));
  const priority = scoreToPriority(opportunityScore);

  const engagement = `${post.numComments} comment${post.numComments === 1 ? '' : 's'} · ${post.score} point${post.score === 1 ? '' : 's'}`;
  const age = ageDays !== null ? ` · ${Math.round(ageDays)} day${Math.round(ageDays) === 1 ? '' : 's'} old` : '';
  const reason = `"${post.title}" in r/${post.subreddit} (${engagement}${age}) relates to topic "${query}".`;

  return {
    subreddit: post.subreddit,
    title: post.title,
    permalink: post.permalink,
    author: post.author,
    score: post.score,
    numComments: post.numComments,
    postedAt: post.createdAt,
    bodySnippet: post.bodySnippet,
    topic: query,
    relevance,
    impact,
    confidence,
    opportunityScore,
    priority,
    reason,
  };
}