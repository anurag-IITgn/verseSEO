import type { SearchOpportunityRow } from '../repositories/searchRepo.js';
import { fallbackStructure } from './structure.js';
import type { GeneratedBriefEnhancement, OpportunityContentBrief } from './types.js';

function capitalizePhrase(phrase: string): string {
  return phrase
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
}

/**
 * Builds a deterministic, fully grounded content brief for a single Search
 * Opportunity, using only real data produced by Module 2 (query, intent,
 * coverage state, reason, suggested action, evidence pages/phrases). The AI
 * provider later enhances angle/title/structure/key points; until then this
 * brief is honest, rule-based output.
 */
export function buildOpportunityBrief(opportunity: SearchOpportunityRow): OpportunityContentBrief {
  const evidence = opportunity.evidence as { sourcePages?: Array<{ url: string; id: string | null }>; sourcePhrases?: string[] } | null;
  const evidencePages = Array.isArray(evidence?.sourcePages)
    ? evidence.sourcePages.map((page) => page.url).filter((url): url is string => typeof url === 'string' && url.length > 0)
    : [];
  const evidencePhrases = Array.isArray(evidence?.sourcePhrases)
    ? evidence.sourcePhrases.filter((phrase): phrase is string => typeof phrase === 'string' && phrase.trim().length > 0)
    : [];

  const coverage = opportunity.coverage ?? 'IMPROVEMENT';
  const angle =
    coverage === 'GAP'
      ? `Publish new, dedicated coverage that directly targets "${opportunity.query}" from scratch.`
      : `Improve and expand the existing coverage of "${opportunity.query}" so it fully satisfies the search intent.`;

  const keyPoints = evidencePhrases.length > 0 ? evidencePhrases : [`Answer what "${opportunity.query}" is and why it matters to the reader.`];

  return {
    targetTopic: opportunity.query,
    searchIntent: opportunity.intent,
    coverage,
    opportunity: opportunity.reason,
    suggestedAction: opportunity.suggestedAction,
    evidencePages,
    evidencePhrases,
    angle,
    suggestedTitle: capitalizePhrase(opportunity.query),
    structure: fallbackStructure(opportunity.intent, opportunity.query),
    keyPoints,
    aiEnhanced: false,
  };
}

/**
 * Overlays a parsed AI enhancement onto a deterministic brief. The AI may
 * improve the angle, suggested title, structure and key points; the grounded
 * fields (topic, intent, coverage, opportunity, suggested action, evidence)
 * are never overwritten.
 */
export function applyBriefEnhancement(brief: OpportunityContentBrief, generated: GeneratedBriefEnhancement): OpportunityContentBrief {
  return {
    ...brief,
    angle: generated.angle.trim().length > 0 ? generated.angle.trim() : brief.angle,
    suggestedTitle: generated.title.trim().length > 0 ? generated.title.trim() : brief.suggestedTitle,
    structure: generated.structure.length > 0 ? generated.structure : brief.structure,
    keyPoints: generated.keyPoints.length > 0 ? generated.keyPoints : brief.keyPoints,
    aiEnhanced: true,
  };
}