/**
 * Raised when the Reddit provider cannot return real data (auth failure,
 * rate limit, network error, unexpected response). The service converts
 * this into an honest "unavailable" response rather than fabricated data.
 */
export class RedditUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedditUnavailableError';
  }
}