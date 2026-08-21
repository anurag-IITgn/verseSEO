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

function detectCdn(serverHeader: string | null, headers: Record<string, string>): string | null {
  const server = (serverHeader ?? '').toLowerCase();
  if (server.includes('cloudflare') || headers['cf-ray']) return 'Cloudflare';
  if (server.includes('cloudfront') || headers['x-amz-cf-id']) return 'Cloudfront';
  if (server.includes('fastly') || headers['x-fastly-request-id']) return 'Fastly';
  if (server.includes('akamai') || headers['x-akamai-request-id']) return 'Akamai';
  if (server.includes('vercel') || headers['x-vercel-id']) return 'Vercel';
  if (server.includes('netlify') || headers['x-nf-request-id']) return 'Netlify';
  if (headers['x-cdn']?.toLowerCase().includes('imperva') || headers['x-iinfo']) return 'Imperva';
  return null;
}

const EMPTY_PAGE: CrawlPageData = {
  url: '',
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
  h1Count: 0,
  h2Count: 0,
  h3Count: 0,
  h4Count: 0,
  h5Count: 0,
  h6Count: 0,
  imageCount: 0,
  imagesMissingAlt: 0,
  jsonLdTypes: [],
  ogTitle: null,
  ogDescription: null,
  ogImage: null,
  twitterCard: null,
  twitterTitle: null,
  twitterDescription: null,
  twitterImage: null,
  serverHeader: null,
  cdnHeader: null,
  hasViewport: false,
  hasCharset: false,
  hasFavicon: false,
  htmlLang: null,
  externalLinkCount: 0,
  cssFileCount: 0,
  jsFileCount: 0,
  iframeCount: 0,
};

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
      const serverHeader = result.headers.get('server');
      const cdnHeader = detectCdn(serverHeader, Object.fromEntries([...result.headers.entries()]));

      page = {
        ...EMPTY_PAGE,
        url,
        statusCode: result.statusCode,
        contentType: result.contentType,
        responseTimeMs: Math.round(result.responseTimeMs),
        serverHeader: serverHeader ?? null,
        cdnHeader,
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
        page.h1Count = parsed.h1Count;
        page.h2Count = parsed.h2Count;
        page.h3Count = parsed.h3Count;
        page.h4Count = parsed.h4Count;
        page.h5Count = parsed.h5Count;
        page.h6Count = parsed.h6Count;
        page.imageCount = parsed.imageCount;
        page.imagesMissingAlt = parsed.imagesMissingAlt;
        page.jsonLdTypes = parsed.jsonLdTypes;
        page.ogTitle = parsed.ogTitle;
        page.ogDescription = parsed.ogDescription;
        page.ogImage = parsed.ogImage;
        page.twitterCard = parsed.twitterCard;
        page.twitterTitle = parsed.twitterTitle;
        page.twitterDescription = parsed.twitterDescription;
        page.twitterImage = parsed.twitterImage;
        page.hasViewport = parsed.hasViewport;
        page.hasCharset = parsed.hasCharset;
        page.hasFavicon = parsed.hasFavicon;
        page.htmlLang = parsed.htmlLang;
        page.externalLinkCount = parsed.externalLinkCount;
        page.cssFileCount = parsed.cssFileCount;
        page.jsFileCount = parsed.jsFileCount;
        page.iframeCount = parsed.iframeCount;

        for (const link of parsed.internalLinks) {
          if (!seen.has(link)) {
            seen.add(link);
            queue.push(link);
          }
        }
      }
    } catch (error) {
      page = { ...EMPTY_PAGE, url, statusCode: 0 };
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
