import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSite } from '../src/analysis/analyze.js';
import { computeTechnicalHealthScore, determineCrawlState } from '../src/analysis/rules.js';
import type { AnalyzablePage, CrawlMeta, IssueType, SiteSignals } from '../src/analysis/types.js';

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

function makeCrawlMeta(pages: AnalyzablePage[], overrides: Partial<CrawlMeta> = {}): CrawlMeta {
  return { pagesDiscovered: pages.length, pagesCrawled: pages.length, ...overrides };
}

// ---------------------------------------------------------------------------
// Basic issue detection
// ---------------------------------------------------------------------------

test('returns a perfect health score when no issues exist', () => {
  const pages = Array.from({ length: 10 }, (_, i) => makePage({
    url: `http://site.test/${i}`,
    title: `Page title number ${i} is just fine here for the test`,
    metaDescription: `A valid meta description that is descriptive for page ${i}`,
    internalLinks: [`http://site.test/${(i + 1) % 10}`],
    ogTitle: `Page ${i} Title`,
    ogDescription: `Page ${i} description`,
    jsonLdTypes: ['WebPage'],
  }));
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  assert.equal(result.healthScore, 100);
  assert.equal(result.issueCount, 0);
  assert.equal(result.crawlState, 'COMPLETED');
});

test('flags a missing title as an error', () => {
  const pages = [makePage({ title: null })];
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  const issue = result.issues.find((i) => i.issueType === 'MISSING_TITLE');
  assert.ok(issue);
  assert.equal(issue.severity, 'error');
});

test('flags title length outside the recommended range', () => {
  const short = analyzeSite(makeSite(), [makePage({ title: 'Short' })], { pagesDiscovered: 1, pagesCrawled: 1 });
  assert.ok(short.issues.some((i) => i.issueType === 'TITLE_TOO_SHORT'));

  const long = analyzeSite(makeSite(), [makePage({ title: 'X'.repeat(61) })], { pagesDiscovered: 1, pagesCrawled: 1 });
  assert.ok(long.issues.some((i) => i.issueType === 'TITLE_TOO_LONG'));

  const ok = analyzeSite(makeSite(), [makePage({ title: 'A Title With Exactly Thirty Characters!!' })], { pagesDiscovered: 1, pagesCrawled: 1 });
  assert.ok(!ok.issues.some((i) => i.issueType === 'TITLE_TOO_SHORT' || i.issueType === 'TITLE_TOO_LONG'));
});

test('flags duplicate titles as one issue per group, not per page', () => {
  const pages = [
    makePage({ url: 'http://site.test/a', title: 'Same Title' }),
    makePage({ url: 'http://site.test/b', title: 'Same Title' }),
    makePage({ url: 'http://site.test/c', title: 'Same Title' }),
  ];
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  const duplicates = result.issues.filter((i) => i.issueType === 'DUPLICATE_TITLE');
  assert.equal(duplicates.length, 1, 'one DUPLICATE_TITLE issue per group');
  assert.ok(duplicates[0].pageId === null, 'group-level issue has null pageId');
  assert.match(duplicates[0].message, /3 pages/);
});

test('flags missing and duplicate meta descriptions as one issue per group', () => {
  const missing = analyzeSite(makeSite(), [makePage({ metaDescription: null })], { pagesDiscovered: 1, pagesCrawled: 1 });
  assert.ok(missing.issues.some((i) => i.issueType === 'MISSING_META_DESCRIPTION'));

  const pages = [
    makePage({ url: 'http://site.test/a', metaDescription: 'Same description' }),
    makePage({ url: 'http://site.test/b', metaDescription: 'Same description' }),
  ];
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  const dups = result.issues.filter((i) => i.issueType === 'DUPLICATE_META_DESCRIPTION');
  assert.equal(dups.length, 1, 'one DUPLICATE_META_DESCRIPTION issue per group');
  assert.ok(dups[0].pageId === null);
});

test('flags a missing canonical tag', () => {
  const page = makePage({ canonicalUrl: null });
  const result = analyzeSite(makeSite(), [page], { pagesDiscovered: 1, pagesCrawled: 1 });
  const issue = result.issues.find((i) => i.issueType === 'MISSING_CANONICAL');
  assert.ok(issue);
  assert.equal(issue.pageId, page.id);
});

