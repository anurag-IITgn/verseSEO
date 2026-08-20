import type { GscQueryRow } from './types.js';

/**
 * Defensive mapping of Google Search Console API payloads into clean internal
 * shapes. Unknown/malformed entries are dropped so a bad upstream response can
 * never inject junk into our data.
 */

interface GscSitePayload {
  siteUrl?: unknown;
}

export function mapGscSitesResponse(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const list = (payload as { siteEntry?: unknown }).siteEntry;
  if (!Array.isArray(list)) return [];
  const sites: string[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const siteUrl = (entry as GscSitePayload).siteUrl;
    if (typeof siteUrl === 'string' && siteUrl.trim() !== '') sites.push(siteUrl.trim());
  }
  return [...new Set(sites)];
}

interface GscRowPayload {
  keys?: unknown;
  clicks?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  position?: unknown;
}

function toFiniteNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mapGscQueryResponse(payload: unknown): GscQueryRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const rows = (payload as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  const result: GscQueryRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const parsed = row as GscRowPayload;
    const keys = Array.isArray(parsed.keys) ? parsed.keys.filter((k): k is string => typeof k === 'string') : [];
    if (keys.length === 0) continue;
    result.push({
      keys,
      clicks: toFiniteNumber(parsed.clicks),
      impressions: toFiniteNumber(parsed.impressions),
      ctr: toFiniteNumber(parsed.ctr),
      position: toFiniteNumber(parsed.position),
    });
  }
  return result;
}

/**
 * Hostname a GSC property refers to. Domain properties look like
 * "sc-domain:example.com"; URL-prefix properties look like "https://example.com/".
 */
export function siteHostname(siteUrl: string): string | null {
  let candidate = siteUrl.trim();
  if (candidate.startsWith('sc-domain:')) {
    candidate = candidate.slice('sc-domain:'.length);
    if (!candidate.includes('://')) candidate = `https://${candidate}`;
  }
  try {
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function gscSiteMatchesDomain(siteUrl: string, domain: string): boolean {
  const host = siteHostname(siteUrl);
  if (!host) return false;
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  return host === normalized || host === `www.${normalized}`;
}

export function formatGscDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}