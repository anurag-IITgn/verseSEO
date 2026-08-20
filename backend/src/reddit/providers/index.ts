import dotenv from 'dotenv';
import { env } from '../../config/env.js';
import type { RedditProvider } from '../types.js';
import { ApifyRedditProvider } from './apifyProvider.js';
import { OAuthRedditProvider } from './oauthProvider.js';

/**
 * Builds the Reddit provider from the environment. Apify is preferred when
 * APIFY_API_TOKEN is configured (it survives Reddit's blocked `.json` search
 * API); otherwise the official Reddit OAuth API is used when its credentials
 * exist. Returns null when nothing is configured, which lets the product show
 * an honest "not connected" state instead of fabricated data.
 */
export function createConfiguredProvider(): RedditProvider | null {
  // Re-read .env so credentials configured after the process started are
  // picked up (dotenv.config() never overrides existing process.env values).
  dotenv.config();
  const apifyToken = process.env.APIFY_API_TOKEN ?? env.APIFY_API_TOKEN;
  if (apifyToken) {
    return new ApifyRedditProvider(apifyToken);
  }
  if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
    return new OAuthRedditProvider(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET, env.REDDIT_USER_AGENT);
  }
  return null;
}