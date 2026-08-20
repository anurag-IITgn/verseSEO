import type { OpportunityContentBrief } from './types.js';
import type { ContentSeed } from './types.js';

/**
 * Prompt that asks the AI provider to turn one deterministic, data-grounded
 * content seed into a concrete brief. All facts come from the real crawl; the
 * model is explicitly told not to invent metrics.
 */
export function buildContentBriefPrompt(seed: ContentSeed, domain: string): string {
  return [
    'You are an SEO content strategist for the website ' + domain + '.',
    `Derived from a real crawl, this topic is relevant: "${seed.topic}".`,
    `Evidence: ${seed.reference}.`,
    `Target intent: ${seed.intent}.`,
    'Write a short content brief with exactly three labelled parts:',
    'TITLE: one concrete article title under 70 characters.',
    'INTENT: the primary intent the page should satisfy.',
    'STRUCTURE: a 3-6 point bullet outline (H2 sections) with a short phrase per point.',
    'Base everything only on the provided evidence. Do not invent metrics such as search volume, CPC, rankings or traffic.',
  ].join('\n');
}

/**
 * Prompt that turns one deterministic, data-grounded opportunity brief into an
 * AI-enhanced version. Only the creative fields (angle, title, structure, key
 * points) are requested; the model is told never to invent unsupported data.
 */
export function buildOpportunityBriefPrompt(brief: OpportunityContentBrief, domain: string): string {
  return [
    'You are an SEO content strategist for the website ' + domain + '.',
    `Target search query: "${brief.targetTopic}".`,
    `Search intent to satisfy: ${brief.searchIntent}.`,
    `Coverage state: ${brief.coverage}.`,
    `Why this is an opportunity: ${brief.opportunity}`,
    `Suggested action: ${brief.suggestedAction}`,
    ...(brief.evidencePages.length > 0 ? [`Existing evidence pages: ${brief.evidencePages.join(', ')}`] : []),
    ...(brief.evidencePhrases.length > 0 ? [`Phrases from real content to address: ${brief.evidencePhrases.join('; ')}`] : []),
    'Write a concise content brief with exactly four labelled parts:',
    'ANGLE: one recommended content angle in a single sentence.',
    'TITLE: one concrete article title under 70 characters.',
    'STRUCTURE: a 3-6 point bullet outline (H2 sections) with a short phrase per point.',
    'KEY_POINTS: a 2-4 point bullet list of key points the article must address.',
    'Ground everything in the provided evidence. Do not invent search volume, keyword difficulty, CPC, rankings, traffic or any other unsupported metric.',
  ].join('\n');
}

/**
 * Prompt that asks the model to write the actual article draft for the brief.
 * The draft must follow the brief, satisfy the intent, be genuinely useful,
 * and avoid keyword stuffing or fabricated facts. It is explicitly an
 * AI-assisted draft for human review, never presented as researched fact.
 */
export function buildContentDraftPrompt(brief: OpportunityContentBrief, domain: string): string {
  return [
    'You are writing a draft article for the website ' + domain + '.',
    `Target search query: "${brief.targetTopic}".`,
    `Search intent to satisfy: ${brief.searchIntent}.`,
    `Recommended angle: ${brief.angle}`,
    `Suggested title: ${brief.suggestedTitle}`,
    `Use this structure: ${brief.structure.map((point, index) => `${index + 1}. ${point}`).join(' ')}`,
    `Key points the article must address: ${brief.keyPoints.map((point) => `- ${point}`).join(' ')}`,
    'Write a complete, useful draft article in Markdown with H1 and H2 headings that follows this structure.',
    'The article must be genuinely helpful to a real reader and must not stuff keywords.',
    'Do not invent statistics, studies, prices, dates or any facts that were not provided. Where a claim needs verification, write it in a neutral way or flag it as needing review.',
    'End the draft with a short italic note: this is an AI-generated draft that requires human review before publication.',
  ].join('\n');
}