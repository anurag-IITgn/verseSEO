export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueType =
  | 'MISSING_TITLE'
  | 'DUPLICATE_TITLE'
  | 'TITLE_TOO_SHORT'
  | 'TITLE_TOO_LONG'
  | 'MISSING_META_DESCRIPTION'
  | 'DUPLICATE_META_DESCRIPTION'
  | 'MISSING_CANONICAL'
  | 'BROKEN_INTERNAL_LINK'
  | 'NON_200_PAGE'
  | 'NOINDEX_PAGE'
  | 'MISSING_ROBOTS_TXT'
  | 'MISSING_SITEMAP'
  | 'MISSING_HTTPS'
  | 'MISSING_H1'
  | 'DUPLICATE_H1'
  | 'IMAGES_MISSING_ALT'
  | 'MISSING_OG_TAGS'
  | 'MISSING_TWITTER_TAGS'
  | 'MISSING_VIEWPORT'
  | 'MISSING_CHARSET'
  | 'MISSING_FAVICON'
  | 'MISSING_HTML_LANG'
  | 'THIN_CONTENT'
  | 'SLOW_RESPONSE';

export interface SiteSignals {
  websiteUrl: string;
  robotsFound: boolean;
  sitemapFound: boolean;
}

export interface AnalyzablePage {
  id: string;
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

export interface SeoIssueData {
  issueType: IssueType;
  severity: IssueSeverity;
  message: string;
  pageId: string | null;
}

export interface SeoAnalysisResult {
  healthScore: number;
  issueCount: number;
  issueCounts: Record<IssueType, number>;
  issues: SeoIssueData[];
}