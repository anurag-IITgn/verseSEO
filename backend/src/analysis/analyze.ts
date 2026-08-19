import { calculateHealthScore, DEFAULT_SEVERITY, TITLE_MAX_LENGTH, TITLE_MIN_LENGTH } from './rules.js';
import type { AnalyzablePage, IssueType, SeoAnalysisResult, SeoIssueData, SiteSignals } from './types.js';

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

function analyzeSite(site: SiteSignals, pages: AnalyzablePage[]): SeoAnalysisResult {
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
  }

  for (const group of detectDuplicateValues(contentPages, (page) => text(page.title))) {
    for (const page of group.pages) {
      issues.push(issue('DUPLICATE_TITLE', page.id, `Duplicate title: "${group.value}"`));
    }
  }

  for (const group of detectDuplicateValues(contentPages, (page) => text(page.metaDescription))) {
    for (const page of group.pages) {
      issues.push(issue('DUPLICATE_META_DESCRIPTION', page.id, `Duplicate meta description: "${group.value}"`));
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

  return {
    healthScore: calculateHealthScore(issues),
    issueCount: issues.length,
    issueCounts,
    issues,
  };
}

export { analyzeSite };