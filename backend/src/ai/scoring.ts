import type { AiStance } from './mentionDetection.js';

export interface ScoredVisibility {
  mentioned: boolean;
  cited: boolean;
  stance: AiStance;
  visibilityScore: number;
}

export const MENTION_POINTS = 30;
export const CITATION_POINTS = 40;
export const RECOMMENDATION_POINTS = 30;
export const NEUTRAL_POINTS = 10;
export const NEGATIVE_POINTS = -10;

const min = (a: number, b: number): number => (a < b ? a : b);
const max = (a: number, b: number): number => (a > b ? a : b);

/**
 * Transparent AI visibility score for one provider response, derived only from
 * observed results in the actual answer text:
 *
 *   visibilityScore (0-100) = clamp(0,
 *     +40 if the business/domain URL is cited in the response
 *     +30 if the business/domain is mentioned in the response
 *     +30 if the response recommends the business
 *     +10 if the response mentions it neutrally
 *     -10 if the response mentions it negatively
 *   )
 *
 * This is OUR visibility score for the model's answer — it is not a search
 * engine ranking and not a "#3 on Google" style claim.
 */
export function scoreVisibility(input: { mentioned: boolean; cited: boolean; stance: AiStance }): ScoredVisibility {
  let score = 0;
  if (input.cited) score += CITATION_POINTS;
  if (input.mentioned) score += MENTION_POINTS;
  if (input.mentioned) {
    if (input.stance === 'recommendation') score += RECOMMENDATION_POINTS;
    else if (input.stance === 'neutral') score += NEUTRAL_POINTS;
    else if (input.stance === 'negative') score += NEGATIVE_POINTS;
  }
  score = max(0, min(100, score));
  return { mentioned: input.mentioned, cited: input.cited, stance: input.stance, visibilityScore: score };
}