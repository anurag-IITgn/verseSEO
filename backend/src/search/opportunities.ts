import type { AnalyzablePage } from '../analysis/types.js';
import { buildPageProfiles, extractTopics, isContentEligible, type PageProfile, type Topic } from './extract.js';
import { classifyIntent, coverageForType } from './intent.js';
import {
  CONFIDENCE_MAX,
  CORE_TOPIC_MIN_DOC_FREQ,
  IMPACT_MAX,
  INTENT_MODIFIERS,
  INTENT_PAGE_MIN_WORDS,
  MAX_OPPORTUNITIES,
  MAX_PER_TYPE,
  META_MIN_LENGTH,
  RELEVANCE_MAX,
  scoreToPriority,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
  WEAK_COVERAGE_WORDS,
  WEAK_PAGE_WORDS,
} from './rules.js';
import type {
  CoverageState,
  OpportunityEvidence,
  OpportunityType,
  SearchIntent,
  SearchOpportunitiesResult,
  SearchOpportunityInput,
} from './types.js';

interface OpportunitySpec {
  query: string;
  type: OpportunityType;
  intent: SearchIntent;
  coverage: CoverageState;
  evidence: OpportunityEvidence;
  relevance: number;
  impact: number;
  confidence: number;
  reason: string;
  suggestedAction: string;
  relatedPage: AnalyzablePage | null;
}

const min = (a: number, b: number): number => (a < b ? a : b);
const max = (a: number, b: number): number => (a > b ? a : b);

function relevanceFor(topic: Topic): number {
  return min(RELEVANCE_MAX, 5 * min(topic.docFreq, 8));
}

function bestTopicForPage(profile: PageProfile, coreTopics: Topic[]): Topic | null {
  let best: Topic | null = null;
  let bestScore = 0;
  for (const topic of coreTopics) {
    if (!topic.tokens.every((token) => profile.allTokens.has(token))) continue;
    if (topic.docFreq > bestScore) {
      best = topic;
      bestScore = topic.docFreq;
    }
  }
  return best;
}

function makeOpportunity(spec: OpportunitySpec): SearchOpportunityInput {
  const relevance = Math.round(max(0, min(RELEVANCE_MAX, spec.relevance)));
  const impact = Math.round(max(0, min(IMPACT_MAX, spec.impact)));
  const confidence = Math.round(max(0, min(CONFIDENCE_MAX, spec.confidence)));
  const total = max(0, min(100, relevance + impact + confidence));
  return {
    query: spec.query,
    type: spec.type,
    intent: spec.intent,
    coverage: spec.coverage,
    evidence: spec.evidence,
    score: { relevance, impact, confidence, total, priority: scoreToPriority(total) },
    reason: spec.reason,
    suggestedAction: spec.suggestedAction,
    relatedPageId: spec.relatedPage?.id ?? null,
    relatedPageUrl: spec.relatedPage?.url ?? null,
  };
}

/** Evidence pointing back at the pages/phrases that triggered an opportunity. */
function evidenceFor(pages: Array<AnalyzablePage | null | undefined>, phrases: string[], cap = 5): OpportunityEvidence {
  const seen = new Set<string>();
  const sourcePages: Array<{ url: string; id: string | null }> = [];
  for (const page of pages) {
    if (!page || seen.has(page.url)) continue;
    seen.add(page.url);
    sourcePages.push({ url: page.url, id: page.id });
    if (sourcePages.length >= cap) break;
  }
  return { sourcePages, sourcePhrases: phrases.slice(0, cap) };
}

/** Site brand (domain minus TLD) used for navigational-intent detection. */
function siteBrand(pages: AnalyzablePage[]): string | null {
  for (const page of pages) {
    try {
      return new URL(page.url).hostname.replace(/^www\./, '').split('.')[0];
    } catch {
      continue;
    }
  }
  return null;
}

