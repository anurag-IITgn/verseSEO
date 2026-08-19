import type { AiProvider } from './types.js';
import { createConfiguredProvider } from './providers/index.js';

let override: AiProvider | null | undefined;

/**
 * Registry indirection so tests can inject a fake provider without touching
 * the network. Leave unset in production to resolve from the environment.
 */
export function setAiProviderForTesting(provider: AiProvider | null): void {
  override = provider;
}

export function getAiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  return createConfiguredProvider();
}