test('flags a noindex page', () => {
  const pages = [makePage({ isIndexable: false, robotsDirective: 'noindex, follow' })];
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  const issue = result.issues.find((i) => i.issueType === 'NOINDEX_PAGE');
  assert.ok(issue);
  assert.equal(issue.severity, 'warning');
});

test('flags broken internal links only when the target is crawled and failed', () => {
  const broken = makePage({ url: 'http://site.test/broken', statusCode: 404, contentType: 'text/plain', title: null, metaDescription: null });
  const good = makePage({ url: 'http://site.test/good' });
  const home = makePage({ url: 'http://site.test/', internalLinks: ['http://site.test/broken', 'http://site.test/good', 'http://site.test/not-crawled'] });

  const pages = [home, broken, good];
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  const brokenIssues = result.issues.filter((i) => i.issueType === 'BROKEN_INTERNAL_LINK');
  assert.equal(brokenIssues.length, 1);
  assert.equal(brokenIssues[0].pageId, home.id);
  assert.equal(brokenIssues[0].severity, 'error');
  assert.match(brokenIssues[0].message, /HTTP 404/);
});

test('flags non-200 pages with severity based on status', () => {
  const notFound = analyzeSite(makeSite(), [makePage({ statusCode: 404 })], { pagesDiscovered: 1, pagesCrawled: 1 });
  assert.equal(notFound.issues.find((i) => i.issueType === 'NON_200_PAGE')?.severity, 'warning');

  const serverError = analyzeSite(makeSite(), [makePage({ statusCode: 503 })], { pagesDiscovered: 1, pagesCrawled: 1 });
  assert.equal(serverError.issues.find((i) => i.issueType === 'NON_200_PAGE')?.severity, 'error');

  const fetchFailure = analyzeSite(makeSite(), [makePage({ statusCode: 0 })], { pagesDiscovered: 1, pagesCrawled: 1 });
  assert.equal(fetchFailure.issues.find((i) => i.issueType === 'NON_200_PAGE')?.severity, 'error');
});

test('does not apply content checks to non-HTML pages', () => {
  const pdf = makePage({ contentType: 'application/pdf', title: null, metaDescription: null });
  const result = analyzeSite(makeSite(), [pdf], { pagesDiscovered: 1, pagesCrawled: 1 });
  assert.ok(!result.issues.some((i) => i.issueType === 'MISSING_TITLE' || i.issueType === 'MISSING_META_DESCRIPTION'));
});

test('does not apply content checks to non-200 pages', () => {
  const notFound = makePage({ statusCode: 404, title: null, metaDescription: null });
  const result = analyzeSite(makeSite(), [notFound], { pagesDiscovered: 1, pagesCrawled: 1 });
  assert.ok(!result.issues.some((i) => i.issueType === 'MISSING_TITLE' || i.issueType === 'MISSING_META_DESCRIPTION'));
});

test('flags site-level issues for http, missing robots.txt and missing sitemap', () => {
  const pages = [makePage()];
  const result = analyzeSite(makeSite({ websiteUrl: 'http://site.test/', robotsFound: false, sitemapFound: false }), pages, makeCrawlMeta(pages));
  assert.ok(result.issues.some((i) => i.issueType === 'MISSING_HTTPS' && i.pageId === null));
  assert.ok(result.issues.some((i) => i.issueType === 'MISSING_ROBOTS_TXT' && i.pageId === null));
  assert.ok(result.issues.some((i) => i.issueType === 'MISSING_SITEMAP' && i.pageId === null));
});

test('flags MULTIPLE_H1 for pages with multiple H1s', () => {
  const pages = [makePage({ h1Count: 2 })];
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  const multi = result.issues.find((i) => i.issueType === 'MULTIPLE_H1');
  assert.ok(multi, 'MULTIPLE_H1 must be detected');
  assert.equal(multi.severity, 'warning');
  assert.match(multi.message, /2 H1/);
});

test('issueCounts reports the number of issues per type', () => {
  const pages = [makePage({ title: null }), makePage({ title: null })];
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  assert.equal(result.issueCounts.MISSING_TITLE, 2);
  assert.equal(result.issueCount, 2);
});

