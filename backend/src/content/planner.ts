import type { AnalyzablePage } from '../analysis/types.js';
import { extractTopics } from '../search/extract.js';
import { CORE_TOPIC_MIN_DOC_FREQ } from '../search/rules.js';
import type { SearchOpportunityRow } from '../repositories/searchRepo.js';
import type { SeoIssue } from '../repositories/seoRepo.js';
import type { AiVisibilityRow } from '../repositories/aiVisibilityRepo.js';
import type { ContentPriority, ContentSeed, ContentSourceType } from './types.js';

export const MAX_RECOMMENDATIONS = 6;

const PRIORITY_RANK: Record<ContentPriority, number> = { high: 0, medium: 1, low: 2 };

const OPPORTUNITY_SOURCE_TYPES = new Set<ContentSourceType>([
  'CONTENT_GAP',
  'SEARCH_INTENT_GAP',
  'WEAK_TOPIC_COVERAGE',
]);

const INTENT_BY_SOURCE: Record<ContentSourceType, string> = {
  CONTENT_GAP: 'informational',
  SEARCH_INTENT_GAP: 'commercial',
  WEAK_TOPIC_COVERAGE: 'informational',
  SEO_FIX: 'on-page',
  CORE_TOPIC: 'informational',
  AI_VISIBILITY_GAP: 'commercial',
};

const SEVERITY_TO_PRIORITY: Record<string, ContentPriority> = {
  error: 'high',
  warning: 'medium',
  info: 'low',
};

const CONTENT_ISSUE_TYPES = new Set(['MISSING_TITLE', 'TITLE_TOO_SHORT', 'MISSING_META_DESCRIPTION']);

/** The topic a stored AI-visibility prompt asks about, e.g. `"...for "tip calculator"?"`. */
export function topicFromPrompt(prompt: string): string {
  const match = prompt.match(/"([^"]+)"/);
  return match ? match[1].trim() : prompt.trim();
}

function pageTopic(page: AnalyzablePage): string {
  if (page.title && page.title.trim().length > 0) return page.title.trim();
  const slug = slugPhrase(page.url);
  if (slug) return slug;
  return page.url;
}

function slugPhrase(url: string): string {
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

/**
 * Deterministic content-idea planning for a specific site, built only from
 * real crawl/analysis data:
 *  - Search Opportunities (content gaps, intent gaps, weak coverage)
 *  - SEO issues that require copy fixes (missing/short titles, missing meta)
 *  - Core topics referenced across pages but not directly targeted
 *  - AI visibility prompts where the site was not mentioned
 *
 * No search volume, CPC, ranking or traffic values are ever invented here.
 */
export function planContentSeeds(input: {
  pages: AnalyzablePage[];
  opportunities: SearchOpportunityRow[];
  issues: SeoIssue[];
  aiResults: AiVisibilityRow[];
}): ContentSeed[] {
  const seeds: ContentSeed[] = [];
  const seen = new Set<string>();

  const push = (seed: ContentSeed): void => {
    const key = seed.topic.trim().toLowerCase();
    if (key.length < 3 || seen.has(key)) return;
    seen.add(key);
    seeds.push(seed);
  };

  for (const opportunity of input.opportunities) {
    const sourceType = opportunity.opportunityType as ContentSourceType;
    if (!OPPORTUNITY_SOURCE_TYPES.has(sourceType)) continue;
    push({
      topic: opportunity.query,
      sourceType,
      priority: (opportunity.priority as ContentPriority) ?? 'medium',
      intent: INTENT_BY_SOURCE[sourceType],
      rationale: `${opportunity.reason} ${opportunity.suggestedAction}`.trim(),
      reference: `Search opportunity "${opportunity.query}" (${sourceType}, priority ${opportunity.priority}): ${opportunity.reason}`,
    });
  }

  const issuesByPage = new Map<string, string[]>();
  for (const issue of input.issues) {
    if (issue.pageId === null) continue;
    if (!CONTENT_ISSUE_TYPES.has(issue.issueType)) continue;
    const types = issuesByPage.get(issue.pageId) ?? [];
    types.push(issue.issueType);
    issuesByPage.set(issue.pageId, types);
  }
  const pagesById = new Map(input.pages.map((page) => [page.id, page]));
  for (const [pageId, issueTypes] of issuesByPage) {
    const page = pagesById.get(pageId);
    if (!page) continue;
    const severity = input.issues.find((i) => i.pageId === pageId && CONTENT_ISSUE_TYPES.has(i.issueType))?.severity ?? 'warning';
    push({
      topic: pageTopic(page),
      sourceType: 'SEO_FIX',
      priority: SEVERITY_TO_PRIORITY[severity] ?? 'medium',
      intent: INTENT_BY_SOURCE.SEO_FIX,
      rationale: `${page.url} has content issues: ${issueTypes.join('; ')}.`,
      reference: `Page ${page.url} (${issueTypes.join('; ')})`,
    });
  }

  const { topics } = extractTopics(input.pages);
  for (const topic of [...topics.values()].sort((a, b) => b.docFreq - a.docFreq || a.term.localeCompare(b.term))) {
    if (topic.docFreq < CORE_TOPIC_MIN_DOC_FREQ) continue;
    if (topic.dedicatedPageIds.length > 0) continue;
    push({
      topic: topic.term,
      sourceType: 'CORE_TOPIC',
      priority: 'medium',
      intent: INTENT_BY_SOURCE.CORE_TOPIC,
      rationale: `Topic "${topic.term}" appears across ${topic.docFreq} pages but no page targets it directly.`,
      reference: `Core topic "${topic.term}" referenced on ${topic.docFreq} pages, no dedicated page`,
    });
  }

  for (const result of input.aiResults) {
    if (result.mentioned) continue;
    const topic = topicFromPrompt(result.prompt);
    push({
      topic,
      sourceType: 'AI_VISIBILITY_GAP',
      priority: 'high',
      intent: INTENT_BY_SOURCE.AI_VISIBILITY_GAP,
      rationale: `The AI provider did not mention the site when asked about "${topic}". Publish content on this topic to earn AI citations.`,
      reference: `AI visibility gap: provider answered "${topic}" without mentioning the site`,
    });
  }

  seeds.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      sourceOrder(a.sourceType) - sourceOrder(b.sourceType) ||
      a.topic.localeCompare(b.topic),
  );

  return seeds.slice(0, MAX_RECOMMENDATIONS);
}

function sourceOrder(sourceType: ContentSourceType): number {
  return ['CONTENT_GAP', 'SEARCH_INTENT_GAP', 'WEAK_TOPIC_COVERAGE', 'AI_VISIBILITY_GAP', 'CORE_TOPIC', 'SEO_FIX'].indexOf(sourceType);
}