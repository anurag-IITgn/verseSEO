import type { AnalyzablePage } from '../analysis/types.js';

export type OpportunityType =
  | 'CONTENT_GAP'
  | 'WEAK_TOPIC_COVERAGE'
  | 'EXISTING_PAGE_OPTIMIZATION'
  | 'INTERNAL_LINK_OPPORTUNITY'
  | 'SEARCH_INTENT_GAP';

export type OpportunityPriority = 'high' | 'medium' | 'low';

export interface OpportunityScore {
  /** 0-40: how central the topic is to the site, derived from document frequency. */
  relevance: number;
  /** 0-30: how large the gap/weakness is. */
  impact: number;
  /** 0-30: how many independent signals support the inference. */
  confidence: number;
  /** relevance + impact + confidence, clamped to 0-100. */
  total: number;
  priority: OpportunityPriority;
}

export interface SearchOpportunityInput {
  query: string;
  type: OpportunityType;
  score: OpportunityScore;
  reason: string;
  suggestedAction: string;
  relatedPageId: string | null;
  relatedPageUrl: string | null;
}

export interface SearchOpportunitiesResult {
  opportunities: SearchOpportunityInput[];
  total: number;
  topicsAnalyzed: number;
}

export type { AnalyzablePage };