import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalyzablePage } from '../src/analysis/types.js';
import { classifyIntent, coverageForType } from '../src/search/intent.js';
import { analyzeSearchOpportunities } from '../src/search/opportunities.js';
import { scoreToPriority, MAX_OPPORTUNITIES, MAX_PER_TYPE } from '../src/search/rules.js';
import type { OpportunityType, SearchIntent } from '../src/search/types.js';

let sequence = 0;

function makePage(overrides: Partial<AnalyzablePage> = {}): AnalyzablePage {
  sequence += 1;
  return {
    id: `page-${sequence}`,
    url: `http://site.test/page-${sequence}`,
    statusCode: 200,
    contentType: 'text/html',
    title: `A Valid Page Title For Page ${sequence} Here`,
    metaDescription: `A valid meta description that is descriptive for page ${sequence}`,
    canonicalUrl: `http://site.test/canonical-${sequence}`,
    robotsDirective: null,
    isIndexable: null,
    wordCount: 400,
    responseTimeMs: 120,
    internalLinks: [],
    ...overrides,
  };
}

function findOpportunity(result: ReturnType<typeof analyzeSearchOpportunities>, type: OpportunityType, query?: string) {
  return result.opportunities.find((o) => o.type === type && (query === undefined || o.query === query));
}

test('returns no opportunities for an empty crawl', () => {
  const result = analyzeSearchOpportunities([]);
  assert.equal(result.total, 0);
  assert.deepEqual(result.opportunities, []);
});

test('returns no opportunities for a clean, complete single page', () => {
  const result = analyzeSearchOpportunities([
    makePage({
      url: 'http://site.test/',
      title: 'Thorough Analysis Of Widget Types',
      metaDescription: 'An in depth look at the many different widget types available',
      wordCount: 500,
    }),
  ]);
  assert.equal(result.total, 0);
  assert.deepEqual(result.opportunities, []);
});

test('flags a topic referenced across the site but not targeted by any page as a content gap', () => {
  const result = analyzeSearchOpportunities([
    makePage({ url: 'http://site.test/', title: 'Home Page', metaDescription: 'crypto wallet storage guide', wordCount: 400 }),
    makePage({ url: 'http://site.test/alpha', title: 'Alpha Basics', metaDescription: 'crypto wallet storage tips', wordCount: 500 }),
    makePage({ url: 'http://site.test/beta', title: 'Beta Fundamentals', metaDescription: 'crypto wallet storage review', wordCount: 600 }),
  ]);

  const gap = findOpportunity(result, 'CONTENT_GAP', 'crypto wallet');
  assert.ok(gap, 'a content gap must be flagged for a topic with no dedicated page');
  assert.equal(gap.relatedPageUrl, 'http://site.test/beta', 'the best covering page is used as the related page');
  assert.match(gap.reason, /crypto wallet/);
  assert.match(gap.suggestedAction, /dedicated/);
});

test('content gap reaches the maximum score for a widely referenced topic', () => {
  const pages = Array.from({ length: 8 }, (_, i) =>
    makePage({
      url: `http://site.test/topic-${i}`,
      title: `Distinct Label Number ${i}`,
      metaDescription: 'crypto wallet basics',
      wordCount: 500,
    }),
  );
  const result = analyzeSearchOpportunities(pages);

  const gap = findOpportunity(result, 'CONTENT_GAP', 'crypto wallet');
  assert.ok(gap, 'the widely referenced topic must be flagged');
  assert.equal(gap.score.total, 100);
  assert.equal(gap.score.relevance, 40);
  assert.equal(gap.score.impact, 30);
  assert.equal(gap.score.confidence, 30);
  assert.equal(gap.score.priority, 'high');
});

test('flags thin dedicated coverage of a core topic as weak topic coverage', () => {
  const result = analyzeSearchOpportunities([
    makePage({ url: 'http://site.test/', title: 'Resume Builder', metaDescription: 'resume builder', wordCount: 300 }),
    makePage({ url: 'http://site.test/resume-builder-examples', title: 'Resume Builder Examples', metaDescription: 'resume builder examples', wordCount: 200 }),
  ]);

  assert.ok(!findOpportunity(result, 'CONTENT_GAP', 'resume builder'), 'a topic with a dedicated page is not a content gap');
  const weak = findOpportunity(result, 'WEAK_TOPIC_COVERAGE', 'resume builder');
  assert.ok(weak, 'dedicated pages that are collectively thin must be flagged');
  assert.equal(weak.relatedPageUrl, 'http://site.test/', 'the strongest dedicated page is used as the related page');
  assert.match(weak.reason, /500 words/, 'the reason reports the real combined word count');
  assert.equal(weak.score.priority, 'medium');
});

