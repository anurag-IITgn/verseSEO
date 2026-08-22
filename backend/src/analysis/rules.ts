import type { AnalyzablePage, CrawlMeta, CrawlState, DimensionScores, IssueSeverity, IssueType, SiteSignals } from './types.js';

/**
 * Centralized scoring model for technical SEO analysis.
 *
 * Score = weighted sum of 5 normalized dimensions (each 0-100):
 *   Technical Correctness         30%
 *   Metadata & HTML Quality       25%
 *   Crawl Coverage & Indexability 25%
 *   Architecture & Discoverability 15%
 *   Content & Performance         5%
 *
 * Each dimension is computed from coverage ratios and signal checks,
 * NOT from raw issue counts. Repeated page-level findings affect
 * coverage percentages, not penalty subtractions.
 */
export const MAX_HEALTH_SCORE = 100;

export const TITLE_MIN_LENGTH = 30;
export const TITLE_MAX_LENGTH = 60;

export const DEFAULT_SEVERITY: Record<IssueType, IssueSeverity> = {
  MISSING_TITLE: 'error',
  DUPLICATE_TITLE: 'warning',
  TITLE_TOO_SHORT: 'warning',
  TITLE_TOO_LONG: 'warning',
  MISSING_META_DESCRIPTION: 'error',
  DUPLICATE_META_DESCRIPTION: 'warning',
  MISSING_CANONICAL: 'warning',
  BROKEN_INTERNAL_LINK: 'error',
  NON_200_PAGE: 'warning',
  NOINDEX_PAGE: 'warning',
  MISSING_ROBOTS_TXT: 'warning',
  MISSING_SITEMAP: 'warning',
  MISSING_HTTPS: 'error',
  MISSING_H1: 'error',
  DUPLICATE_H1: 'warning',
  MULTIPLE_H1: 'warning',
  IMAGES_MISSING_ALT: 'warning',
  MISSING_OG_TAGS: 'warning',
  MISSING_TWITTER_TAGS: 'info',
  MISSING_VIEWPORT: 'warning',
  MISSING_CHARSET: 'info',
  MISSING_FAVICON: 'info',
  MISSING_HTML_LANG: 'info',
  THIN_CONTENT: 'warning',
  SLOW_RESPONSE: 'warning',
};

// ---------------------------------------------------------------------------
// Dimension weights
// ---------------------------------------------------------------------------

