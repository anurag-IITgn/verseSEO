import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSite } from '../src/analysis/analyze.js';
import { calculateHealthScore, SEVERITY_WEIGHTS } from '../src/analysis/rules.js';
import type { AnalyzablePage, SiteSignals } from '../src/analysis/types.js';

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
    h1Count: 1,
    h2Count: 1,
    h3Count: 0,
    h4Count: 0,
    h5Count: 0,
    h6Count: 0,
    imageCount: 0,
    imagesMissingAlt: 0,
    jsonLdTypes: [],
    ogTitle: `Page ${sequence} Title`,
    ogDescription: `Page ${sequence} description`,
    ogImage: null,
    twitterCard: null,
    twitterTitle: null,
    twitterDescription: null,
    twitterImage: null,
    serverHeader: null,
    cdnHeader: null,
    hasViewport: true,
    hasCharset: true,
    hasFavicon: true,
    htmlLang: 'en',
    externalLinkCount: 0,
    cssFileCount: 1,
    jsFileCount: 0,
    iframeCount: 0,
    ...overrides,
  };
}

function makeSite(overrides: Partial<SiteSignals> = {}): SiteSignals {
  return { websiteUrl: 'https://site.test/', robotsFound: true, sitemapFound: true, ...overrides };
}

function types(issues: { issueType: string }[]): string[] {
  return issues.map((i) => i.issueType);
}

test('returns a perfect health score when no issues exist', () => {
  const result = analyzeSite(makeSite(), [makePage()]);
  assert.equal(result.healthScore, 100);
  assert.equal(result.issueCount, 0);
});

test('flags a missing title as an error', () => {
  const result = analyzeSite(makeSite(), [makePage({ title: null })]);
  const issue = result.issues.find((i) => i.issueType === 'MISSING_TITLE');
  assert.ok(issue);
  assert.equal(issue.severity, 'error');
});

test('flags title length outside the recommended range', () => {
  const short = analyzeSite(makeSite(), [makePage({ title: 'Short' })]);
  assert.ok(short.issues.some((i) => i.issueType === 'TITLE_TOO_SHORT'));

  const long = analyzeSite(makeSite(), [makePage({ title: 'X'.repeat(61) })]);
  assert.ok(long.issues.some((i) => i.issueType === 'TITLE_TOO_LONG'));

  const ok = analyzeSite(makeSite(), [makePage({ title: 'A Title With Exactly Thirty Characters!!' })]);
  assert.ok(!ok.issues.some((i) => i.issueType === 'TITLE_TOO_SHORT' || i.issueType === 'TITLE_TOO_LONG'));
});

test('flags duplicate titles across pages', () => {
  const pages = [
    makePage({ url: 'http://site.test/a', title: 'Same Title' }),
    makePage({ url: 'http://site.test/b', title: 'Same Title' }),
  ];
  const result = analyzeSite(makeSite(), pages);
  const duplicates = result.issues.filter((i) => i.issueType === 'DUPLICATE_TITLE');
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((i) => i.severity === 'warning'));
});

test('flags missing and duplicate meta descriptions', () => {
  const missing = analyzeSite(makeSite(), [makePage({ metaDescription: null })]);
  assert.ok(missing.issues.some((i) => i.issueType === 'MISSING_META_DESCRIPTION'));

  const pages = [
    makePage({ url: 'http://site.test/a', metaDescription: 'Same description' }),
    makePage({ url: 'http://site.test/b', metaDescription: 'Same description' }),
  ];
  const result = analyzeSite(makeSite(), pages);
  assert.equal(result.issues.filter((i) => i.issueType === 'DUPLICATE_META_DESCRIPTION').length, 2);
});

test('flags a missing canonical tag', () => {
  const page = makePage({ canonicalUrl: null });
  const result = analyzeSite(makeSite(), [page]);
  const issue = result.issues.find((i) => i.issueType === 'MISSING_CANONICAL');
  assert.ok(issue);
  assert.equal(issue.pageId, page.id);
});

