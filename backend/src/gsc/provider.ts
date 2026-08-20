import type { GscConfig } from './config.js';
import { GscUnavailableError } from './errors.js';
import { mapGscQueryResponse, mapGscSitesResponse } from './mapping.js';
import { exchangeGscCode, refreshGscAccessToken, type GscTokenResult } from './oauth.js';
import type { GscQueryRow } from './types.js';

export interface GscProvider {
  readonly name: string;
  exchangeCode(code: string): Promise<GscTokenResult>;
  refreshAccessToken(refreshToken: string): Promise<GscTokenResult>;
  listSites(accessToken: string): Promise<string[]>;
  searchAnalytics(accessToken: string, siteUrl: string, startDate: string, endDate: string): Promise<GscQueryRow[]>;
}

const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';
const SEARCH_ANALYTICS_URL = 'https://www.googleapis.com/webmasters/v3/sites';
const TIMEOUT_MS = 15_000;

/**
 * Real Google Search Console provider using the Webmasters API v3. Only real
 * first-party data is returned; any failure raises GscUnavailableError so the
 * product reports an honest state instead of fabricated metrics.
 */
export class GoogleGscProvider implements GscProvider {
  readonly name = 'google-search-console';

  constructor(private readonly config: GscConfig) {}

  exchangeCode(code: string): Promise<GscTokenResult> {
    return exchangeGscCode(this.config, code);
  }

  refreshAccessToken(refreshToken: string): Promise<GscTokenResult> {
    return refreshGscAccessToken(this.config, refreshToken);
  }

  async listSites(accessToken: string): Promise<string[]> {
    const payload = await this.authorizedGet(`${SITES_URL}?alt=json`, accessToken);
    return mapGscSitesResponse(payload);
  }

  async searchAnalytics(accessToken: string, siteUrl: string, startDate: string, endDate: string): Promise<GscQueryRow[]> {
    const endpoint = `${SEARCH_ANALYTICS_URL}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const payload = await this.authorizedPost(
      endpoint,
      accessToken,
      JSON.stringify({ startDate, endDate, dimensions: ['query'], rowLimit: 5000 }),
    );
    return mapGscQueryResponse(payload);
  }

  private async authorizedGet(url: string, accessToken: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) {
        throw new GscUnavailableError('HTTP', `Google Search Console request failed (HTTP ${res.status}).`);
      }
      return await res.json();
    } catch (error) {
      if (error instanceof GscUnavailableError) throw error;
      if (controller.signal.aborted) throw new GscUnavailableError('TIMEOUT', 'Google Search Console request timed out.');
      throw new GscUnavailableError('NETWORK', `Google Search Console request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async authorizedPost(url: string, accessToken: string, body: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      if (!res.ok) {
        throw new GscUnavailableError('HTTP', `Google Search Console request failed (HTTP ${res.status}).`);
      }
      return await res.json();
    } catch (error) {
      if (error instanceof GscUnavailableError) throw error;
      if (controller.signal.aborted) throw new GscUnavailableError('TIMEOUT', 'Google Search Console request timed out.');
      throw new GscUnavailableError('NETWORK', `Google Search Console request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}