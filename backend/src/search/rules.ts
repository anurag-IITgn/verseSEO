import { TITLE_MAX_LENGTH, TITLE_MIN_LENGTH } from '../analysis/rules.js';
import type { OpportunityPriority } from './types.js';

/**
 * Centralized scoring model for search opportunities.
 *
 * score = relevance (0-40) + impact (0-30) + confidence (0-30), clamped to 0-100.
 * - relevance: how central a topic is to the site, based on how many crawled
 *   pages reference it (document frequency). A topic mentioned on more pages
 *   is considered more relevant to the site.
 * - impact: how large the identified gap/weakness is. Missing topics score
 *   highest; thin coverage and missing page signals score moderately.
 * - confidence: how many real signals support the inference (number of pages
 *   referencing the topic, whether a page is indexable/canonical, etc.).
 *
 * These are NOT search-volume, ranking, CPC or keyword-difficulty values.
 * They describe the strength of an opportunity inferred from the site's own
 * crawled content and structure.
 */
export const MAX_OPPORTUNITIES = 12;
export const MAX_PER_TYPE = 4;

export const CORE_TOPIC_MIN_DOC_FREQ = 2;
export const WEAK_COVERAGE_WORDS = 800;
export const WEAK_PAGE_WORDS = 300;
export const INTENT_PAGE_MIN_WORDS = 400;
export const META_MIN_LENGTH = 50;
export const SIGNIFICANT_TOKEN_MIN_LENGTH = 4;

export const RELEVANCE_MAX = 40;
export const IMPACT_MAX = 30;
export const CONFIDENCE_MAX = 30;
export const HIGH_PRIORITY_MIN = 70;
export const MEDIUM_PRIORITY_MIN = 40;

/** Generic/function words and web boilerplate that are not useful topics. */
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'not', 'no', 'nor', 'so', 'yet', 'than', 'then',
  'that', 'this', 'these', 'those', 'there', 'here', 'when', 'where', 'which', 'who', 'whom', 'whose', 'what',
  'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
  'same', 'very', 'just', 'too', 'also', 'even', 'still', 'until', 'while', 'about', 'above', 'below', 'under',
  'over', 'through', 'during', 'before', 'after', 'again', 'further', 'once', 'off', 'out', 'up', 'down', 'into',
  'onto', 'upon', 'within', 'without', 'between', 'among', 'across', 'against', 'because', 'every', 'together',
  // generic web boilerplate unlikely to be a useful target topic
  'page', 'pages', 'site', 'website', 'web', 'home', 'index', 'content', 'article', 'articles', 'blog', 'read',
  'more', 'learn', 'info', 'information', 'click', 'here', 'link', 'links', 'view', 'visit', 'www', 'http',
  'https', 'com', 'html', 'php', 'aspx', 'default', 'main', 'about', 'contact', 'privacy', 'terms', 'login',
  'register', 'signup', 'sign', 'news', 'latest', 'menu', 'footer', 'header', 'search', 'results', 'result',
  'items', 'item', 'list', 'lists', 'category', 'categories', 'tag', 'tags', 'archive', 'archives',
]);

/** Title words that hint at a search intent a thin page may not satisfy. */
export const INTENT_MODIFIERS = [
  'best', 'how to', 'guide', 'vs', 'versus', 'compare', 'comparison', 'top', 'review', 'reviews', 'template',
  'calculator', 'checker', 'free', 'tool', 'tools', 'examples', 'example', 'near me', 'tips', 'list', 'cost',
  'price', 'cheap', 'alternative', 'alternatives', 'recommendation', 'recommendations', 'for beginners',
  'step by step', 'step-by-step',
];

export function scoreToPriority(score: number): OpportunityPriority {
  if (score >= HIGH_PRIORITY_MIN) return 'high';
  if (score >= MEDIUM_PRIORITY_MIN) return 'medium';
  return 'low';
}

export { TITLE_MIN_LENGTH, TITLE_MAX_LENGTH };