// ---------------------------------------------------------------------------
// robots.txt / sitemap.xml NOT analyzed as HTML pages
// ---------------------------------------------------------------------------

test('robots.txt and sitemap.xml are not evaluated as HTML content pages', () => {
  const robotsPage = makePage({ id: 'robots', url: 'http://site.test/robots.txt', contentType: 'text/plain', title: null, metaDescription: null });
  const sitemapPage = makePage({ id: 'sitemap', url: 'http://site.test/sitemap.xml', contentType: 'application/xml', title: null, metaDescription: null });
  const pages = [robotsPage, sitemapPage];
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  assert.ok(!result.issues.some((i) => i.issueType === 'MISSING_TITLE'), 'non-HTML pages must not get MISSING_TITLE');
  assert.ok(!result.issues.some((i) => i.issueType === 'MISSING_META_DESCRIPTION'), 'non-HTML pages must not get MISSING_META_DESCRIPTION');
  assert.ok(!result.issues.some((i) => i.issueType === 'MISSING_CANONICAL'), 'non-HTML pages must not get MISSING_CANONICAL');
});

// ---------------------------------------------------------------------------
// Crawl state determination
// ---------------------------------------------------------------------------

test('returns FAILED for 0 pages crawled and 0 discovered', () => {
  const { state, reason } = determineCrawlState(makeSite(), [], { pagesDiscovered: 0, pagesCrawled: 0 });
  assert.equal(state, 'FAILED');
  assert.ok(reason);
});

test('returns FAILED when pages discovered but none crawled', () => {
  const { state } = determineCrawlState(makeSite(), [], { pagesDiscovered: 10, pagesCrawled: 0 });
  assert.equal(state, 'FAILED');
});

test('returns RESTRICTED when pages discovered, none crawled, no robots.txt', () => {
  const { state } = determineCrawlState(makeSite({ robotsFound: false }), [], { pagesDiscovered: 10, pagesCrawled: 0 });
  assert.equal(state, 'RESTRICTED');
});

test('returns PARTIAL when less than 10% of discovered pages crawled', () => {
  const pages = [makePage()];
  const { state } = determineCrawlState(makeSite(), pages, { pagesDiscovered: 100, pagesCrawled: 5 });
  assert.equal(state, 'PARTIAL');
});

test('returns COMPLETED for normal crawl', () => {
  const pages = [makePage()];
  const { state } = determineCrawlState(makeSite(), pages, { pagesDiscovered: 10, pagesCrawled: 10 });
  assert.equal(state, 'COMPLETED');
});

// ---------------------------------------------------------------------------
// Dimension-based scoring: representative profiles
// ---------------------------------------------------------------------------

test('perfect site scores 100', () => {
  const pages = Array.from({ length: 10 }, (_, i) => makePage({
    url: `http://site.test/${i}`,
    title: `Page title number ${i} is just fine here for the test`,
    metaDescription: `A valid meta description that is descriptive for page ${i}`,
    internalLinks: [`http://site.test/${(i + 1) % 10}`],
    ogTitle: `Page ${i} Title`,
    ogDescription: `Page ${i} description`,
    jsonLdTypes: ['WebPage'],
  }));
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  assert.equal(result.healthScore, 100);
  assert.equal(result.crawlState, 'COMPLETED');
});

test('small healthy site with a few warnings scores in the high 90s', () => {
  const pages = Array.from({ length: 20 }, (_, i) =>
    makePage({ title: `Page title number ${i} is just fine here`, metaDescription: `Description for page ${i} is also fine`, canonicalUrl: `http://site.test/${i}` }),
  );
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  assert.ok(result.healthScore >= 90, `healthy 20-page site scored ${result.healthScore}, expected >= 90`);
});

test('normal 30-page site with repeated template warnings does NOT collapse to 0', () => {
  const pages = Array.from({ length: 30 }, (_, i) =>
    makePage({
      title: `Page title number ${i} is just fine here`,
      metaDescription: null,
      canonicalUrl: null,
    }),
  );
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  assert.ok(result.healthScore > 40, `30-page site scored ${result.healthScore}, must not be 0`);
});

