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
  | 'MISSING_HTTPS';

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