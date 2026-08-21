import dotenv from 'dotenv';
import { env } from '../../config/env.js';
import type { RedditProvider } from '../types.js';
import { ApifyRedditProvider } from './apifyProvider.js';
import { BraveRedditProvider } from './braveProvider.js';
import { OAuthRedditProvider } from './oauthProvider.js';

/**
 * Builds the Reddit provider from the environment. Priority:
 * 1. Brave Search LLM Context API (when BRAVE_API_KEY is configured)
 * 2. Apify Reddit Scraper (when APIFY_API_TOKEN is configured)
 * 3. Official Reddit OAuth API (when REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET are configured)
 * 4. null — lets the product show an honest "not connected" state.
 */
export function createConfiguredProvider(): RedditProvider | null {
  // Re-read .env so credentials configured after the process started are
  // picked up (dotenv.config() never overrides existing process.env values).
  dotenv.config();
  const braveKey = process.env.BRAVE_API_KEY ?? env.BRAVE_API_KEY;
  if (braveKey) {
    return new BraveRedditProvider(braveKey);
  }
  const apifyToken = process.env.APIFY_API_TOKEN ?? env.APIFY_API_TOKEN;
  if (apifyToken) {
    return new ApifyRedditProvider(apifyToken);
  }
  if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
    return new OAuthRedditProvider(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET, env.REDDIT_USER_AGENT);
  }
  return null;
}