test('genuinely severe site with many errors scores low', () => {
  const pages = Array.from({ length: 20 }, () =>
    makePage({
      title: null,
      metaDescription: null,
      canonicalUrl: null,
      h1Count: 0,
      ogTitle: null,
      ogDescription: null,
      statusCode: 500,
    }),
  );
  const result = analyzeSite(makeSite({ websiteUrl: 'http://site.test/', robotsFound: false, sitemapFound: false }), pages, makeCrawlMeta(pages));
  assert.ok(result.healthScore < 30, `severe site scored ${result.healthScore}, expected < 30`);
});

test('repeated template issue is coverage-based, not penalty-based', () => {
  const pages50 = Array.from({ length: 50 }, () => makePage({ hasViewport: false }));
  const result50 = analyzeSite(makeSite(), pages50, makeCrawlMeta(pages50));
  const pages5 = Array.from({ length: 5 }, () => makePage({ hasViewport: false }));
  const result5 = analyzeSite(makeSite(), pages5, makeCrawlMeta(pages5));
  const diff = Math.abs(result50.healthScore - result5.healthScore);
  assert.ok(diff <= 10, `50 pages vs 5 pages with same issue: scores ${result50.healthScore} vs ${result5.healthScore}, diff ${diff} must be <= 10`);
});

test('duplicate title group is handled correctly', () => {
  const pages = Array.from({ length: 10 }, (_, i) =>
    makePage({ url: `http://site.test/p${i}`, title: 'All Same Title' }),
  );
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  const dupIssues = result.issues.filter((i) => i.issueType === 'DUPLICATE_TITLE');
  assert.equal(dupIssues.length, 1, 'one DUPLICATE_TITLE issue for the entire group');
});

test('27-page site with 2 consistent warnings per page does NOT score 0', () => {
  const pages = Array.from({ length: 27 }, (_, i) =>
    makePage({
      title: `Page ${i} has a perfectly valid title here`,
      metaDescription: null,
      canonicalUrl: null,
    }),
  );
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  assert.ok(result.healthScore > 30, `27-page site scored ${result.healthScore}, must be well above 0`);
});

test('0 pages crawled returns crawl failure state, not score 0', () => {
  const result = analyzeSite(makeSite(), [], { pagesDiscovered: 0, pagesCrawled: 0 });
  assert.equal(result.crawlState, 'FAILED');
  assert.equal(result.healthScore, 0);
  assert.ok(result.crawlStateReason);
});

test('partial crawl reflects coverage in score', () => {
  const allPages = Array.from({ length: 50 }, (_, i) =>
    makePage({ url: `http://site.test/${i}`, title: `Page ${i} title is fine here for testing` }),
  );
  const crawledPages = allPages.slice(0, 5);
  const result = analyzeSite(makeSite(), crawledPages, { pagesDiscovered: 50, pagesCrawled: 5 });
  assert.equal(result.crawlState, 'PARTIAL');
  assert.ok(result.dimensions.crawlCoverage < 100, 'crawl coverage dimension must reflect partial crawl');
});

test('dimension scores are present and normalized', () => {
  const pages = [makePage()];
  const result = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  assert.ok(result.dimensions);
  for (const [key, val] of Object.entries(result.dimensions)) {
    assert.ok(typeof val === 'number', `${key} must be a number`);
    assert.ok(val >= 0 && val <= 100, `${key} must be in [0, 100], got ${val}`);
  }
});

test('non-HTTPS site has reduced technical correctness', () => {
  const pages = [makePage()];
  const https = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  const http = analyzeSite(makeSite({ websiteUrl: 'http://site.test/' }), pages, makeCrawlMeta(pages));
  assert.ok(http.dimensions.technicalCorrectness < https.dimensions.technicalCorrectness, 'HTTP must reduce technical correctness');
});

test('missing robots.txt reduces technical correctness but not catastrophically', () => {
  const pages = Array.from({ length: 20 }, (_, i) => makePage({ title: `Page ${i} title is fine here for testing purposes` }));
  const withRobots = analyzeSite(makeSite(), pages, makeCrawlMeta(pages));
  const withoutRobots = analyzeSite(makeSite({ robotsFound: false }), pages, makeCrawlMeta(pages));
  assert.ok(withoutRobots.dimensions.technicalCorrectness < withRobots.dimensions.technicalCorrectness);
  assert.ok(withoutRobots.dimensions.technicalCorrectness >= 50, 'missing robots.txt alone must not destroy technical correctness');
});
