import type { AnalyzablePage } from '../analysis/types.js';
import { isContentEligible, slugPhrase } from '../search/extract.js';
import { analyzeSearchOpportunities } from '../search/opportunities.js';
import { CORE_TOPIC_MIN_DOC_FREQ, STOPWORDS } from '../search/rules.js';

export const MAX_REDDIT_QUERIES = 8;
export const MIN_REDDIT_QUERIES = 3;

export interface RedditQuerySelection {
  queries: string[];
  coreTopicTerms: string[];
}

const OPPORTUNITY_TYPES = new Set(['CONTENT_GAP', 'SEARCH_INTENT_GAP', 'WEAK_TOPIC_COVERAGE']);

const MAX_TITLE_PHRASE_TOKENS = 4;
const MAX_SLUG_PHRASE_TOKENS = 5;
const MAX_PHRASE_CHARS = 40;

/**
 * Single words that are too generic to be a useful Reddit search on their own
 * (e.g. "calculator", "tool", "percentage"). A word is only rejected when it
 * stands alone; phrases built from the site's actual content that contain the
 * word (e.g. "tip calculator", "restaurant bills") are still kept because they
 * describe something specific a Reddit user could discuss.
 */
const NOISE_TERMS = new Set([
  'tool', 'tools', 'guide', 'guides', 'app', 'apps', 'application', 'applications',
  'website', 'websites', 'software', 'business', 'businesses', 'company', 'companies',
  'service', 'services', 'online', 'free', 'best', 'top', 'fast', 'quick', 'quickly',
  'simple', 'easy', 'help', 'helpful', 'info', 'information', 'example', 'examples',
  'feature', 'features', 'function', 'functions', 'result', 'results', 'make', 'making',
  'works', 'working', 'good', 'great', 'use', 'used', 'using',
  'calculator', 'calculators', 'calculate', 'calculated', 'calculating',
  'percentage', 'percent', 'amount', 'amounts', 'total', 'totals', 'splits',
  'choose', 'copy', 'round', 'select', 'enter', 'input', 'value', 'values',
  'number', 'numbers', 'price', 'prices', 'rate', 'rates',
  'solution', 'solutions', 'platform', 'provider', 'suite',
  // function / filler words that never name a topic by themselves
  'our', 'your', 'their', 'ours', 'theirs', 'provide', 'provides', 'provided',
  'offer', 'offers', 'offered', 'get', 'gets', 'got', 'need', 'needs', 'want',
  'wants', 'find', 'finds', 'help', 'helps', 'various', 'many', 'stuff',
  'things', 'thing', 'one', 'two', 'three', 'first', 'second', 'third',
  'like', 'just', 'really', 'very', 'also', 'new', 'old', 'next', 'last',
  'faq', 'meta', 'title', 'description', 'descriptive', 'valid', 'default',
  'generic', 'sample', 'placeholder',
]);

/**
 * Tokens worth searching on Reddit: at least 3 characters (so short topical
 * words like "tip" survive), not purely numeric and not a generic stopword.
 */
function redditTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => {
      if (token.length < 3) return false;
      if (/^[0-9]+$/.test(token)) return false;
      if (STOPWORDS.has(token)) return false;
      return true;
    });
}

type CandidateKind = 'single' | 'bigram' | 'phrase' | 'opportunity';

interface RedditTerm {
  term: string;
  /** Significant (non-stopword) tokens of the term, in content order. */
  tokens: string[];
  pageIds: Set<string>;
  dedicated: boolean;
  kind: CandidateKind;
}

function topicTokens(tokens: string[]): string[] {
  return tokens.filter((token) => !NOISE_TERMS.has(token));
}

function candidateScore(term: RedditTerm): number {
  const docFreq = term.pageIds.size;
  const topics = topicTokens(term.tokens);
  const allTopic = topics.length === term.tokens.length && term.tokens.length > 0;
  let specificity = 0;
  if (term.kind === 'opportunity') specificity = 50;
  else if (term.kind === 'phrase') specificity = allTopic ? 30 : 15;
  else if (term.kind === 'bigram') {
    // Phrases that begin with a generic word ("calculator restaurant") are less
    // specific than ones that begin with a concrete topic ("tip percentage").
    specificity = allTopic ? 25 : NOISE_TERMS.has(term.tokens[0]) ? 5 : 10;
  } else specificity = allTopic ? 5 : 0;
  return docFreq * 20 + (term.dedicated ? 10 : 0) + specificity;
}

function isNoiseOnly(term: RedditTerm): boolean {
  return term.kind === 'single' ? NOISE_TERMS.has(term.term) : topicTokens(term.tokens).length === 0;
}

/** True when a bigram's tokens appear adjacently inside a kept phrase, e.g. "tip by country" subsumes "tip country". */
function bigramSubsumedByPhrase(term: RedditTerm, all: RedditTerm[]): boolean {
  if (term.kind !== 'bigram' || term.tokens.length < 2) return false;
  for (const other of all) {
    if (other.kind !== 'phrase') continue;
    for (let i = 0; i < other.tokens.length - 1; i += 1) {
      if (other.tokens[i] === term.tokens[0] && other.tokens[i + 1] === term.tokens[1]) return true;
    }
  }
  return false;
}

