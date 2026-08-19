import type { AnalyzablePage } from '../analysis/types.js';
import { SIGNIFICANT_TOKEN_MIN_LENGTH, STOPWORDS } from './rules.js';

export interface PageProfile {
  title: string;
  meta: string;
  slug: string;
  titleTokens: string[];
  metaTokens: string[];
  slugTokens: string[];
  allTokens: Set<string>;
  titleSlugTokens: Set<string>;
}

export interface Topic {
  /** Display term, e.g. "resume builder". */
  term: string;
  tokens: string[];
  isBigram: boolean;
  /** Number of pages that mention the term in title, meta or slug. */
  docFreq: number;
  coveringPageIds: string[];
  /** Pages that mention the term in their title or URL slug (target it directly). */
  dedicatedPageIds: string[];
}

const text = (value: string | null): string => value?.trim() ?? '';

export function isContentEligible(page: AnalyzablePage): boolean {
  if (page.statusCode !== 200) return false;
  if (page.contentType === null) return false;
  return page.contentType.includes('text/html') || page.contentType.includes('application/xhtml+xml');
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Significant words: long enough, not numeric, not stopwords. */
export function significantTokens(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => {
      if (token.length < SIGNIFICANT_TOKEN_MIN_LENGTH) return false;
      if (/^[0-9]+$/.test(token)) return false;
      if (STOPWORDS.has(token)) return false;
      return true;
    });
}

/** Readable phrase derived from a URL path, e.g. /resume-builder-for-students -> "resume builder for students". */
export function slugPhrase(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path
      .replace(/[_-]+/g, ' ')
      .replace(/[^a-z0-9\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

export function buildPageProfiles(pages: AnalyzablePage[]): Map<string, PageProfile> {
  const profiles = new Map<string, PageProfile>();
  for (const page of pages) {
    const title = text(page.title);
    const meta = text(page.metaDescription);
    const slug = slugPhrase(page.url);
    const titleTokens = significantTokens(title);
    const metaTokens = significantTokens(meta);
    const slugTokens = significantTokens(slug);
    profiles.set(page.id, {
      title,
      meta,
      slug,
      titleTokens,
      metaTokens,
      slugTokens,
      allTokens: new Set([...titleTokens, ...metaTokens, ...slugTokens]),
      titleSlugTokens: new Set([...titleTokens, ...slugTokens]),
    });
  }
  return profiles;
}

/** Unigram + adjacent significant bigrams from a phrase's token list. */
function termCandidates(tokens: string[]): string[] {
  const candidates: string[] = [];
  for (const token of tokens) candidates.push(token);
  for (let i = 0; i < tokens.length - 1; i += 1) {
    candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return candidates;
}

/**
 * Deterministic topic extraction from crawled pages' titles, meta descriptions
 * and URL slugs. Each topic's document frequency and "dedicated" pages are
 * computed from real page data.
 */
export function extractTopics(pages: AnalyzablePage[]): { topics: Map<string, Topic>; profiles: Map<string, PageProfile> } {
  const profiles = buildPageProfiles(pages);
  const topics = new Map<string, Topic>();

  const register = (term: string, pageId: string, dedicated: boolean): void => {
    let topic = topics.get(term);
    if (!topic) {
      const tokens = term.split(' ');
      topic = { term, tokens, isBigram: tokens.length >= 2, docFreq: 0, coveringPageIds: [], dedicatedPageIds: [] };
      topics.set(term, topic);
    }
    if (!topic.coveringPageIds.includes(pageId)) {
      topic.coveringPageIds.push(pageId);
      topic.docFreq = topic.coveringPageIds.length;
    }
    if (dedicated && !topic.dedicatedPageIds.includes(pageId)) {
      topic.dedicatedPageIds.push(pageId);
    }
  };

  for (const page of pages) {
    if (!isContentEligible(page)) continue;
    const profile = profiles.get(page.id);
    if (!profile) continue;

    for (const term of termCandidates(profile.titleTokens)) register(term, page.id, true);
    for (const term of termCandidates(profile.metaTokens)) register(term, page.id, false);
    for (const term of termCandidates(profile.slugTokens)) register(term, page.id, true);
  }

  return { topics, profiles };
}