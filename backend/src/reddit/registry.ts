import type { RedditProvider } from './types.js';
import { createConfiguredProvider } from './providers/index.js';

let override: RedditProvider | null | undefined;

/**
 * Registry indirection so tests can inject a fake provider without touching
 * the network. Leave unset in production to resolve from the environment.
 */
export function setRedditProviderForTesting(provider: RedditProvider | null): void {
  override = provider;
}

export function getRedditProvider(): RedditProvider | null {
  if (override !== undefined) return override;
  return createConfiguredProvider();
}