const KIND_RANK: Record<CandidateKind, number> = { single: 0, bigram: 1, phrase: 2, opportunity: 3 };

/**
 * Reddit query selection for a crawl's real pages.
 *
 * Unlike the search-opportunity layer this feeds, query generation must not
 * depend on topics repeating across pages: a small site with a handful of
 * pages can still clearly be about "tip calculator", "how much to tip",
 * "restaurant tipping", etc. Candidates come only from the site's own content
 * (titles, meta descriptions and URL slugs) plus the existing search
 * opportunities, then are ranked, noise-filtered and deduplicated down to a
 * small bounded set. Scoring retrieved conversations stays in the scoring
 * layer; this function only decides which conversations are worth searching
 * for.
 */
export function selectRedditQueries(pages: AnalyzablePage[]): RedditQuerySelection {
  const terms = new Map<string, RedditTerm>();

  const register = (pageId: string, term: string, tokens: string[], dedicated: boolean, kind: CandidateKind): void => {
    if (term.length < 3) return;
    const existing = terms.get(term);
    if (existing) {
      existing.pageIds.add(pageId);
      existing.dedicated = existing.dedicated || dedicated;
      if (KIND_RANK[kind] > KIND_RANK[existing.kind]) existing.kind = kind;
      return;
    }
    terms.set(term, { term, tokens, pageIds: new Set([pageId]), dedicated, kind });
  };

  const addPhrase = (pageId: string, raw: string, maxTokens: number): void => {
    const tokens = redditTokens(raw);
    if (tokens.length === 0) return;
    if (tokens.length > maxTokens) return;
    const term = raw.trim().toLowerCase();
    if (term.length > MAX_PHRASE_CHARS) return;
    register(pageId, term, tokens, true, 'phrase');
  };

  const registerTokens = (pageId: string, tokens: string[], dedicated: boolean): void => {
    for (let i = 0; i < tokens.length; i += 1) {
      register(pageId, tokens[i], [tokens[i]], dedicated, 'single');
      if (i > 0) {
        const bigram = `${tokens[i - 1]} ${tokens[i]}`;
        register(pageId, bigram, [tokens[i - 1], tokens[i]], dedicated, 'bigram');
      }
    }
  };

  for (const page of pages) {
    // Redirected/thin pages carry no body, but their URL slugs are real
    // topical evidence (e.g. /how-much-to-tip), so slugs are always used.
    const slug = slugPhrase(page.url);
    const slugTokens = redditTokens(slug);
    if (slugTokens.length >= 1 && slugTokens.length <= MAX_SLUG_PHRASE_TOKENS) addPhrase(page.id, slug, MAX_SLUG_PHRASE_TOKENS);
    registerTokens(page.id, slugTokens, true);

    if (!isContentEligible(page)) continue;
    const title = page.title ?? '';
    const meta = page.metaDescription ?? '';

    const titleTokens = redditTokens(title);
    const metaTokens = redditTokens(meta);

    // Short, self-contained titles read naturally as queries, so keep their
    // raw phrase (stopwords included) when it is short and topical.
    if (titleTokens.length >= 2 && titleTokens.length <= MAX_TITLE_PHRASE_TOKENS) addPhrase(page.id, title, MAX_TITLE_PHRASE_TOKENS);

    registerTokens(page.id, titleTokens, true);
    registerTokens(page.id, metaTokens, false);
  }

  // Existing search opportunities are already grounded and ranked by the search
  // module; fold them in as strong candidates when they are not noise.
  for (const opportunity of analyzeSearchOpportunities(pages).opportunities) {
    if (!OPPORTUNITY_TYPES.has(opportunity.type)) continue;
    const term = opportunity.query.trim().toLowerCase();
    const tokens = redditTokens(term);
    if (tokens.length === 0) continue;
    const existing = terms.get(term);
    if (existing) {
      existing.kind = 'opportunity';
    } else {
      terms.set(term, { term, tokens, pageIds: new Set(), dedicated: true, kind: 'opportunity' });
    }
  }

  const usable = [...terms.values()].filter((term) => !isNoiseOnly(term) && !bigramSubsumedByPhrase(term, [...terms.values()]));

  const ranked = usable
    .map((term) => ({ term: term.term, score: candidateScore(term) }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));

  const coreTopicTerms = usable
    .filter((term) => term.pageIds.size >= CORE_TOPIC_MIN_DOC_FREQ)
    .map((term) => term.term)
    .sort((a, b) => {
      const scoreA = candidateScore(terms.get(a) as RedditTerm);
      const scoreB = candidateScore(terms.get(b) as RedditTerm);
      return scoreB - scoreA || a.localeCompare(b);
    });

  return { queries: ranked.slice(0, MAX_REDDIT_QUERIES).map((entry) => entry.term), coreTopicTerms };
}