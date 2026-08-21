import type { IssueSeverity, IssueType } from './types.js';

/**
 * Centralized scoring model for technical SEO analysis.
 *
 * Health Score = 100 - total penalty from verified issues.
 * Penalty per issue is derived from its severity weight. Results are
 * clamped to the range [0, 100].
 *
 * Keep all weights and thresholds in this single module so the scoring
 * model is easy to inspect and modify.
 */
export const MAX_HEALTH_SCORE = 100;

export const SEVERITY_WEIGHTS: Record<IssueSeverity, number> = {
  error: 4,
  warning: 2,
  info: 1,
};

export const TITLE_MIN_LENGTH = 30;
export const TITLE_MAX_LENGTH = 60;

export const DEFAULT_SEVERITY: Record<IssueType, IssueSeverity> = {
  MISSING_TITLE: 'error',
  DUPLICATE_TITLE: 'warning',
  TITLE_TOO_SHORT: 'warning',
  TITLE_TOO_LONG: 'warning',
  MISSING_META_DESCRIPTION: 'error',
  DUPLICATE_META_DESCRIPTION: 'warning',
  MISSING_CANONICAL: 'warning',
  BROKEN_INTERNAL_LINK: 'error',
  NON_200_PAGE: 'warning',
  NOINDEX_PAGE: 'warning',
  MISSING_ROBOTS_TXT: 'warning',
  MISSING_SITEMAP: 'warning',
  MISSING_HTTPS: 'error',
  MISSING_H1: 'error',
  DUPLICATE_H1: 'warning',
  IMAGES_MISSING_ALT: 'warning',
  MISSING_OG_TAGS: 'warning',
  MISSING_TWITTER_TAGS: 'info',
  MISSING_VIEWPORT: 'warning',
  MISSING_CHARSET: 'info',
  MISSING_FAVICON: 'info',
  MISSING_HTML_LANG: 'info',
  THIN_CONTENT: 'warning',
  SLOW_RESPONSE: 'warning',
};

export function calculateHealthScore(issues: { severity: IssueSeverity }[]): number {
  const totalPenalty = issues.reduce((sum, issue) => sum + SEVERITY_WEIGHTS[issue.severity], 0);
  return Math.max(0, MAX_HEALTH_SCORE - totalPenalty);
}