import type { RedditComment, RedditPost } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SNIPPET_LENGTH = 500;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function safeAuthor(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && value !== '[deleted]' ? value.trim() : null;
}

function safeIso(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  return null;
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

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

function permalinkFromUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const path = new URL(value).pathname;
    return path.startsWith('/') ? path : `/${path}`;
  } catch {
    return null;
  }
}

/**
 * Maps the flat Apify Reddit Scraper dataset (an array of `type: "post"` and
 * `type: "comment"` items) into clean RedditPost values. Comment items are
 * grouped back onto their parent post via the shared base-36 post id. Only
 * fields verified in the real Actor output are used; malformed, removed or
 * deleted entries are skipped.
 */
export function mapApifyRedditItems(rawItems: unknown): RedditPost[] {
  if (!Array.isArray(rawItems)) return [];

  const commentByPost = new Map<string, RedditComment[]>();
  for (const item of rawItems) {
    if (!isRecord(item) || item.type !== 'comment') continue;
    const postId = typeof item.postId === 'string' ? item.postId : null;
    if (postId === null) continue;
    const body = safeText(item.body);
    if (body === '') continue;
    const comment: RedditComment = {
      author: safeAuthor(item.author),
      body: body.slice(0, 2000),
      score: safeNumber(item.score),
      createdAt: safeIso(item.created),
    };
    const bucket = commentByPost.get(postId) ?? [];
    bucket.push(comment);
    commentByPost.set(postId, bucket);
  }

  const posts: RedditPost[] = [];
  for (const item of rawItems) {
    if (!isRecord(item) || item.type !== 'post') continue;
    if (typeof item.subreddit !== 'string' || item.subreddit.trim() === '') continue;
    if (typeof item.title !== 'string') continue;
    const title = item.title.trim();
    if (title === '' || title === '[removed]' || title === '[deleted]') continue;

    const permalink = permalinkFromUrl(item.permalink ?? item.url);
    if (permalink === null) continue;

    const selftext = safeText(item.selftext);
    const postId = typeof item.id === 'string' ? item.id : null;
    const comments = postId !== null ? (commentByPost.get(postId) ?? []) : [];

    posts.push({
      subreddit: item.subreddit.trim(),
      title,
      permalink,
      author: safeAuthor(item.author),
      score: safeNumber(item.score),
      numComments: safeNumber(item.numComments),
      createdAt: safeIso(item.created),
      bodySnippet: selftext !== '' ? selftext.slice(0, SNIPPET_LENGTH) : null,
      comments,
    });
  }
  return posts;
}