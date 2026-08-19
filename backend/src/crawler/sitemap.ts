import type { CrawlOptions } from './types.js';
import { normalizeInternalLink } from './url.js';

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

export async function discoverSitemapUrls(
  origin: string,
  domain: string,
  robotsSitemaps: string[],
  options: CrawlOptions,
): Promise<string[]> {
  const candidates = robotsSitemaps.length > 0 ? robotsSitemaps : [`${origin}/sitemap.xml`];
  const results = new Set<string>();

  for (const candidate of candidates) {
    const target = normalizeInternalLink(candidate, origin, domain);
    if (!target) continue;

    let body = '';
    try {
      const response = await fetch(target, {
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: { 'user-agent': options.userAgent },
      });
      if (response.status !== 200) continue;
      body = await response.text();
    } catch {
      continue;
    }

    const locs = body.match(/<\s*loc\s*>(.*?)<\s*\/\s*loc\s*>/gi) ?? [];
    for (const loc of locs) {
      const inner = loc.replace(/<\s*\/?\s*loc\s*>/gi, '').trim();
      const normalized = normalizeInternalLink(decodeEntities(inner), target, domain);
      if (normalized) {
        results.add(normalized);
      }
    }
  }

  return [...results];
}