export const DIMENSION_WEIGHTS: Record<keyof DimensionScores, number> = {
  technicalCorrectness: 0.30,
  metadataQuality: 0.25,
  crawlCoverage: 0.25,
  architecture: 0.15,
  contentPerformance: 0.05,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(n: number, total: number): number {
  if (total === 0) return 100;
  return (n / total) * 100;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function isHtmlPage(page: AnalyzablePage): boolean {
  if (page.contentType === null) return false;
  return page.contentType.includes('text/html') || page.contentType.includes('application/xhtml+xml');
}

function isContentEligible(page: AnalyzablePage): boolean {
  return page.statusCode === 200 && isHtmlPage(page);
}

function text(value: string | null): string {
  return value?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Crawl state determination
// ---------------------------------------------------------------------------

export function determineCrawlState(
  site: SiteSignals,
  pages: AnalyzablePage[],
  crawlMeta: CrawlMeta,
): { state: CrawlState; reason: string | null } {
  const { pagesDiscovered, pagesCrawled } = crawlMeta;

  if (pagesCrawled === 0 && pagesDiscovered === 0) {
    return { state: 'FAILED', reason: 'No pages were discovered or crawled.' };
  }

  if (pagesCrawled === 0 && pagesDiscovered > 0) {
    if (!site.robotsFound) {
      return { state: 'RESTRICTED', reason: 'Crawler could not access any pages. Site may be blocking crawlers.' };
    }
    return { state: 'FAILED', reason: 'Pages were discovered but none could be crawled.' };
  }

  const htmlPages = pages.filter(isHtmlPage);
  const coverage = pagesDiscovered > 0 ? pagesCrawled / pagesDiscovered : 1;

  if (coverage <= 0.1 && pagesDiscovered > 10) {
    return { state: 'PARTIAL', reason: `Only ${pagesCrawled} of ${pagesDiscovered} discovered pages were crawled (${Math.round(coverage * 100)}% coverage).` };
  }

  const hasJs = htmlPages.some((p) => p.jsFileCount > 0);
  const avgWords = htmlPages.length > 0
    ? htmlPages.reduce((s, p) => s + (p.wordCount ?? 0), 0) / htmlPages.length
    : 0;
  if (hasJs && avgWords === 0 && htmlPages.length > 0) {
    return { state: 'LIMITED_RENDERING', reason: 'Pages contain JavaScript but no visible text content was extracted. Client-side rendering may be limiting crawl.' };
  }

  return { state: 'COMPLETED', reason: null };
}

// ---------------------------------------------------------------------------
// Dimension 1: Technical Correctness
// ---------------------------------------------------------------------------

function computeTechnicalCorrectness(
  site: SiteSignals,
  pages: AnalyzablePage[],
  contentPages: AnalyzablePage[],
): number {
  const allPages = pages.length;
  if (allPages === 0) return 0;

  const hasHttps = new URL(site.websiteUrl).protocol === 'https:';
  const httpsScore = hasHttps ? 100 : 0;

  const okPages = pages.filter((p) => p.statusCode === 200).length;
  const statusScore = pct(okPages, allPages);

  const indexablePages = contentPages.filter((p) => p.isIndexable !== false).length;
  const indexabilityScore = contentPages.length > 0 ? pct(indexablePages, contentPages.length) : 100;

  const robotsScore = site.robotsFound ? 100 : 60;
  const sitemapScore = site.sitemapFound ? 100 : 70;

  let brokenLinkPenalty = 0;
  for (const page of contentPages) {
    for (const target of page.internalLinks) {
      const targetPage = pages.find((p) => p.url === target);
      if (targetPage && (targetPage.statusCode === 0 || (targetPage.statusCode ?? 0) >= 400)) {
        brokenLinkPenalty += 2;
      }
    }
  }
  const maxBrokenPenalty = contentPages.length * 5;
  const brokenLinksScore = maxBrokenPenalty > 0
    ? Math.max(0, 100 - (brokenLinkPenalty / maxBrokenPenalty) * 100)
    : 100;

  const score = (
    httpsScore * 0.25 +
    statusScore * 0.25 +
    indexabilityScore * 0.20 +
    robotsScore * 0.10 +
    sitemapScore * 0.10 +
    brokenLinksScore * 0.10
  );

  return clamp(score);
}

// ---------------------------------------------------------------------------
// Dimension 2: Metadata & HTML Quality
// ---------------------------------------------------------------------------

function computeMetadataQuality(contentPages: AnalyzablePage[]): number {
  if (contentPages.length === 0) return 0;

  const n = contentPages.length;

  const withTitle = contentPages.filter((p) => text(p.title).length > 0).length;
  const titleCoverage = pct(withTitle, n);

  const goodTitleLength = contentPages.filter((p) => {
    const t = text(p.title);
    return t.length >= TITLE_MIN_LENGTH && t.length <= TITLE_MAX_LENGTH;
  }).length;
  const titleLengthScore = pct(goodTitleLength, n);

  const withMeta = contentPages.filter((p) => text(p.metaDescription).length > 0).length;
  const metaCoverage = pct(withMeta, n);

  const withH1 = contentPages.filter((p) => p.h1Count >= 1).length;
  const h1Coverage = pct(withH1, n);

  const singleH1 = contentPages.filter((p) => p.h1Count === 1).length;
  const h1Quality = pct(singleH1, n);

  const withOg = contentPages.filter((p) => text(p.ogTitle).length > 0 || text(p.ogDescription).length > 0).length;
  const ogCoverage = pct(withOg, n);

  const withViewport = contentPages.filter((p) => p.hasViewport).length;
  const viewportScore = pct(withViewport, n);

  const withCharset = contentPages.filter((p) => p.hasCharset).length;
  const charsetScore = pct(withCharset, n);

  const withLang = contentPages.filter((p) => text(p.htmlLang).length > 0).length;
  const langScore = pct(withLang, n);

  const withFavicon = contentPages.filter((p) => p.hasFavicon).length;
  const faviconScore = pct(withFavicon, n);

  const withCanonical = contentPages.filter((p) => text(p.canonicalUrl).length > 0).length;
  const canonicalScore = pct(withCanonical, n);

  const score = (
    titleCoverage * 0.15 +
    titleLengthScore * 0.05 +
    metaCoverage * 0.15 +
    h1Coverage * 0.10 +
    h1Quality * 0.05 +
    ogCoverage * 0.10 +
    viewportScore * 0.10 +
    charsetScore * 0.05 +
    langScore * 0.05 +
    faviconScore * 0.05 +
    canonicalScore * 0.15
  );

  return clamp(score);
}

// ---------------------------------------------------------------------------
// Dimension 3: Crawl Coverage & Indexability
// ---------------------------------------------------------------------------

function computeCrawlCoverage(
  pages: AnalyzablePage[],
  contentPages: AnalyzablePage[],
  crawlMeta: CrawlMeta,
): number {
  const { pagesDiscovered, pagesCrawled } = crawlMeta;
  if (pagesDiscovered === 0) return 50;

  const crawlSuccessRate = pct(pagesCrawled, pagesDiscovered);

  const okPages = pages.filter((p) => p.statusCode === 200).length;
  const okRate = pages.length > 0 ? pct(okPages, pages.length) : 0;

  const indexablePages = contentPages.filter((p) => p.isIndexable !== false).length;
  const indexableRate = contentPages.length > 0 ? pct(indexablePages, contentPages.length) : 0;

  const withCanonical = contentPages.filter((p) => text(p.canonicalUrl).length > 0).length;
  const canonicalRate = contentPages.length > 0 ? pct(withCanonical, contentPages.length) : 0;

  const withNoindex = contentPages.filter((p) => p.isIndexable === false).length;
  const noindexPenalty = contentPages.length > 0 ? (withNoindex / contentPages.length) * 30 : 0;

  const score = (
    crawlSuccessRate * 0.30 +
    okRate * 0.25 +
    indexableRate * 0.20 +
    canonicalRate * 0.15 +
    (100 - noindexPenalty) * 0.10
  );

  return clamp(score);
}

// ---------------------------------------------------------------------------
// Dimension 4: Architecture & Discoverability
// ---------------------------------------------------------------------------

function computeArchitecture(
  site: SiteSignals,
  pages: AnalyzablePage[],
  contentPages: AnalyzablePage[],
): number {
  if (contentPages.length === 0) return 0;

  const n = contentPages.length;

  const withLinks = contentPages.filter((p) => p.internalLinks.length > 0).length;
  const linkCoverage = pct(withLinks, n);

  let brokenCount = 0;
  for (const page of contentPages) {
    for (const target of page.internalLinks) {
      const targetPage = pages.find((p) => p.url === target);
      if (targetPage && (targetPage.statusCode === 0 || (targetPage.statusCode ?? 0) >= 400)) {
        brokenCount++;
      }
    }
  }
  const totalLinks = contentPages.reduce((s, p) => s + p.internalLinks.length, 0);
  const linkHealth = totalLinks > 0 ? pct(totalLinks - brokenCount, totalLinks) : 100;

  const withSitemap = site.sitemapFound ? 100 : 50;

  const urlSet = new Set(pages.map((p) => p.url));
  let linkedUrls = 0;
  for (const page of contentPages) {
    for (const link of page.internalLinks) {
      if (urlSet.has(link)) linkedUrls++;
    }
  }
  const uniqueUrls = new Set(pages.map((p) => p.url)).size;
  const discoverability = uniqueUrls > 0 ? pct(linkedUrls, uniqueUrls) : 50;

  const score = (
    linkCoverage * 0.25 +
    linkHealth * 0.30 +
    withSitemap * 0.20 +
    discoverability * 0.25
  );

  return clamp(score);
}

// ---------------------------------------------------------------------------
// Dimension 5: Content & Performance
// ---------------------------------------------------------------------------

function computeContentPerformance(contentPages: AnalyzablePage[]): number {
  if (contentPages.length === 0) return 0;

  const n = contentPages.length;

  const withWords = contentPages.filter((p) => p.wordCount !== null && p.wordCount >= 300).length;
  const wordScore = pct(withWords, n);

  const withResponse = contentPages.filter((p) => p.responseTimeMs !== null && p.responseTimeMs <= 3000).length;
  const responseScore = pct(withResponse, n);

  const withSchema = contentPages.filter((p) => p.jsonLdTypes.length > 0).length;
  const schemaScore = pct(withSchema, n);

  const withImages = contentPages.filter((p) => p.imageCount === 0 || p.imagesMissingAlt === 0);
  const imageScore = pct(withImages.length, n);

  const score = (
    wordScore * 0.30 +
    responseScore * 0.30 +
    schemaScore * 0.20 +
    imageScore * 0.20
  );

  return clamp(score);
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function computeTechnicalHealthScore(
  site: SiteSignals,
  pages: AnalyzablePage[],
  crawlMeta: CrawlMeta,
): { healthScore: number; crawlState: CrawlState; crawlStateReason: string | null; dimensions: DimensionScores } {
  const contentPages = pages.filter(isContentEligible);

  const { state: crawlState, reason: crawlStateReason } = determineCrawlState(site, pages, crawlMeta);

  if (crawlState === 'FAILED' || crawlState === 'RESTRICTED') {
    return {
      healthScore: 0,
      crawlState,
      crawlStateReason,
      dimensions: {
        technicalCorrectness: 0,
        metadataQuality: 0,
        crawlCoverage: 0,
        architecture: 0,
        contentPerformance: 0,
      },
    };
  }

  const technicalCorrectness = computeTechnicalCorrectness(site, pages, contentPages);
  const metadataQuality = computeMetadataQuality(contentPages);
  const crawlCoverage = computeCrawlCoverage(pages, contentPages, crawlMeta);
  const architecture = computeArchitecture(site, pages, contentPages);
  const contentPerformance = computeContentPerformance(contentPages);

  const dimensions: DimensionScores = {
    technicalCorrectness,
    metadataQuality,
    crawlCoverage,
    architecture,
    contentPerformance,
  };

  const healthScore = clamp(
    technicalCorrectness * DIMENSION_WEIGHTS.technicalCorrectness +
    metadataQuality * DIMENSION_WEIGHTS.metadataQuality +
    crawlCoverage * DIMENSION_WEIGHTS.crawlCoverage +
    architecture * DIMENSION_WEIGHTS.architecture +
    contentPerformance * DIMENSION_WEIGHTS.contentPerformance
  );

  return { healthScore, crawlState, crawlStateReason, dimensions };
}
