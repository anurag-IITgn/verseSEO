import { env } from '../../config/env.js';
import { OAuthRedditProvider } from './oauthProvider.js';

/**
 * Builds the Reddit provider from the environment. Returns null when the
 * official Reddit API is not configured, which lets the product show an
 * honest "not connected" state instead of fabricated data.
 */
export function createConfiguredProvider(): OAuthRedditProvider | null {
  if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
    return new OAuthRedditProvider(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET, env.REDDIT_USER_AGENT);
  }
  return null;
}