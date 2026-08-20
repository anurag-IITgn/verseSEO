import { gscConfig } from './config.js';
import { GoogleGscProvider, type GscProvider } from './provider.js';

let override: GscProvider | null | undefined;

/**
 * Registry indirection so tests can inject a fake provider without touching the
 * Google network. Leave unset in production to resolve from the environment.
 */
export function setGscProviderForTesting(provider: GscProvider | null): void {
  override = provider;
}

export function getGscProvider(): GscProvider | null {
  if (override !== undefined) return override;
  const config = gscConfig();
  return config ? new GoogleGscProvider(config) : null;
}