test('flags missing titles and missing meta descriptions as page optimizations', () => {
  const result = analyzeSearchOpportunities([
    makePage({ url: 'http://site.test/', title: 'Home Page', metaDescription: 'home page description', wordCount: 500 }),
    makePage({ url: 'http://site.test/no-title', title: null, metaDescription: null, wordCount: 500 }),
    makePage({ url: 'http://site.test/dup', title: 'Shared Title', metaDescription: 'shared meta', wordCount: 500 }),
    makePage({ url: 'http://site.test/dup2', title: 'Shared Title', metaDescription: 'shared meta', wordCount: 500 }),
  ]);

  const titleOpts = result.opportunities.filter(
    (o) => o.type === 'EXISTING_PAGE_OPTIMIZATION' && o.relatedPageUrl === 'http://site.test/no-title' && /no title/i.test(o.reason),
  );
  assert.ok(titleOpts.length > 0, 'a missing title must produce a page optimization opportunity');
  const metaOpts = result.opportunities.filter(
    (o) => o.type === 'EXISTING_PAGE_OPTIMIZATION' && o.relatedPageUrl === 'http://site.test/no-title' && /meta description/i.test(o.reason),
  );
  assert.ok(metaOpts.length > 0, 'a missing meta description must produce a page optimization opportunity');
});

test('flags thin pages whose title promises a search intent', () => {
  const result = analyzeSearchOpportunities([
    makePage({ url: 'http://site.test/best-resume-builder', title: 'Best Resume Builder Tools', metaDescription: 'a short meta', wordCount: 150 }),
  ]);

  const intent = findOpportunity(result, 'SEARCH_INTENT_GAP', 'Best Resume Builder Tools');
  assert.ok(intent, 'a thin page with an intent modifier must be flagged');
  assert.match(intent.reason, /"best"/);
  assert.equal(intent.relatedPageUrl, 'http://site.test/best-resume-builder');
});

test('does not flag intent when the page is complete', () => {
  const result = analyzeSearchOpportunities([
    makePage({
      url: 'http://site.test/best-resume-builder',
      title: 'Best Resume Builder Tools',
      metaDescription: 'An in depth guide covering every resume builder worth considering',
      wordCount: 500,
    }),
  ]);
  assert.ok(!findOpportunity(result, 'SEARCH_INTENT_GAP'), 'a complete page must not be flagged for intent');
});

test('does not flag utility pages (about/contact/legal) as search-intent gaps', () => {
  const result = analyzeSearchOpportunities([
    makePage({ url: 'http://site.test/contact', title: 'Contact Tip Calculator', metaDescription: 'a short meta', wordCount: 100 }),
    makePage({ url: 'http://site.test/how-much-to-tip', title: 'How Much Should You Tip | Tip Calculator', metaDescription: 'a short meta', wordCount: 100 }),
  ]);

  assert.ok(
    !result.opportunities.some((o) => o.type === 'SEARCH_INTENT_GAP' && o.relatedPageUrl === 'http://site.test/contact'),
    'utility pages must not produce search-intent gaps',
  );
  assert.ok(
    result.opportunities.some((o) => o.type === 'SEARCH_INTENT_GAP' && o.relatedPageUrl === 'http://site.test/how-much-to-tip'),
    'a thin content page with an intent modifier must still be flagged',
  );
});

test('flags pages with no incoming internal links as orphan pages', () => {
  const result = analyzeSearchOpportunities([
    makePage({ url: 'http://site.test/', title: 'Home Page', metaDescription: 'home', wordCount: 500, internalLinks: [] }),
    makePage({ url: 'http://site.test/orphan', title: 'Orphan Page About Widgets', metaDescription: 'widget info', wordCount: 500, internalLinks: ['http://site.test/'] }),
  ]);

  const orphan = result.opportunities.find(
    (o) => o.type === 'INTERNAL_LINK_OPPORTUNITY' && o.relatedPageUrl === 'http://site.test/orphan',
  );
  assert.ok(orphan, 'an unreferenced page must be flagged');
  assert.match(orphan.reason, /not linked/);
  assert.match(orphan.suggestedAction, /internal links/);
});

