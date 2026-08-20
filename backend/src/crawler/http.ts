import type { CrawlOptions } from './types.js';
import { resolveRedirectTarget } from './url.js';

export interface FetchResult {
  statusCode: number;
  statusText: string;
  contentType: string | null;
  body: Buffer;
  finalUrl: string;
  responseTimeMs: number;
}

export class FetchError extends Error {
  readonly reason: 'TIMEOUT' | 'CONNECTION' | 'REDIRECT_LIMIT';
  readonly url: string;

  constructor(reason: FetchError['reason'], url: string, message: string) {
    super(message);
    this.name = 'FetchError';
    this.reason = reason;
    this.url = url;
  }
}

const MAX_REDIRECTS = 5;

export async function fetchPage(url: string, options: CrawlOptions): Promise<FetchResult> {
  let current = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const started = performance.now();

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': options.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
    } catch (error) {
      const reason: FetchError['reason'] = controller.signal.aborted ? 'TIMEOUT' : 'CONNECTION';
      throw new FetchError(reason, url, `Failed to fetch ${current}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    const responseTimeMs = performance.now() - started;

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { statusCode: response.status, statusText: response.statusText, contentType: null, body: Buffer.alloc(0), finalUrl: current, responseTimeMs };
      }
      const target = resolveRedirectTarget(location, current, options.domain);
      if (!target || target === current) {
        return { statusCode: response.status, statusText: response.statusText, contentType: null, body: Buffer.alloc(0), finalUrl: current, responseTimeMs };
      }
      current = target;
      continue;
    }

    const contentType = response.headers.get('content-type');
    const body = Buffer.from(await response.arrayBuffer());
    return { statusCode: response.status, statusText: response.statusText, contentType, body, finalUrl: current, responseTimeMs };
  }

  throw new FetchError('REDIRECT_LIMIT', url, `Redirect limit exceeded for ${url}`);
}