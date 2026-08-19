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