test('flags a noindex page', () => {
  const result = analyzeSite(makeSite(), [makePage({ isIndexable: false, robotsDirective: 'noindex, follow' })]);
  const issue = result.issues.find((i) => i.issueType === 'NOINDEX_PAGE');
  assert.ok(issue);
  assert.equal(issue.severity, 'warning');
});

test('flags broken internal links only when the target is crawled and failed', () => {
  const broken = makePage({ url: 'http://site.test/broken', statusCode: 404, contentType: 'text/plain', title: null, metaDescription: null });
  const good = makePage({ url: 'http://site.test/good' });
  const home = makePage({ url: 'http://site.test/', internalLinks: ['http://site.test/broken', 'http://site.test/good', 'http://site.test/not-crawled'] });

  const result = analyzeSite(makeSite(), [home, broken, good]);
  const brokenIssues = result.issues.filter((i) => i.issueType === 'BROKEN_INTERNAL_LINK');
  assert.equal(brokenIssues.length, 1);
  assert.equal(brokenIssues[0].pageId, home.id);
  assert.equal(brokenIssues[0].severity, 'error');
  assert.match(brokenIssues[0].message, /HTTP 404/);
});

test('flags non-200 pages with severity based on status', () => {
  const notFound = makePage({ statusCode: 404 });
  const serverError = makePage({ statusCode: 503 });
  const fetchFailure = makePage({ statusCode: 0 });

  const notFoundResult = analyzeSite(makeSite(), [notFound]);
  assert.equal(notFoundResult.issues.find((i) => i.issueType === 'NON_200_PAGE')?.severity, 'warning');

  const serverErrorResult = analyzeSite(makeSite(), [serverError]);
  assert.equal(serverErrorResult.issues.find((i) => i.issueType === 'NON_200_PAGE')?.severity, 'error');

  const fetchFailureResult = analyzeSite(makeSite(), [fetchFailure]);
  assert.equal(fetchFailureResult.issues.find((i) => i.issueType === 'NON_200_PAGE')?.severity, 'error');
});

test('does not apply content checks to non-HTML pages', () => {
  const pdf = makePage({ contentType: 'application/pdf', title: null, metaDescription: null });
  const result = analyzeSite(makeSite(), [pdf]);
  assert.ok(!result.issues.some((i) => i.issueType === 'MISSING_TITLE' || i.issueType === 'MISSING_META_DESCRIPTION'));
});

test('does not apply content checks to non-200 pages', () => {
  const notFound = makePage({ statusCode: 404, title: null, metaDescription: null });
  const result = analyzeSite(makeSite(), [notFound]);
  assert.ok(!result.issues.some((i) => i.issueType === 'MISSING_TITLE' || i.issueType === 'MISSING_META_DESCRIPTION'));
});

test('flags site-level issues for http, missing robots.txt and missing sitemap', () => {
  const result = analyzeSite(makeSite({ websiteUrl: 'http://site.test/', robotsFound: false, sitemapFound: false }), [makePage()]);
  assert.ok(result.issues.some((i) => i.issueType === 'MISSING_HTTPS' && i.pageId === null));
  assert.ok(result.issues.some((i) => i.issueType === 'MISSING_ROBOTS_TXT' && i.pageId === null));
  assert.ok(result.issues.some((i) => i.issueType === 'MISSING_SITEMAP' && i.pageId === null));
});

test('health score deducts severity weights from 100', () => {
  const result = analyzeSite(makeSite(), [
    makePage({ title: null }), // error
    makePage({ title: 'Short' }), // warning
  ]);
  const penalty = SEVERITY_WEIGHTS.error + SEVERITY_WEIGHTS.warning;
  assert.equal(result.healthScore, 100 - penalty);
  assert.equal(result.healthScore, calculateHealthScore(result.issues));
});

test('health score never goes below zero', () => {
  const pages = Array.from({ length: 30 }, () => makePage({ title: null, metaDescription: null }));
  const result = analyzeSite(makeSite(), pages);
  assert.equal(result.healthScore, 0);
});

test('issueCounts reports the number of issues per type', () => {
  const result = analyzeSite(makeSite(), [makePage({ title: null }), makePage({ title: null })]);
  assert.equal(result.issueCounts.MISSING_TITLE, 2);
  assert.equal(result.issueCount, 2);
});