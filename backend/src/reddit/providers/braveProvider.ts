import { RedditUnavailableError } from '../errors.js';
import type { RedditPost, RedditProvider, RedditSearchOptions } from '../types.js';

const BRAVE_API_BASE = 'https://api.search.brave.com/res/v1';
const REQUEST_TIMEOUT_MS = 30_000;
const SNIPPET_LENGTH = 500;
const MAX_SNIPPET_CHARS = 2000;

interface BraveGroundingItem {
  url?: string;
  title?: string;
  snippets?: string[];
}

interface BraveSourceMeta {
  title?: string;
  hostname?: string;
  age?: string[];
}

interface BraveLlmContextResponse {
  grounding?: {
    generic?: BraveGroundingItem[];
  };
  sources?: Record<string, BraveSourceMeta>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract the Reddit permalink from a full URL.
 * Handles: https://www.reddit.com/r/sub/comments/id/slug/...
 * Returns: /r/sub/comments/id/slug/
 */
function extractPermalink(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('reddit.com')) return null;
    const path = parsed.pathname;
    if (!path.startsWith('/r/')) return null;
    return path.endsWith('/') ? path : `${path}/`;
  } catch {
    return null;
  }
}

/**
 * Extract the subreddit from a Reddit URL or permalink.
 * /r/personalfinance/comments/... → personalfinance
 */
function extractSubreddit(url: string): string | null {
  const match = url.match(/\/r\/([a-zA-Z0-9_]+)/);
  return match ? match[1] : null;
}

/**
 * Parse the Brave LLM Context API age array into an ISO timestamp if possible.
 * age[3] is typically the ISO 8601 timestamp.
 */
function parseAgeToIso(age: string[] | undefined): string | null {
  if (!Array.isArray(age)) return null;
  // age[3] is ISO 8601 timestamp per Brave docs
  if (age.length > 3 && typeof age[3] === 'string') {
    const parsed = Date.parse(age[3]);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  // age[1] is YYYY-MM-DD format
  if (age.length > 1 && typeof age[1] === 'string') {
    const parsed = Date.parse(age[1]);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

/**
 * Reddit provider backed by the Brave Search LLM Context API.
 *
 * The LLM Context endpoint extracts pre-processed web content including
 * forum discussions (e.g. from Reddit). Returns RedditPost values mapped
 * from Brave's grounding data. Metadata that Brave does not provide
 * (score, numComments, author) is set to safe defaults (0/null).
 *
 * Requires BRAVE_API_KEY; any failure raises RedditUnavailableError so
 * the product reports an honest state instead of fabricated discussions.
 */
export class BraveRedditProvider implements RedditProvider {
  readonly name = 'reddit-brave';
  readonly requiresCredentials = true;

  constructor(private readonly apiKey: string) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${BRAVE_API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'X-Subscription-Token': this.apiKey,
          'Accept': 'application/json',
          ...(init?.headers ?? {}),
        },
      });
    } catch (error) {
      if (controller.signal.aborted) throw new RedditUnavailableError('Brave Search request timed out.');
      throw new RedditUnavailableError(
        `Brave Search request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(query: string, options: RedditSearchOptions = {}): Promise<RedditPost[]> {
    const limit = Math.max(1, Math.min(25, options.limit ?? 5));

    // Use LLM Context endpoint with a focus on Reddit discussions.
    // The query is appended with "site:reddit.com" to prioritize Reddit results.
    const searchQuery = `${query} site:reddit.com`;

    const params = new URLSearchParams({
      q: searchQuery,
      count: String(Math.min(limit * 3, 50)), // Request more to account for non-Reddit results
      maximum_number_of_tokens: '16384',
      maximum_number_of_urls: String(Math.min(limit * 3, 50)),
      context_threshold_mode: 'balanced',
    });

    let body: BraveLlmContextResponse;
    try {
      const res = await this.request(`/llm/context?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new RedditUnavailableError('Brave Search authentication failed. Check BRAVE_API_KEY.');
        }
        throw new RedditUnavailableError(`Brave Search request failed (HTTP ${res.status}).`);
      }
      body = (await res.json()) as BraveLlmContextResponse;
    } catch (error) {
      if (error instanceof RedditUnavailableError) throw error;
      throw new RedditUnavailableError(
        `Brave Search request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const generic = body.grounding?.generic;
    if (!Array.isArray(generic) || generic.length === 0) {
      return [];
    }

    const posts: RedditPost[] = [];
    const seenPermalinks = new Set<string>();

    for (const item of generic) {
      if (!isRecord(item)) continue;
      const url = typeof item.url === 'string' ? item.url : '';
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const snippets = Array.isArray(item.snippets) ? item.snippets : [];

      // Only process Reddit URLs
      const permalink = extractPermalink(url);
      if (permalink === null) continue;
      if (seenPermalinks.has(permalink)) continue;
      seenPermalinks.add(permalink);

      const subreddit = extractSubreddit(url);
      if (!subreddit) continue;
      if (title === '' || title === '[removed]' || title === '[deleted]') continue;

      // First snippet is typically the post body; subsequent ones are comments
      const bodySnippet = snippets.length > 0 ? snippets[0].slice(0, SNIPPET_LENGTH) : null;

      // Build comments array from additional snippets
      const comments = snippets.slice(1).map((s) => ({
        author: null as string | null,
        body: s.slice(0, MAX_SNIPPET_CHARS),
        score: 0,
        createdAt: null as string | null,
      }));

      // Extract timestamp from sources metadata
      const sourceMeta = body.sources?.[url];
      const createdAt = parseAgeToIso(sourceMeta?.age);

      posts.push({
        subreddit,
        title,
        permalink,
        author: null, // Brave does not provide Reddit author data
        score: 0, // Brave does not provide Reddit score data
        numComments: 0, // Brave does not provide comment counts
        createdAt,
        bodySnippet,
        comments: comments.length > 0 ? comments : undefined,
      });

      if (posts.length >= limit) break;
    }

    return posts;
  }
}
