import type { RedditPost } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SNIPPET_LENGTH = 500;

/**
 * Maps a Reddit search response ({ data: { children: [...] } }) to a clean
 * list of RedditPost values. Malformed entries, non-post kinds, and removed
 * or deleted posts are skipped rather than surfaced as invalid data. Only
 * fields that are real strings/numbers are kept; everything else is coerced
 * to a safe default or null.
 */
export function mapRedditSearchResponse(raw: unknown): RedditPost[] {
  if (!isRecord(raw) || !isRecord(raw.data) || !Array.isArray(raw.data.children)) {
    return [];
  }

  const posts: RedditPost[] = [];
  for (const child of raw.data.children) {
    if (!isRecord(child) || !isRecord(child.data)) continue;
    if (typeof child.kind === 'string' && child.kind !== 't3') continue;
    const data = child.data;

    if (typeof data.subreddit !== 'string' || data.subreddit.trim() === '') continue;
    if (typeof data.title !== 'string') continue;
    if (typeof data.permalink !== 'string' || !data.permalink.startsWith('/')) continue;

    const title = data.title.trim();
    if (title === '' || title === '[removed]' || title === '[deleted]') continue;

    const author = typeof data.author === 'string' && data.author.trim() !== '' && data.author !== '[deleted]' ? data.author : null;
    const createdAt =
      typeof data.created_utc === 'number' && Number.isFinite(data.created_utc) ? new Date(data.created_utc * 1000).toISOString() : null;
    const selftext = typeof data.selftext === 'string' ? data.selftext.trim() : '';

    posts.push({
      subreddit: data.subreddit.trim(),
      title,
      permalink: data.permalink,
      author,
      score: typeof data.score === 'number' && Number.isFinite(data.score) ? Math.max(0, Math.round(data.score)) : 0,
      numComments:
        typeof data.num_comments === 'number' && Number.isFinite(data.num_comments) ? Math.max(0, Math.round(data.num_comments)) : 0,
      createdAt,
      bodySnippet: selftext !== '' ? selftext.slice(0, SNIPPET_LENGTH) : null,
    });
  }
  return posts;
}