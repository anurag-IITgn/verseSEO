import { parse } from 'node-html-parser';
import { normalizeInternalLink } from './url.js';

export interface ParsedHtml {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsDirective: string | null;
  isIndexable: boolean | null;
  wordCount: number | null;
  internalLinks: string[];
}

export function parseHtml(html: string, pageUrl: string, domain: string): ParsedHtml {
  const doc = parse(html);

  const title = doc.querySelector('title')?.text.trim() ?? null;
  const metaDescription = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? null;

  const canonicalHref = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const canonicalUrl = canonicalHref ? normalizeInternalLink(canonicalHref, pageUrl, domain) : null;

  const robotsDirective = doc.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
  const isIndexable = robotsDirective === null ? null : !/\bnoindex\b/i.test(robotsDirective);

  const bodyText = doc.querySelector('body')?.text ?? '';
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  const internalLinks = new Set<string>();
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    const normalized = normalizeInternalLink(href, pageUrl, domain);
    if (normalized) {
      internalLinks.add(normalized);
    }
  }

  return {
    title,
    metaDescription,
    canonicalUrl,
    robotsDirective,
    isIndexable,
    wordCount,
    internalLinks: [...internalLinks],
  };
}