test('never flags internal link opportunities when there is a single page', () => {
  const result = analyzeSearchOpportunities([makePage({ url: 'http://site.test/', title: 'Home Page', wordCount: 500 })]);
  assert.ok(!result.opportunities.some((o) => o.type === 'INTERNAL_LINK_OPPORTUNITY'));
});

test('flags dedicated pages covering the same topic that do not link each other', () => {
  const a = makePage({ url: 'http://site.test/resume-builder', title: 'Resume Builder', metaDescription: 'resume builder', wordCount: 500, internalLinks: [] });
  const b = makePage({ url: 'http://site.test/resume-builder-tips', title: 'Resume Builder Tips', metaDescription: 'resume builder', wordCount: 500, internalLinks: [] });
  const home = makePage({ url: 'http://site.test/', title: 'Home Page', metaDescription: 'home', wordCount: 500, internalLinks: [a.url, b.url] });

  const result = analyzeSearchOpportunities([home, a, b]);
  const pair = result.opportunities.find((o) => o.type === 'INTERNAL_LINK_OPPORTUNITY' && /do not link/.test(o.reason));
  assert.ok(pair, 'two pages covering the same topic that do not link each other must be flagged');
  assert.equal(pair.relatedPageUrl, a.url);
});

test('excludes non-200 and non-html pages from topic analysis', () => {
  const result = analyzeSearchOpportunities([
    makePage({ url: 'http://site.test/', title: 'Home', metaDescription: 'crypto wallet storage', wordCount: 400 }),
    makePage({ url: 'http://site.test/broken', statusCode: 404, title: 'Crypto Wallet Storage', metaDescription: 'crypto wallet storage', wordCount: 400 }),
    makePage({ url: 'http://site.test/plain', statusCode: 200, contentType: 'text/plain', title: 'Crypto Wallet Storage', metaDescription: 'crypto wallet storage', wordCount: 400 }),
  ]);

  assert.ok(!findOpportunity(result, 'CONTENT_GAP', 'crypto wallet'), 'topics from non-eligible pages must not create opportunities');
  assert.ok(
    result.opportunities.every((o) => o.relatedPageUrl !== 'http://site.test/broken' && o.relatedPageUrl !== 'http://site.test/plain'),
    'non-eligible pages must never be referenced as related pages',
  );
});

test('caps the number of opportunities overall and per type', () => {
  const pages = [
    makePage({ url: 'http://site.test/', title: 'Home Page', metaDescription: 'home', wordCount: 600, internalLinks: [] }),
    ...Array.from({ length: 14 }, (_, i) =>
      makePage({
        url: `http://site.test/widget-${i}`,
        title: `Best Widget Guide Number ${i}`,
        metaDescription: 'short',
        wordCount: 100,
        internalLinks: [],
      }),
    ),
  ];
  const result = analyzeSearchOpportunities(pages);

  assert.ok(result.total <= MAX_OPPORTUNITIES, 'total opportunities must respect the cap');
  assert.equal(result.total, result.opportunities.length);

  const counts = new Map<OpportunityType, number>();
  for (const o of result.opportunities) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  for (const [type, count] of counts) {
    assert.ok(count <= MAX_PER_TYPE, `type ${type} must respect its per-type cap`);
  }

  const keys = new Set(result.opportunities.map((o) => `${o.type}|${o.query.toLowerCase()}|${o.relatedPageUrl ?? ''}|${o.reason}`));
  assert.equal(keys.size, result.opportunities.length, 'opportunities must be deduplicated');
});

