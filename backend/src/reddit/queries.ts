import type { AnalyzablePage } from '../analysis/types.js';
import { extractTopics } from '../search/extract.js';
import { analyzeSearchOpportunities } from '../search/opportunities.js';
import { CORE_TOPIC_MIN_DOC_FREQ } from '../search/rules.js';

export const MAX_REDDIT_QUERIES = 3;

export interface RedditQuerySelection {
  queries: string[];
  coreTopicTerms: string[];
}

const OPPORTUNITY_TYPES = new Set(['CONTENT_GAP', 'SEARCH_INTENT_GAP', 'WEAK_TOPIC_COVERAGE']);

/**
 * Reuses the existing topic extraction (search module) and the Search
 * Opportunities output to pick a small, deterministic set of queries for
 * Reddit discovery. No new crawler or duplicate topic system is introduced.
 */
export function selectRedditQueries(pages: AnalyzablePage[]): RedditQuerySelection {
  const { topics } = extractTopics(pages);

  const coreTopics = [...topics.values()]
    .filter((topic) => topic.docFreq >= CORE_TOPIC_MIN_DOC_FREQ)
    .sort((a, b) => b.docFreq - a.docFreq || a.term.localeCompare(b.term));
  const coreTopicTerms = coreTopics.map((topic) => topic.term);

  const opportunityQueries = analyzeSearchOpportunities(pages).opportunities
    .filter((o) => OPPORTUNITY_TYPES.has(o.type))
    .sort((a, b) => b.score.total - a.score.total || a.query.localeCompare(b.query))
    .map((o) => o.query);

  const candidates = [...coreTopicTerms, ...opportunityQueries];
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (normalized.length < 3 || seen.has(normalized)) continue;
    seen.add(normalized);
    queries.push(candidate.trim());
    if (queries.length >= MAX_REDDIT_QUERIES) break;
  }

  return { queries, coreTopicTerms };
}