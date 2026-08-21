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
  hasViewport: boolean;
  hasCharset: boolean;
  hasFavicon: boolean;
  htmlLang: string | null;
  externalLinkCount: number;
  cssFileCount: number;
  jsFileCount: number;
  iframeCount: number;
}

function countTag(doc: ReturnType<typeof parse>, tag: string): number {
  return doc.querySelectorAll(tag).length;
}

function metaContent(doc: ReturnType<typeof parse>, name: string): string | null {
  const el = doc.querySelector(`meta[property="${name}"]`) ?? doc.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute('content')?.trim() ?? null;
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

  const h1Count = countTag(doc, 'h1');
  const h2Count = countTag(doc, 'h2');
  const h3Count = countTag(doc, 'h3');
  const h4Count = countTag(doc, 'h4');
  const h5Count = countTag(doc, 'h5');
  const h6Count = countTag(doc, 'h6');

  const images = doc.querySelectorAll('img');
  let imagesMissingAlt = 0;
  for (const img of images) {
    const alt = img.getAttribute('alt');
    if (!alt || alt.trim() === '') imagesMissingAlt++;
  }

  const jsonLdTypes: string[] = [];
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      if (data?.['@type']) {
        const types = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
        for (const t of types) {
          if (typeof t === 'string' && !jsonLdTypes.includes(t)) jsonLdTypes.push(t);
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  }

  const ogTitle = metaContent(doc, 'og:title');
  const ogDescription = metaContent(doc, 'og:description');
  const ogImage = metaContent(doc, 'og:image');
  const twitterCard = metaContent(doc, 'twitter:card');
  const twitterTitle = metaContent(doc, 'twitter:title');
  const twitterDescription = metaContent(doc, 'twitter:description');
  const twitterImage = metaContent(doc, 'twitter:image');

  const hasViewport = !!doc.querySelector('meta[name="viewport"]');
  const hasCharset = !!doc.querySelector('meta[charset]') || !!doc.querySelector('meta[http-equiv="Content-Type"]');
  const hasFavicon = !!doc.querySelector('link[rel="icon"]') || !!doc.querySelector('link[rel="shortcut icon"]');
  const htmlLang = doc.querySelector('html')?.getAttribute('lang') ?? null;

  let externalLinkCount = 0;
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    try {
      const absolute = new URL(href, pageUrl);
      if (absolute.origin !== new URL(pageUrl).origin) externalLinkCount++;
    } catch { /* ignore invalid URLs */ }
  }

  const cssFileCount = doc.querySelectorAll('link[rel="stylesheet"]').length;
  const jsFileCount = doc.querySelectorAll('script[src]').length;
  const iframeCount = doc.querySelectorAll('iframe').length;

  return {
    title,
    metaDescription,
    canonicalUrl,
    robotsDirective,
    isIndexable,
    wordCount,
    internalLinks: [...internalLinks],
    h1Count,
    h2Count,
    h3Count,
    h4Count,
    h5Count,
    h6Count,
    imageCount: images.length,
    imagesMissingAlt,
    jsonLdTypes,
    ogTitle,
    ogDescription,
    ogImage,
    twitterCard,
    twitterTitle,
    twitterDescription,
    twitterImage,
    hasViewport,
    hasCharset,
    hasFavicon,
    htmlLang,
    externalLinkCount,
    cssFileCount,
    jsFileCount,
    iframeCount,
  };
}
