import { env } from '../../config/env.js';
import type { AiProvider } from '../types.js';
import { GeminiProvider } from './geminiProvider.js';

/**
 * Resolve the AI provider from the environment. Gemini is the first provider;
 * future providers (OpenAI, Claude, Perplexity) plug in behind the same
 * AiProvider interface. Returns null when no provider is configured so the
 * service can report an honest "not connected" state.
 */
export function createConfiguredProvider(): AiProvider | null {
  if (env.GEMINI_API_KEY) {
    return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
  }
  return null;
}