import { RedditUnavailableError } from '../errors.js';
import { mapRedditSearchResponse } from '../mapping.js';
import type { RedditPost, RedditProvider, RedditSearchOptions } from '../types.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const SEARCH_URL = 'https://oauth.reddit.com/api/v1/search';
const REQUEST_TIMEOUT_MS = 10_000;

interface TokenCache {
  token: string;
  expiresAt: number;
}

/**
 * Official Reddit API provider using the free OAuth2 client-credentials
 * flow (https://www.reddit.com/prefs/apps). Requires REDDIT_CLIENT_ID and
 * REDDIT_CLIENT_SECRET. Returns only real Reddit data; any failure raises
 * RedditUnavailableError so the product can report an honest state.
 */
export class OAuthRedditProvider implements RedditProvider {
  readonly name = 'reddit-oauth';
  readonly requiresCredentials = true;

  private tokenCache: TokenCache | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly userAgent: string,
  ) {}

  private async fetchToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.token;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) {
        throw new RedditUnavailableError(`Reddit OAuth token request failed (HTTP ${res.status}). Check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.`);
      }
      const payload = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
      if (typeof payload.access_token !== 'string' || payload.access_token === '') {
        throw new RedditUnavailableError('Reddit OAuth token request returned no access token.');
      }
      const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in) ? payload.expires_in : 3600;
      this.tokenCache = { token: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
      return payload.access_token;
    } catch (error) {
      if (error instanceof RedditUnavailableError) throw error;
      if (controller.signal.aborted) throw new RedditUnavailableError('Reddit OAuth token request timed out.');
      throw new RedditUnavailableError(`Reddit OAuth token request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(query: string, options: RedditSearchOptions = {}): Promise<RedditPost[]> {
    const token = await this.fetchToken();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url = new URL(SEARCH_URL);
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'link');
      url.searchParams.set('sort', 'relevance');
      url.searchParams.set('limit', String(options.limit ?? 5));

      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': this.userAgent },
      });
      if (!res.ok) {
        throw new RedditUnavailableError(`Reddit search request failed (HTTP ${res.status}).`);
      }
      return mapRedditSearchResponse(await res.json());
    } catch (error) {
      if (error instanceof RedditUnavailableError) throw error;
      if (controller.signal.aborted) throw new RedditUnavailableError('Reddit search request timed out.');
      throw new RedditUnavailableError(`Reddit search request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}