import type { GscOpportunityMetrics, GscQueryRow } from './types.js';

const MATCH_THRESHOLD = 0.6;
const MAX_QUERIES_PER_OPPORTUNITY = 25;

export function normalizeQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  return normalizeQuery(value).split(' ').filter(Boolean);
}

/**
 * Deterministic similarity between an opportunity query and a real GSC query.
 * Exact matches score 1.0; subset/superset containment scores 0.8/0.7; partial
 * overlap uses Jaccard similarity. Anything below the threshold is not a match.
 */
export function queryMatchScore(opportunityQuery: string, gscQuery: string): number {
  const a = tokenize(opportunityQuery);
  const b = tokenize(gscQuery);
  if (a.length === 0 || b.length === 0) return 0;
  if (a.join(' ') === b.join(' ')) return 1;

  const aSet = new Set(a);
  const bSet = new Set(b);
  const allInA = a.every((token) => bSet.has(token));
  const allInB = b.every((token) => aSet.has(token));
  if (allInA) return 0.8;
  if (allInB) return 0.7;

  const intersection = a.filter((token) => bSet.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

export interface MatchContext {
  siteUrl: string;
  startDate: string;
  endDate: string;
  syncedAt: string;
}

export interface MatchResult {
  metricsByOpportunityId: Map<string, GscOpportunityMetrics>;
  /** Number of distinct GSC queries that matched at least one opportunity. */
  matchedQueries: number;
}

interface Aggregator {
  clicks: number;
  impressions: number;
  weightedPosition: number;
  queries: string[];
}

/**
 * Matches real GSC queries to existing opportunities only. New opportunities
 * are never created from GSC data. Each GSC query is assigned to its single
 * best-fitting opportunity (best score, ties broken by the more specific
 * query); several queries may enrich the same opportunity and are aggregated
 * (summed clicks/impressions, impression-weighted position, recomputed CTR).
 */
export function matchGscQueries(
  opportunities: Array<{ id: string; query: string }>,
  rows: GscQueryRow[],
  context: MatchContext,
): MatchResult {
  const metricsByOpportunityId = new Map<string, GscOpportunityMetrics>();
  if (opportunities.length === 0 || rows.length === 0) {
    return { metricsByOpportunityId, matchedQueries: 0 };
  }

  const candidates = opportunities.map((opp) => ({ id: opp.id, normalized: normalizeQuery(opp.query) }));
  const aggregators = new Map<string, Aggregator>();
  let matchedQueries = 0;

  const sortedRows = [...rows].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);

  for (const row of sortedRows) {
    const gscQuery = row.keys[0];
    if (!gscQuery || gscQuery.trim() === '') continue;

    let best: { id: string; score: number } | null = null;
    for (const candidate of candidates) {
      const score = queryMatchScore(candidate.normalized, gscQuery);
      if (score < MATCH_THRESHOLD) continue;
      if (!best || score > best.score) best = { id: candidate.id, score };
    }
    if (!best) continue;

    matchedQueries += 1;
    let agg = aggregators.get(best.id);
    if (!agg) {
      agg = { clicks: 0, impressions: 0, weightedPosition: 0, queries: [] };
      aggregators.set(best.id, agg);
    }
    agg.clicks += row.clicks;
    agg.impressions += row.impressions;
    agg.weightedPosition += row.position * row.impressions;
    if (agg.queries.length < MAX_QUERIES_PER_OPPORTUNITY) {
      agg.queries.push(gscQuery);
    }
  }

  for (const [id, agg] of aggregators) {
    const impressions = agg.impressions;
    metricsByOpportunityId.set(id, {
      source: 'google-search-console',
      siteUrl: context.siteUrl,
      startDate: context.startDate,
      endDate: context.endDate,
      syncedAt: context.syncedAt,
      queries: agg.queries,
      clicks: agg.clicks,
      impressions,
      ctr: impressions > 0 ? round(agg.clicks / impressions, 4) : 0,
      position: impressions > 0 ? round(agg.weightedPosition / impressions, 1) : 0,
    });
  }

  return { metricsByOpportunityId, matchedQueries };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}