export function normalizeCrawlUrl(input: string | URL): string {
  const url = typeof input === 'string' ? new URL(input) : input;
  url.hash = '';
  if (url.port === '80' && url.protocol === 'http:') url.port = '';
  if (url.port === '443' && url.protocol === 'https:') url.port = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

export function isWithinDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  const root = domain.toLowerCase();
  return host === root || host.endsWith(`.${root}`);
}

export function normalizeInternalLink(href: string, baseUrl: string, domain: string): string | null {
  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (!isWithinDomain(url.hostname, domain)) {
    return null;
  }
  return normalizeCrawlUrl(url);
}

export function originOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}