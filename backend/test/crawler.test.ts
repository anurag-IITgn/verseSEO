import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { crawlSite } from '../src/crawler/crawler.js';
import type { CrawlPageData, CrawlerSink } from '../src/crawler/types.js';
import { closeFixtureServer, startFixtureServer, type FixtureSite } from './helpers/fixtureSite.js';

let site: FixtureSite;

function makeSink(pages: CrawlPageData[]) {
  const counters: { crawled: number; discovered: number }[] = [];
  const sink: CrawlerSink = {
    savePage: async (page) => {
      pages.push(page);
    },
    updateCounters: async (crawled, discovered) => {
      counters.push({ crawled, discovered });
    },
  };
  return { sink, counters };
}

const baseConfig = (baseUrl: string, overrides: Partial<import('../src/crawler/types.js').CrawlSiteConfig> = {}) => ({
  websiteUrl: `${baseUrl}/`,
  domain: '127.0.0.1',
  maxPages: 50,
  timeoutMs: 1000,
  userAgent: 'VisibilityCrawler/1.0',
  ...overrides,
});

before(async () => {
  site = await startFixtureServer();
});

after(async () => {
  await closeFixtureServer(site.server);
});

test('crawls the site with domain restriction, robots, sitemap, redirects and timeout handling', async () => {
  const pages: CrawlPageData[] = [];
  const { sink } = makeSink(pages);

  const summary = await crawlSite(baseConfig(site.baseUrl), sink);

  assert.equal(summary.pagesCrawled, 8);
  assert.equal(summary.pagesDiscovered, 9);
  assert.equal(summary.robotsFound, true);
  assert.equal(summary.sitemapFound, true);

  const bySuffix = (suffix: string) => pages.find((page) => page.url.endsWith(suffix));

  assert.ok(bySuffix('/about'));
  assert.ok(bySuffix('/contact'));
  assert.ok(bySuffix('/sitemap-page'), 'sitemap URL must be crawled as a seed');
  assert.equal(bySuffix('/missing')?.statusCode, 404, 'HTTP error pages must be recorded');
  assert.equal(bySuffix('/redirect')?.statusCode, 200, 'in-domain redirect must be followed');
  assert.equal(bySuffix('/offsite-redirect')?.statusCode, 302, 'off-domain redirect must not be followed');
  assert.equal(bySuffix('/slow')?.statusCode, 0, 'timed-out pages must fail gracefully with status 0');
  assert.ok(!bySuffix('/forbidden'), 'robots-disallowed pages must not be crawled');
  assert.ok(!pages.some((page) => page.url.includes('example.com')), 'external domains must not be crawled');

  const home = bySuffix('/');
  assert.ok(home);
  assert.equal(home.title, 'Home');
  assert.equal(home.metaDescription, 'home description');
  assert.equal(home.canonicalUrl, `${site.baseUrl}/`);
  assert.equal(home.robotsDirective, 'index,follow');
  assert.equal(home.isIndexable, true);
  assert.equal(bySuffix('/about')?.title, 'About');
  assert.ok(typeof home.wordCount === 'number' && home.wordCount > 0);
  assert.ok(typeof home.responseTimeMs === 'number');

  const aboutCount = pages.filter((page) => page.url.endsWith('/about')).length;
  assert.equal(aboutCount, 1, 'duplicate URLs must not be re-fetched');
});

test('stops crawling once MAX_PAGES is reached', async () => {
  const pages: CrawlPageData[] = [];
  const { sink } = makeSink(pages);

  const summary = await crawlSite(baseConfig(site.baseUrl, { maxPages: 3 }), sink);

  assert.equal(summary.pagesCrawled, 3);
  assert.ok(summary.pagesDiscovered > 3, 'more URLs are discovered than crawled');
});