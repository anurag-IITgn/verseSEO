export interface RedditComment {
  author: string | null;
  body: string;
  score: number;
  /** ISO timestamp of the comment, or null when absent. */
  createdAt: string | null;
}

export interface RedditPost {
  subreddit: string;
  title: string;
  /** Absolute permalink path on reddit.com, e.g. /r/sub/comments/id/slug/. */
  permalink: string;
  author: string | null;
  /** Reddit's own score for the post (real provider data). */
  score: number;
  /** Reddit's own comment count for the post (real provider data). */
  numComments: number;
  /** ISO timestamp from Reddit's created_utc, or null when absent. */
  createdAt: string | null;
  /** First 500 characters of the real selftext, or null when absent. */
  bodySnippet: string | null;
  /** Real conversation comments when the provider returned them (Apify). */
  comments?: RedditComment[];
}

export interface RedditSearchOptions {
  limit?: number;
}

export interface RedditProvider {
  readonly name: string;
  readonly requiresCredentials: boolean;
  search(query: string, options?: RedditSearchOptions): Promise<RedditPost[]>;
}