test('scoring is deterministic, bounded, and self-consistent', () => {
  const pages = [
    makePage({ url: 'http://site.test/', title: 'Resume Builder', metaDescription: 'resume builder', wordCount: 300 }),
    makePage({ url: 'http://site.test/resume-builder-examples', title: 'Resume Builder Examples', metaDescription: 'resume builder', wordCount: 200 }),
    makePage({ url: 'http://site.test/no-title', title: null, metaDescription: null, wordCount: 120 }),
  ];

  const first = analyzeSearchOpportunities(pages);
  const second = analyzeSearchOpportunities(pages);
  assert.deepEqual(second, first, 'identical input must produce identical output');

  for (const o of first.opportunities) {
    assert.ok(o.score.total >= 0 && o.score.total <= 100, 'total score must be within 0-100');
    assert.ok(o.score.relevance >= 0 && o.score.relevance <= 40, 'relevance must be within 0-40');
    assert.ok(o.score.impact >= 0 && o.score.impact <= 30, 'impact must be within 0-30');
    assert.ok(o.score.confidence >= 0 && o.score.confidence <= 30, 'confidence must be within 0-30');
    assert.equal(o.score.total, o.score.relevance + o.score.impact + o.score.confidence, 'total must equal the component sum');
    assert.equal(o.score.priority, scoreToPriority(o.score.total), 'priority must follow the documented thresholds');
  }
});

test('classifies search intent deterministically from phrase text', () => {
  assert.equal(classifyIntent('best resume builder tools', 'resumebuilder'), 'commercial');
  assert.equal(classifyIntent('tip calculator', 'tipcalculatorlive'), 'transactional');
  assert.equal(classifyIntent('free tip calculator', 'tipcalculatorlive'), 'transactional');
  assert.equal(classifyIntent('how much to tip', 'tipcalculatorlive'), 'informational');
  assert.equal(classifyIntent('restaurant bill splitting', 'tipcalculatorlive'), 'informational');
  assert.equal(classifyIntent('tip calculator live', 'tipcalculatorlive'), 'navigational');
  assert.equal(classifyIntent('', 'tipcalculatorlive'), 'informational');
});

test('coverage state maps from opportunity type', () => {
  assert.equal(coverageForType('CONTENT_GAP'), 'GAP');
  assert.equal(coverageForType('WEAK_TOPIC_COVERAGE'), 'IMPROVEMENT');
  assert.equal(coverageForType('EXISTING_PAGE_OPTIMIZATION'), 'IMPROVEMENT');
  assert.equal(coverageForType('SEARCH_INTENT_GAP'), 'IMPROVEMENT');
  assert.equal(coverageForType('INTERNAL_LINK_OPPORTUNITY'), 'IMPROVEMENT');
});

test('every opportunity carries intent, coverage and source evidence', () => {
  const result = analyzeSearchOpportunities([
    makePage({ url: 'http://site.test/', title: 'Home Page', metaDescription: 'crypto wallet storage guide', wordCount: 400 }),
    makePage({ url: 'http://site.test/alpha', title: 'Alpha Basics', metaDescription: 'crypto wallet storage tips', wordCount: 500 }),
    makePage({ url: 'http://site.test/no-title', title: null, metaDescription: null, wordCount: 120 }),
  ]);
  assert.ok(result.opportunities.length > 0);

  const validIntents: SearchIntent[] = ['informational', 'commercial', 'transactional', 'navigational'];
  for (const o of result.opportunities) {
    assert.ok(validIntents.includes(o.intent), `unknown intent ${o.intent}`);
    assert.ok(['GAP', 'IMPROVEMENT', 'EXISTING'].includes(o.coverage), `unknown coverage ${o.coverage}`);
    assert.ok(Array.isArray(o.evidence.sourcePages), 'evidence must list source pages');
    assert.ok(o.evidence.sourcePages.length > 0, 'evidence must reference at least one source page');
    assert.ok(Array.isArray(o.evidence.sourcePhrases) && o.evidence.sourcePhrases.length > 0, 'evidence must include source phrases');
  }

  const gap = findOpportunity(result, 'CONTENT_GAP', 'crypto wallet');
  assert.ok(gap, 'the fixture must still produce a content gap');
  assert.equal(gap.coverage, 'GAP', 'a content gap maps to the GAP coverage state');
  assert.equal(gap.intent, 'informational');
  assert.ok(gap.evidence.sourcePages.some((p) => p.url === 'http://site.test/beta' || p.url === 'http://site.test/alpha'), 'evidence lists the covering pages');
  assert.ok(gap.evidence.sourcePhrases.includes('crypto wallet'));
});
