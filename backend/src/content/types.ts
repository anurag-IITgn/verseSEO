export type ContentSourceType =
  | 'CONTENT_GAP'
  | 'SEARCH_INTENT_GAP'
  | 'WEAK_TOPIC_COVERAGE'
  | 'SEO_FIX'
  | 'CORE_TOPIC'
  | 'AI_VISIBILITY_GAP';

export type ContentPriority = 'high' | 'medium' | 'low';

export interface ContentSeed {
  /** Topical focus of the recommendation, derived from real site data. */
  topic: string;
  /** Where the seed came from (search opportunity, SEO issue, topic, AI gap). */
  sourceType: ContentSourceType;
  priority: ContentPriority;
  /** Target search intent of the content, e.g. informational, commercial. */
  intent: string;
  /** Data-backed explanation of why this content matters for this site. */
  rationale: string;
  /** Short real-data context handed to the AI provider to write the brief. */
  reference: string;
}

export interface GeneratedBrief {
  title: string;
  intent: string;
  structure: string[];
}

/**
 * A structured content brief for one selected Search Opportunity. Every field
 * is grounded in real opportunity data (the query, intent, reason, suggested
 * action and evidence pages/phrases). No search volume, KD, CPC, traffic or
 * SERP metrics are ever included.
 */
export interface OpportunityContentBrief {
  targetTopic: string;
  searchIntent: string;
  coverage: string;
  opportunity: string;
  suggestedAction: string;
  evidencePages: string[];
  evidencePhrases: string[];
  angle: string;
  suggestedTitle: string;
  structure: string[];
  keyPoints: string[];
  aiEnhanced: boolean;
}

/** AI-provided enhancement of the deterministic brief (angle/title/structure/key points). */
export interface GeneratedBriefEnhancement {
  angle: string;
  title: string;
  structure: string[];
  keyPoints: string[];
}