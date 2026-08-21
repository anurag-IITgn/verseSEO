export type CrawlStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface CrawlOptions {
  timeoutMs: number;
  userAgent: string;
  domain: string;
}

export interface CrawlSiteConfig extends CrawlOptions {
  websiteUrl: string;
  maxPages: number;
}

export interface CrawlPageData {
  url: string;
  statusCode: number | null;
  contentType: string | null;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsDirective: string | null;
  isIndexable: boolean | null;
  wordCount: number | null;
  responseTimeMs: number | null;
  internalLinks: string[];
  h1Count: number;
  h2Count: number;
  h3Count: number;
  h4Count: number;
  h5Count: number;
  h6Count: number;
  imageCount: number;
  imagesMissingAlt: number;
  jsonLdTypes: string[];
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  serverHeader: string | null;
  cdnHeader: string | null;
  hasViewport: boolean;
  hasCharset: boolean;
  hasFavicon: boolean;
  htmlLang: string | null;
  externalLinkCount: number;
  cssFileCount: number;
  jsFileCount: number;
  iframeCount: number;
}

export interface CrawlerSink {
  savePage(page: CrawlPageData): Promise<void>;
  updateCounters(pagesCrawled: number, pagesDiscovered: number): Promise<void>;
}

export interface CrawlSummary {
  pagesCrawled: number;
  pagesDiscovered: number;
  robotsFound: boolean;
  sitemapFound: boolean;
}
