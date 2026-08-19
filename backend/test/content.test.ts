import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalyzablePage } from '../src/analysis/types.js';
import { buildContentBriefPrompt } from '../src/content/prompts.js';
import { parseGeneratedBrief } from '../src/content/parsing.js';
import { planContentSeeds, topicFromPrompt } from '../src/content/planner.js';
import { fallbackStructure } from '../src/content/structure.js';
import type { AiVisibilityRow } from '../src/repositories/aiVisibilityRepo.js';
import type { SearchOpportunityRow } from '../src/repositories/searchRepo.js';
import type { SeoIssue } from '../src/repositories/seoRepo.js';

function makePage(overrides: Partial<AnalyzablePage> = {}): AnalyzablePage {
  return {
    id: 'page-1',
    url: 'https://example.com/',
    statusCode: 200,
    contentType: 'text/html; charset=utf-8',
    title: 'Example Home Page Title',
    metaDescription: 'A descriptive meta description for the example homepage',
    canonicalUrl: null,
    robotsDirective: null,
    isIndexable: true,
    wordCount: 500,
    responseTimeMs: 100,
    internalLinks: [],
    ...overrides,
  };
}

function makeOpportunity(overrides: Partial<SearchOpportunityRow> = {}): SearchOpportunityRow {
  return {
    id: 'op-1',
    crawlRunId: 'crawl-1',
    query: 'resume builder for students',
    opportunityType: 'CONTENT_GAP',
    score: 80,
    priority: 'high',
    relevance: 32,
    impact: 24,
    confidence: 24,
    reason: 'Topic referenced but no page targets it.',
    suggestedAction: 'Publish a dedicated page.',
    relatedPageId: null,
    relatedPageUrl: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeIssue(overrides: Partial<SeoIssue> = {}): SeoIssue {
  return {
    id: 'issue-1',
    crawlRunId: 'crawl-1',
    pageId: 'page-1',
    issueType: 'MISSING_TITLE',
    severity: 'error',
    message: 'Page is missing a title',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeAiResult(overrides: Partial<AiVisibilityRow> = {}): AiVisibilityRow {
  return {
    id: 'ai-1',
    crawlRunId: 'crawl-1',
    prompt: '...for "tip calculator"?',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    rawResponse: 'nothing here',
    mentioned: false,
    cited: false,
    stance: 'absent',
    visibilityScore: 0,
    reason: 'not mentioned',
    competitors: [],
    createdAt: new Date(),
    ...overrides,
  };
}

test('planContentSeeds maps search opportunities into content seeds', () => {
  const seeds = planContentSeeds({
    pages: [makePage()],
    opportunities: [
      makeOpportunity({ query: 'resume builder for students', opportunityType: 'CONTENT_GAP', priority: 'high' }),
      makeOpportunity({ query: 'best resume tool comparison', opportunityType: 'SEARCH_INTENT_GAP', priority: 'medium' }),
    ],
    issues: [],
    aiResults: [],
  });
  assert.equal(seeds.length, 2);
  const gap = seeds.find((s) => s.sourceType === 'CONTENT_GAP');
  assert.ok(gap);
  assert.equal(gap.topic, 'resume builder for students');
  assert.equal(gap.intent, 'informational');
  assert.equal(gap.priority, 'high');
  assert.match(gap.rationale, /Topic referenced/);
  const intentGap = seeds.find((s) => s.sourceType === 'SEARCH_INTENT_GAP');
  assert.equal(intentGap?.intent, 'commercial');
});

test('planContentSeeds maps content SEO issues into SEO_FIX seeds and ignores non-content issues', () => {
  const seeds = planContentSeeds({
    pages: [makePage()],
    opportunities: [],
    issues: [
      makeIssue({ issueType: 'MISSING_TITLE', severity: 'error' }),
      makeIssue({ issueType: 'MISSING_META_DESCRIPTION', severity: 'warning', message: 'Missing meta description' }),
      makeIssue({ issueType: 'BROKEN_INTERNAL_LINK', severity: 'warning', message: 'Broken link' }),
      makeIssue({ issueType: 'TITLE_TOO_SHORT', severity: 'warning', pageId: null, message: 'Short title' }),
    ],
    aiResults: [],
  });
  assert.equal(seeds.length, 1, 'only one page has content issues');
  assert.equal(seeds[0].sourceType, 'SEO_FIX');
  assert.equal(seeds[0].priority, 'high', 'error severity must map to high');
  assert.equal(seeds[0].intent, 'on-page');
  assert.match(seeds[0].rationale, /https:\/\/example\.com/);
});

test('planContentSeeds flags core topics referenced across pages without a dedicated page', () => {
  const seeds = planContentSeeds({
    pages: [
      makePage({ id: 'p1', url: 'https://example.com/templates', title: 'Online Resume Templates', metaDescription: 'Find the best resume builder tools and templates online.' }),
      makePage({ id: 'p2', url: 'https://example.com/examples', title: 'Professional CV Examples', metaDescription: 'Browse professional resume builder guides and examples.' }),
    ],
    opportunities: [],
    issues: [],
    aiResults: [],
  });
  const seed = seeds.find((s) => s.sourceType === 'CORE_TOPIC' && s.topic === 'resume builder');
  assert.ok(seed, 'meta-only core topic must become a content seed');
  assert.equal(seed?.priority, 'medium');
  assert.match(seed?.rationale ?? '', /appears across 2 pages/);
});

test('planContentSeeds turns AI visibility gaps into high-priority commercial seeds', () => {
  const seeds = planContentSeeds({
    pages: [makePage()],
    opportunities: [],
    issues: [],
    aiResults: [
      makeAiResult({ prompt: 'Question: What are the best tools, services or websites for "tip calculator"?', mentioned: false }),
      makeAiResult({ prompt: 'Question: What are the best tools for "resume builder"?', mentioned: true }),
    ],
  });
  assert.equal(seeds.length, 1, 'only the un-mentioned prompt must become a seed');
  assert.equal(seeds[0].sourceType, 'AI_VISIBILITY_GAP');
  assert.equal(seeds[0].priority, 'high');
  assert.equal(seeds[0].topic, 'tip calculator');
  assert.equal(seeds[0].intent, 'commercial');
  assert.match(seeds[0].rationale, /AI provider did not mention/);
});

test('planContentSeeds dedupes topics and caps the output count', () => {
  const opportunities = Array.from({ length: 12 }, (_, i) =>
    makeOpportunity({ query: i % 2 === 0 ? 'duplicate topic' : `topic number ${i}`, priority: i % 3 === 0 ? 'high' : 'medium' }),
  );
  const seeds = planContentSeeds({ pages: [], opportunities, issues: [], aiResults: [] });
  assert.ok(seeds.length <= 6, 'output must be capped');
  const topics = seeds.map((s) => s.topic);
  assert.equal(new Set(topics).size, seeds.length, 'topics must be unique');
  assert.ok(seeds.length >= 1, 'some seeds must survive');
});

test('topicFromPrompt extracts the quoted topic', () => {
  assert.equal(topicFromPrompt('Question: What are the best tools for "tip calculator"?'), 'tip calculator');
  assert.equal(topicFromPrompt('no quotes here'), 'no quotes here');
});

test('parseGeneratedBrief parses a labelled AI brief', () => {
  const brief = parseGeneratedBrief(
    'TITLE: The Complete Guide to Splitting Bills\nINTENT: informational\nSTRUCTURE:\n- Introduction\n- Why it matters\n- Best practices\n- Summary\n',
  );
  assert.equal(brief?.title, 'The Complete Guide to Splitting Bills');
  assert.equal(brief?.intent, 'informational');
  assert.deepEqual(brief?.structure, ['Introduction', 'Why it matters', 'Best practices', 'Summary']);
});

test('parseGeneratedBrief is tolerant and returns null without a title', () => {
  assert.equal(parseGeneratedBrief(''), null);
  assert.equal(parseGeneratedBrief('just some text'), null);
  const noStructure = parseGeneratedBrief('TITLE: Only a title here\nINTENT: commercial');
  assert.equal(noStructure?.title, 'Only a title here');
  assert.deepEqual(noStructure?.structure, []);
});

test('fallbackStructure returns a deterministic outline for any intent', () => {
  assert.ok(fallbackStructure('commercial', 'tip calculator').length >= 3);
  assert.ok(fallbackStructure('on-page', 'fix titles').length >= 3);
  assert.ok(fallbackStructure('informational', 'resume builder').length >= 3);
});

test('buildContentBriefPrompt grounds the model in real data and forbids invented metrics', () => {
  const prompt = buildContentBriefPrompt(
    { topic: 'tip calculator', sourceType: 'AI_VISIBILITY_GAP', priority: 'high', intent: 'commercial', rationale: 'not mentioned', reference: 'AI visibility gap' },
    'tipcalculatorlive.com',
  );
  assert.ok(prompt.includes('tipcalculatorlive.com'));
  assert.ok(prompt.includes('tip calculator'));
  assert.ok(prompt.includes('AI visibility gap'));
  assert.match(prompt, /Do not invent metrics/);
});