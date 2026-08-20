import type { CoverageState, OpportunityType, SearchIntent } from './types.js';

/**
 * Deterministic search-intent classification. No external calls are made and no
 * search-volume metrics are involved: the classifier only inspects the phrase
 * text and, for navigational intent, the site's own brand (derived from its
 * domain). Precedence: navigational > commercial > transactional > informational.
 *
 * - navigational: the phrase names the site/brand itself.
 * - commercial: the phrase implies comparing options before a decision.
 * - transactional: the phrase implies using a tool or performing a purchase.
 * - informational: everything else (also the default when no signal matches).
 */
const COMMERCIAL_WORDS = [
  'best', 'top', 'review', 'reviews', 'alternative', 'alternatives', 'vs', 'versus', 'compare', 'comparison',
  'cheap', 'affordable', 'recommendation', 'recommendations', 'rating', 'ratings', 'list',
];

const COMMERCIAL_PHRASES = ['for beginners'];

const TRANSACTIONAL_WORDS = [
  'calculator', 'checker', 'tool', 'tools', 'builder', 'generator', 'maker', 'creator', 'tracker', 'converter',
  'finder', 'pricing', 'price', 'prices', 'cost', 'costs', 'buy', 'purchase', 'order', 'subscription', 'trial',
  'download', 'signup', 'coupon', 'discount', 'invoice', 'estimate', 'quote', 'template', 'templates', 'rate',
  'rates', 'free',
];

const INFORMATIONAL_WORDS = [
  'tips', 'tutorial', 'tutorials', 'faq', 'explain', 'learn', 'difference', 'definition', 'meaning', 'guide',
  'guides', 'walkthrough', 'basics', 'overview', 'introduction', 'examples', 'example',
];

const INFORMATIONAL_PHRASES = ['how to', 'how much', 'what is', 'what are', 'step by step', 'step-by-step'];

function navigationalMatch(phrase: string, brand: string | null): boolean {
  if (!brand) return false;
  const compactPhrase = phrase.replace(/[^a-z0-9]/g, '');
  const compactBrand = brand.toLowerCase().replace(/[^a-z0-9]/g, '');
  return compactPhrase.length >= 4 && compactPhrase === compactBrand;
}

function hasAnyWord(tokens: Set<string>, words: string[]): boolean {
  return words.some((word) => tokens.has(word));
}

export function classifyIntent(query: string, brand: string | null): SearchIntent {
  const phrase = query.toLowerCase().trim();
  if (navigationalMatch(phrase, brand)) return 'navigational';

  const tokens = new Set(phrase.split(/[^a-z0-9]+/).filter(Boolean));
  if (hasAnyWord(tokens, COMMERCIAL_WORDS) || COMMERCIAL_PHRASES.some((value) => phrase.includes(value))) {
    return 'commercial';
  }
  if (hasAnyWord(tokens, TRANSACTIONAL_WORDS)) return 'transactional';
  if (hasAnyWord(tokens, INFORMATIONAL_WORDS) || INFORMATIONAL_PHRASES.some((value) => phrase.includes(value))) {
    return 'informational';
  }
  return 'informational';
}

/**
 * Coverage state implied by an opportunity type. Only GAP and IMPROVEMENT are
 * ever emitted as opportunities: adequately covered topics (EXISTING) need no
 * action and are deliberately not reported.
 */
export function coverageForType(type: OpportunityType): CoverageState {
  if (type === 'CONTENT_GAP') return 'GAP';
  return 'IMPROVEMENT';
}