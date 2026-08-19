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