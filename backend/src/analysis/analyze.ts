import { DEFAULT_SEVERITY, TITLE_MAX_LENGTH, TITLE_MIN_LENGTH, computeTechnicalHealthScore } from './rules.js';
import type { AnalyzablePage, CrawlMeta, IssueType, SeoAnalysisResult, SeoIssueData, SiteSignals } from './types.js';

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

function issue(issueType: IssueType, pageId: string | null, message: string): SeoIssueData {
  return { issueType, severity: DEFAULT_SEVERITY[issueType], message, pageId };
}

function detectDuplicateValues(pages: AnalyzablePage[], pick: (page: AnalyzablePage) => string): { value: string; pages: AnalyzablePage[] }[] {
  const groups = new Map<string, AnalyzablePage[]>();
  for (const page of pages) {
    const value = pick(page);
    if (!value) continue;
    const list = groups.get(value) ?? [];
    list.push(page);
    groups.set(value, list);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([value, list]) => ({ value, pages: list }));
}

function analyzeSite(site: SiteSignals, pages: AnalyzablePage[], crawlMeta: CrawlMeta): SeoAnalysisResult {
  const issues: SeoIssueData[] = [];

  if (new URL(site.websiteUrl).protocol !== 'https:') {
    issues.push(issue('MISSING_HTTPS', null, 'Website is served over HTTP instead of HTTPS'));
  }

  if (!site.robotsFound) {
    issues.push(issue('MISSING_ROBOTS_TXT', null, 'No robots.txt file was found'));
  }

  if (!site.sitemapFound) {
    issues.push(issue('MISSING_SITEMAP', null, 'No XML sitemap was found'));
  }

  const contentPages = pages.filter(isContentEligible);
  const pagesByUrl = new Map(pages.map((page) => [page.url, page]));

  for (const page of contentPages) {
    const title = text(page.title);

    if (!title) {
      issues.push(issue('MISSING_TITLE', page.id, 'Page is missing a title tag'));
    } else {
      if (title.length < TITLE_MIN_LENGTH) {
        issues.push(issue('TITLE_TOO_SHORT', page.id, `Title is too short (${title.length} characters, recommended ${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH})`));
      }
      if (title.length > TITLE_MAX_LENGTH) {
        issues.push(issue('TITLE_TOO_LONG', page.id, `Title is too long (${title.length} characters, recommended ${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH})`));
      }
    }

    if (!text(page.metaDescription)) {
      issues.push(issue('MISSING_META_DESCRIPTION', page.id, 'Page is missing a meta description'));
    }

    if (!text(page.canonicalUrl)) {
      issues.push(issue('MISSING_CANONICAL', page.id, 'Page is missing a canonical tag'));
    }

    if (page.isIndexable === false) {
      issues.push(issue('NOINDEX_PAGE', page.id, 'Page is set to noindex and will not be indexed'));
    }

    if (page.h1Count === 0) {
      issues.push(issue('MISSING_H1', page.id, 'Page is missing an H1 heading'));
    }

    if (page.imagesMissingAlt > 0) {
      issues.push(issue('IMAGES_MISSING_ALT', page.id, `${page.imagesMissingAlt} image${page.imagesMissingAlt === 1 ? '' : 's'} missing alt text`));
    }

    if (!text(page.ogTitle) && !text(page.ogDescription)) {
      issues.push(issue('MISSING_OG_TAGS', page.id, 'Page is missing Open Graph meta tags'));
    }

    if (!page.hasViewport) {
      issues.push(issue('MISSING_VIEWPORT', page.id, 'Page is missing a viewport meta tag for mobile rendering'));
    }

    if (!page.hasCharset) {
      issues.push(issue('MISSING_CHARSET', page.id, 'Page is missing a charset declaration'));
    }

    if (!page.hasFavicon) {
      issues.push(issue('MISSING_FAVICON', page.id, 'Page is missing a favicon'));
    }

    if (!page.htmlLang) {
      issues.push(issue('MISSING_HTML_LANG', page.id, 'Page is missing a lang attribute on the html element'));
    }

    if (page.wordCount !== null && page.wordCount < 300) {
      issues.push(issue('THIN_CONTENT', page.id, `Page has only ${page.wordCount} words (below 300 word threshold)`));
    }

    if (page.responseTimeMs !== null && page.responseTimeMs > 3000) {
      issues.push(issue('SLOW_RESPONSE', page.id, `Page responded in ${page.responseTimeMs}ms (above 3000ms threshold)`));
    }
  }

  for (const group of detectDuplicateValues(contentPages, (page) => text(page.title))) {
    issues.push(issue('DUPLICATE_TITLE', null, `Duplicate title "${group.value}" on ${group.pages.length} pages`));
  }

  for (const group of detectDuplicateValues(contentPages, (page) => text(page.metaDescription))) {
    issues.push(issue('DUPLICATE_META_DESCRIPTION', null, `Duplicate meta description on ${group.pages.length} pages`));
  }

  for (const page of contentPages) {
    if (page.h1Count > 1) {
      issues.push(issue('MULTIPLE_H1', page.id, `Page has ${page.h1Count} H1 headings (should have exactly 1)`));
    }
  }

  for (const page of contentPages) {
    for (const target of page.internalLinks) {
      const targetPage = pagesByUrl.get(target);
      if (targetPage && (targetPage.statusCode === 0 || (targetPage.statusCode ?? 0) >= 400)) {
        const status = targetPage.statusCode === 0 ? 'fetch failed' : `HTTP ${targetPage.statusCode}`;
        issues.push(issue('BROKEN_INTERNAL_LINK', page.id, `Broken internal link to ${target} (${status})`));
      }
    }
  }

  for (const page of pages) {
    if (page.statusCode === null) continue;
    if (page.statusCode === 0) {
      issues.push({ ...issue('NON_200_PAGE', page.id, 'Page could not be fetched (no HTTP response)'), severity: 'error' });
      continue;
    }
    if (page.statusCode >= 500) {
      issues.push({ ...issue('NON_200_PAGE', page.id, `Page returned HTTP ${page.statusCode}`), severity: 'error' });
      continue;
    }
    if (page.statusCode >= 400 && page.statusCode < 500) {
      issues.push(issue('NON_200_PAGE', page.id, `Page returned HTTP ${page.statusCode}`));
    }
  }

  const issueCounts = Object.fromEntries(
    Object.keys(DEFAULT_SEVERITY).map((key) => [key, issues.filter((i) => i.issueType === key).length]),
  ) as Record<IssueType, number>;

  const { healthScore, crawlState, crawlStateReason, dimensions } = computeTechnicalHealthScore(site, pages, crawlMeta);

  return {
    healthScore,
    crawlState,
    crawlStateReason,
    dimensions,
    issueCount: issues.length,
    issueCounts,
    issues,
  };
}

export { analyzeSite };