/** Utility/boilerplate paths (about, contact, legal) that are not content pages. */
const UTILITY_PATH_PATTERN = /^\/(about|contact|privacy|terms|legal|tos|login|register|signup)([/?#]|$)/i;

function isUtilityPage(url: string): boolean {
  try {
    return UTILITY_PATH_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Deterministic search-opportunity analysis over a crawl's real pages.
 * All inference is derived from crawled titles, meta descriptions, URLs,
 * word counts and internal-link structure. No external metrics are produced.
 * Each opportunity carries a classified search intent, a coverage state
 * (GAP vs IMPROVEMENT) and the evidence (pages/phrases) that triggered it.
 */
export function analyzeSearchOpportunities(pages: AnalyzablePage[]): SearchOpportunitiesResult {
  const contentPages = pages.filter(isContentEligible);
  if (contentPages.length === 0) {
    return { opportunities: [], total: 0, topicsAnalyzed: 0 };
  }

  const { topics, profiles } = extractTopics(contentPages);
  const coreTopics = [...topics.values()]
    .filter((topic) => topic.docFreq >= CORE_TOPIC_MIN_DOC_FREQ)
    .sort((a, b) => b.docFreq - a.docFreq || a.term.localeCompare(b.term));

  const byId = new Map(contentPages.map((page) => [page.id, page]));
  const byUrl = new Map(contentPages.map((page) => [page.url, page]));
  const brand = siteBrand(contentPages);

  const opportunities: SearchOpportunityInput[] = [];

  // ---- Topic-level: CONTENT_GAP and WEAK_TOPIC_COVERAGE ----
  for (const topic of coreTopics) {
    const coveringPages = topic.coveringPageIds
      .map((id) => byId.get(id))
      .filter((page): page is AnalyzablePage => Boolean(page));
    const totalWords = coveringPages.reduce((sum, page) => sum + (page.wordCount ?? 0), 0);

    if (topic.dedicatedPageIds.length === 0) {
      // Referenced across the site but no page targets it directly -> content gap.
      const related = coveringPages.sort((a, b) => (b.wordCount ?? 0) - (a.wordCount ?? 0))[0] ?? null;
      opportunities.push(
        makeOpportunity({
          query: topic.term,
          type: 'CONTENT_GAP',
          intent: classifyIntent(topic.term, brand),
          coverage: coverageForType('CONTENT_GAP'),
          evidence: evidenceFor(coveringPages, [topic.term]),
          relevance: relevanceFor(topic),
          impact: IMPACT_MAX,
          confidence: min(CONFIDENCE_MAX, 10 + 4 * topic.docFreq),
          reason: `The site references "${topic.term}" on ${topic.docFreq} page(s) but no page targets it directly.`,
          suggestedAction: `Create a dedicated, indexable page focused on "${topic.term}".`,
          relatedPage: related,
        }),
      );
    } else {
      const dedicatedPages = topic.dedicatedPageIds
        .map((id) => byId.get(id))
        .filter((page): page is AnalyzablePage => Boolean(page));
      const thinPages = dedicatedPages.filter((page) => (page.wordCount ?? 0) < WEAK_PAGE_WORDS);
      if (totalWords < WEAK_COVERAGE_WORDS || thinPages.length > 0) {
        const related = [...dedicatedPages].sort((a, b) => (b.wordCount ?? 0) - (a.wordCount ?? 0))[0];
        opportunities.push(
          makeOpportunity({
            query: topic.term,
            type: 'WEAK_TOPIC_COVERAGE',
            intent: classifyIntent(topic.term, brand),
            coverage: coverageForType('WEAK_TOPIC_COVERAGE'),
            evidence: evidenceFor(dedicatedPages, [topic.term]),
            relevance: relevanceFor(topic),
            impact: max(5, IMPACT_MAX - Math.floor(totalWords / 50)),
            confidence: min(CONFIDENCE_MAX, 10 + 3 * topic.docFreq + topic.dedicatedPageIds.length * 2),
            reason: `"${topic.term}" is covered by only ${totalWords} words across ${topic.dedicatedPageIds.length} page(s).`,
            suggestedAction: `Expand coverage of "${topic.term}" with at least ${WEAK_COVERAGE_WORDS} words of dedicated content.`,
            relatedPage: related,
          }),
        );
      }
    }
  }

  // ---- Page-level: EXISTING_PAGE_OPTIMIZATION ----
  for (const page of contentPages) {
    const profile = profiles.get(page.id);
    if (!profile) continue;
    const topTopic = bestTopicForPage(profile, coreTopics);
    const relevance = topTopic ? relevanceFor(topTopic) : 5;
    const confidence = min(
      CONFIDENCE_MAX,
      16 + (page.isIndexable === false ? 0 : 4) + (page.canonicalUrl ? 4 : 0) + (profile.title ? 3 : 0) + (profile.meta ? 3 : 0),
    );

    const missingSlugToken = profile.slugTokens.find((token) => !profile.titleTokens.includes(token) && !profile.metaTokens.includes(token));

    const pageOpts: SearchOpportunityInput[] = [];

    if (!profile.title) {
      const query = topTopic?.term ?? (profile.slug || page.url);
      pageOpts.push(
        makeOpportunity({
          query,
          type: 'EXISTING_PAGE_OPTIMIZATION',
          intent: classifyIntent(query, brand),
          coverage: coverageForType('EXISTING_PAGE_OPTIMIZATION'),
          evidence: evidenceFor([page], [profile.slug || page.url]),
          relevance,
          impact: 18 + (missingSlugToken ? 4 : 0),
          confidence,
          reason: `${page.url} has no title tag.`,
          suggestedAction: `Write a descriptive title (${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH} characters) for this page.`,
          relatedPage: page,
        }),
      );
    } else {
      if (profile.title.length < TITLE_MIN_LENGTH || profile.title.length > TITLE_MAX_LENGTH) {
        const query = topTopic?.term ?? profile.title;
        pageOpts.push(
          makeOpportunity({
            query,
            type: 'EXISTING_PAGE_OPTIMIZATION',
            intent: classifyIntent(query, brand),
            coverage: coverageForType('EXISTING_PAGE_OPTIMIZATION'),
            evidence: evidenceFor([page], [profile.title]),
            relevance,
            impact: 18,
            confidence,
            reason: `The title of ${page.url} is ${profile.title.length} characters (recommended ${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH}).`,
            suggestedAction: 'Rewrite the title to the recommended length while keeping the page\'s primary topic.',
            relatedPage: page,
          }),
        );
      }
    }

    if (!profile.meta) {
      const query = topTopic?.term ?? (profile.title || page.url);
      pageOpts.push(
        makeOpportunity({
          query,
          type: 'EXISTING_PAGE_OPTIMIZATION',
          intent: classifyIntent(query, brand),
          coverage: coverageForType('EXISTING_PAGE_OPTIMIZATION'),
          evidence: evidenceFor([page], [profile.title || profile.slug || page.url]),
          relevance,
          impact: 16,
          confidence,
          reason: `${page.url} is missing a meta description.`,
          suggestedAction: 'Add a descriptive meta description that summarises the page\'s topic.',
          relatedPage: page,
        }),
      );
    } else if (profile.meta.length < META_MIN_LENGTH) {
      const query = topTopic?.term ?? profile.title;
      pageOpts.push(
        makeOpportunity({
          query,
          type: 'EXISTING_PAGE_OPTIMIZATION',
          intent: classifyIntent(query, brand),
          coverage: coverageForType('EXISTING_PAGE_OPTIMIZATION'),
          evidence: evidenceFor([page], [profile.title]),
          relevance,
          impact: 14,
          confidence,
          reason: `The meta description of ${page.url} is only ${profile.meta.length} characters (recommended at least ${META_MIN_LENGTH}).`,
          suggestedAction: 'Expand the meta description to a full, descriptive sentence.',
          relatedPage: page,
        }),
      );
    }

    if (missingSlugToken) {
      const query = topTopic?.term ?? missingSlugToken;
      pageOpts.push(
        makeOpportunity({
          query,
          type: 'EXISTING_PAGE_OPTIMIZATION',
          intent: classifyIntent(query, brand),
          coverage: coverageForType('EXISTING_PAGE_OPTIMIZATION'),
          evidence: evidenceFor([page], [missingSlugToken]),
          relevance,
          impact: 14,
          confidence,
          reason: `The URL of ${page.url} targets "${missingSlugToken}" but the title and meta description do not mention it.`,
          suggestedAction: `Align the title and meta description with the "${missingSlugToken}" topic in the URL.`,
          relatedPage: page,
        }),
      );
    }

    opportunities.push(...pageOpts.slice(0, 2));
  }

  // ---- Page-level: SEARCH_INTENT_GAP ----
  for (const page of contentPages) {
    const profile = profiles.get(page.id);
    if (!profile) continue;
    const title = profile.title;
    if (!title) continue;
    if (isUtilityPage(page.url)) continue;
    const lowerTitle = title.toLowerCase();
    const modifier = INTENT_MODIFIERS.find((value) => lowerTitle.includes(value));
    if (!modifier) continue;

    const words = page.wordCount ?? 0;
    const metaMissing = !profile.meta;
    if (words >= INTENT_PAGE_MIN_WORDS && !metaMissing) continue;

    const topTopic = bestTopicForPage(profile, coreTopics);
    opportunities.push(
      makeOpportunity({
        query: title,
        type: 'SEARCH_INTENT_GAP',
        intent: classifyIntent(title, brand),
        coverage: coverageForType('SEARCH_INTENT_GAP'),
        evidence: evidenceFor([page], [title]),
        relevance: topTopic ? relevanceFor(topTopic) : 8,
        impact: 12 + (words < 200 ? 10 : 6) + (metaMissing ? 4 : 0),
        confidence: min(CONFIDENCE_MAX, 12 + (topTopic ? 3 * topTopic.docFreq : 3) + 4),
        reason: `"${title}" suggests an informational intent ("${modifier}") but the page is thin (${words} words${metaMissing ? ' and has no meta description' : ''}).`,
        suggestedAction: `Expand the page to fully satisfy "${modifier}" search intent with structured, in-depth content.`,
        relatedPage: page,
      }),
    );
  }

  // ---- INTERNAL_LINK_OPPORTUNITY ----
  if (contentPages.length > 1) {
    const incoming = new Map<string, number>();
    for (const page of contentPages) {
      for (const link of page.internalLinks ?? []) {
        const target = byUrl.get(link);
        if (target) incoming.set(target.id, (incoming.get(target.id) ?? 0) + 1);
      }
    }

    for (const page of contentPages) {
      if ((incoming.get(page.id) ?? 0) > 0) continue;
      const profile = profiles.get(page.id);
      const topTopic = profile ? bestTopicForPage(profile, coreTopics) : null;
      const query = topTopic?.term ?? (profile?.slug || page.url);
      opportunities.push(
        makeOpportunity({
          query,
          type: 'INTERNAL_LINK_OPPORTUNITY',
          intent: classifyIntent(query, brand),
          coverage: coverageForType('INTERNAL_LINK_OPPORTUNITY'),
          evidence: evidenceFor([page], [profile?.slug || page.url]),
          relevance: topTopic ? relevanceFor(topTopic) : 5,
          impact: 22,
          confidence: min(CONFIDENCE_MAX, 20 + (topTopic ? 4 * Math.min(topTopic.docFreq, 4) : 0)),
          reason: `${page.url} is not linked from any other page on the site.`,
          suggestedAction: 'Add contextual internal links to this page from related pages.',
          relatedPage: page,
        }),
      );
    }

    // Related pages that cover the same core topic but do not link each other.
    let pairCount = 0;
    for (const topic of coreTopics) {
      if (pairCount >= 2) break;
      if (topic.dedicatedPageIds.length < 2) continue;
      for (let i = 0; i < topic.dedicatedPageIds.length && pairCount < 2; i += 1) {
        for (let j = i + 1; j < topic.dedicatedPageIds.length && pairCount < 2; j += 1) {
          const a = byId.get(topic.dedicatedPageIds[i]);
          const b = byId.get(topic.dedicatedPageIds[j]);
          if (!a || !b) continue;
          const linksA = new Set(a.internalLinks ?? []);
          const linksB = new Set(b.internalLinks ?? []);
          if (linksA.has(b.url) || linksB.has(a.url)) continue;
          opportunities.push(
            makeOpportunity({
              query: topic.term,
              type: 'INTERNAL_LINK_OPPORTUNITY',
              intent: classifyIntent(topic.term, brand),
              coverage: coverageForType('INTERNAL_LINK_OPPORTUNITY'),
              evidence: evidenceFor([a, b], [topic.term]),
              relevance: relevanceFor(topic),
              impact: 16 + (topic.docFreq >= 3 ? 4 : 0),
              confidence: min(CONFIDENCE_MAX, 12 + 4 * Math.min(topic.docFreq, 4)),
              reason: `${a.url} and ${b.url} both cover "${topic.term}" but do not link to each other.`,
              suggestedAction: `Add contextual internal links between ${a.url} and ${b.url}.`,
              relatedPage: a,
            }),
          );
          pairCount += 1;
        }
      }
    }
  }

  // ---- Deduplicate, cap per type, sort, cap total ----
  const seen = new Set<string>();
  const unique = opportunities.filter((opportunity) => {
    const key = `${opportunity.type}|${opportunity.query.toLowerCase()}|${opportunity.relatedPageUrl ?? ''}|${opportunity.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const perType = new Map<OpportunityType, number>();
  const capped = unique.filter((opportunity) => {
    const count = perType.get(opportunity.type) ?? 0;
    if (count >= MAX_PER_TYPE) return false;
    perType.set(opportunity.type, count + 1);
    return true;
  });

  const sorted = capped.sort((a, b) => b.score.total - a.score.total || a.query.localeCompare(b.query));

  return { opportunities: sorted.slice(0, MAX_OPPORTUNITIES), total: Math.min(sorted.length, MAX_OPPORTUNITIES), topicsAnalyzed: topics.size };
}