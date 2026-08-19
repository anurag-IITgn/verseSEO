import { fetchPage } from './http.js';
import { parseHtml } from './htmlParser.js';
import { loadRobotsTxt } from './robots.js';
import { discoverSitemapUrls } from './sitemap.js';
import type { CrawlPageData, CrawlSiteConfig, CrawlerSink, CrawlSummary } from './types.js';
import { normalizeCrawlUrl, originOf } from './url.js';

function isHtml(contentType: string | null): boolean {
  if (contentType === null) return false;
  return contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
}

export async function crawlSite(config: CrawlSiteConfig, sink: CrawlerSink): Promise<CrawlSummary> {
  const origin = originOf(config.websiteUrl);
  const seed = normalizeCrawlUrl(config.websiteUrl);

  const robots = await loadRobotsTxt(origin, config);
  const sitemapUrls = await discoverSitemapUrls(origin, config.domain, robots.sitemaps, config);

  const seen = new Set<string>([seed]);
  const queue: string[] = [seed];
  for (const sitemapUrl of sitemapUrls) {
    if (!seen.has(sitemapUrl)) {
      seen.add(sitemapUrl);
      queue.push(sitemapUrl);
    }
  }

  let pagesCrawled = 0;

  while (queue.length > 0 && pagesCrawled < config.maxPages) {
    const url = queue.shift() as string;

    if (!robots.allowed(url)) {
      continue;
    }

    let page: CrawlPageData;
    try {
      const result = await fetchPage(url, config);
      page = {
        url,
        statusCode: result.statusCode,
        contentType: result.contentType,
        title: null,
        metaDescription: null,
        canonicalUrl: null,
        robotsDirective: null,
        isIndexable: null,
        wordCount: null,
        responseTimeMs: Math.round(result.responseTimeMs),
        internalLinks: [],
      };

      if (isHtml(result.contentType) && result.statusCode === 200) {
        const parsed = parseHtml(result.body.toString('utf8'), result.finalUrl, config.domain);
        page.title = parsed.title;
        page.metaDescription = parsed.metaDescription;
        page.canonicalUrl = parsed.canonicalUrl;
        page.robotsDirective = parsed.robotsDirective;
        page.isIndexable = parsed.isIndexable;
        page.wordCount = parsed.wordCount;
        page.internalLinks = parsed.internalLinks;

        for (const link of parsed.internalLinks) {
          if (!seen.has(link)) {
            seen.add(link);
            queue.push(link);
          }
        }
      }
    } catch (error) {
      page = {
        url,
        statusCode: 0,
        contentType: null,
        title: null,
        metaDescription: null,
        canonicalUrl: null,
        robotsDirective: null,
        isIndexable: null,
        wordCount: null,
        responseTimeMs: null,
        internalLinks: [],
      };
    }

    pagesCrawled += 1;
    await sink.savePage(page);
    await sink.updateCounters(pagesCrawled, seen.size);
  }

  return {
    pagesCrawled,
    pagesDiscovered: seen.size,
    robotsFound: robots.found,
    sitemapFound: sitemapUrls.length > 0,
  };
}