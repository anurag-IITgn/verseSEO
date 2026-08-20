import { RedditUnavailableError } from '../errors.js';
import { mapApifyRedditItems } from '../mapping.js';
import type { RedditPost, RedditProvider, RedditSearchOptions } from '../types.js';

const API_BASE = 'https://api.apify.com';
// Immutable Apify actor id for labrat011/reddit-scraper (owner~name and
// owner/name aliases are not reliably resolved when authenticating via the
// Authorization header, so the stable uuid is used).
const ACTOR_ID = 'dejMd0QoBemGH3zTn';
const RUN_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 3_000;
const MAX_COMMENTS_PER_POST = 8;
const MAX_COMMENT_CHARS = 2000;

/**
 * Reddit provider backed by the Apify "Reddit Scraper" Actor
 * (labrat011/reddit-scraper), which parses Reddit's server-rendered HTML and
 * therefore keeps working after Reddit shut down the legacy `.json` search
 * API. Uses only the fields verified in the Actor's real output (title,
 * subreddit, url, author, selftext, score, numComments, created, comments).
 * Requires APIFY_API_TOKEN; any failure raises RedditUnavailableError so the
 * product reports an honest state instead of fabricated discussions.
 */
export class ApifyRedditProvider implements RedditProvider {
  readonly name = 'reddit-apify';
  readonly requiresCredentials = true;

  constructor(private readonly apiToken: string) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
    try {
      return await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          ...(init?.headers ?? {}),
        },
      });
    } catch (error) {
      if (controller.signal.aborted) throw new RedditUnavailableError('Apify Reddit request timed out.');
      throw new RedditUnavailableError(
        `Apify Reddit request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForRun(runId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let run: Record<string, unknown> = {};
    while (Date.now() < deadline) {
      const res = await this.request(`/v2/actor-runs/${runId}`);
      if (!res.ok) {
        throw new RedditUnavailableError(`Apify run status request failed (HTTP ${res.status}).`);
      }
      const body = (await res.json()) as { data?: Record<string, unknown> };
      run = body.data ?? {};
      const status = typeof run.status === 'string' ? run.status : '';
      if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED' || status === 'TIMED_OUT') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    const status = typeof run.status === 'string' ? run.status : '';
    if (status === 'SUCCEEDED') return run;
    if (status === '') throw new RedditUnavailableError('Apify Reddit run did not finish in time.');

    const errorInfo = run.errorInfo ?? {};
    const detail = typeof errorInfo === 'object' && errorInfo !== null ? JSON.stringify(errorInfo).slice(0, 300) : '';
    throw new RedditUnavailableError(`Apify Reddit run ${status}.${detail !== '' ? ` ${detail}` : ''}`);
  }

  async search(query: string, options: RedditSearchOptions = {}): Promise<RedditPost[]> {
    const limit = Math.max(1, Math.min(25, options.limit ?? 5));

    const startRes = await this.request(`/v2/acts/${ACTOR_ID}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'search',
        searchQuery: query,
        searchSort: 'relevance',
        maxResults: limit * (1 + MAX_COMMENTS_PER_POST),
        includeComments: true,
        maxCommentsPerPost: MAX_COMMENTS_PER_POST,
      }),
    });
    if (!startRes.ok) {
      if (startRes.status === 401 || startRes.status === 403) {
        throw new RedditUnavailableError('Apify authentication failed. Check APIFY_API_TOKEN.');
      }
      throw new RedditUnavailableError(`Apify Reddit run could not be started (HTTP ${startRes.status}).`);
    }

    const startBody = (await startRes.json()) as { data?: { id?: string } };
    const runId = startBody.data?.id;
    if (typeof runId !== 'string' || runId === '') {
      throw new RedditUnavailableError('Apify Reddit run started without a run id.');
    }

    const run = await this.waitForRun(runId);
    const datasetId = typeof run.defaultDatasetId === 'string' ? run.defaultDatasetId : null;
    if (!datasetId) {
      throw new RedditUnavailableError('Apify Reddit run finished without a dataset.');
    }

    const itemsRes = await this.request(`/v2/datasets/${datasetId}/items?format=json`);
    if (!itemsRes.ok) {
      throw new RedditUnavailableError(`Apify dataset request failed (HTTP ${itemsRes.status}).`);
    }
    const items = (await itemsRes.json()) as unknown;

    const posts = mapApifyRedditItems(items);
    return posts.slice(0, limit).map((post) => ({
      ...post,
      comments: post.comments?.length ? post.comments.map((c) => ({ ...c, body: c.body.slice(0, MAX_COMMENT_CHARS) })) : [],
    }));
  }
}