import type { AnalyzablePage } from '../analysis/types.js';
import { extractTopics } from '../search/extract.js';
import type { AiPrompt } from './types.js';

export const MAX_AI_PROMPTS = 5;

/**
 * Deterministic prompt selection for AI visibility, derived entirely from the
 * site's real crawled content. Topics come from the existing topic extractor
 * (titles, meta descriptions and URL slugs), ranked by document frequency and
 * by how specific they are (bigrams first). No hard-coded or per-website
 * prompts. Works for single-page sites too, unlike core-topic selection.
 */
export function selectAiPrompts(pages: AnalyzablePage[]): AiPrompt[] {
  const { topics } = extractTopics(pages);

  const ranked = [...topics.values()]
    .sort((a, b) => {
      if (b.docFreq !== a.docFreq) return b.docFreq - a.docFreq;
      if (a.isBigram !== b.isBigram) return a.isBigram ? -1 : 1;
      return a.term.localeCompare(b.term);
    })
    .slice(0, MAX_AI_PROMPTS);

  return ranked.map((topic) => ({ topic: topic.term, prompt: buildAiPrompt(topic.term) }));
}

/**
 * A neutral topical question. The site's identity is deliberately NOT injected
 * into the prompt so that mention/citation detection reflects what the model
 * independently knows about the business — never a fabricated answer.
 */
export function buildAiPrompt(topic: string): string {
  return (
    'You are a neutral research assistant. Answer concisely with a short list, and only mention tools, services ' +
    'or websites you are reasonably confident exist. Do not invent anything.\n\n' +
    `Question: What are the best tools, services or websites for "${topic}"?`
  );
}