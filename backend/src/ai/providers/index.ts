import dotenv from 'dotenv';
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
  // Re-read backend/.env so credentials configured after the process started
  // (e.g. GEMINI_API_KEY added while the dev server was already running) take
  // effect on the next resolution. dotenv.config() never overrides variables
  // already present in process.env, so repeated calls are safe and the normal
  // scan path uses the same live credentials the integration test does.
  dotenv.config();
  const apiKey = process.env.GEMINI_API_KEY ?? env.GEMINI_API_KEY;
  if (apiKey) {
    return new GeminiProvider(apiKey, process.env.GEMINI_MODEL ?? env.GEMINI_MODEL);
  }
  return null;
}