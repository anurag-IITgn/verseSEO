import { AiUnavailableError } from '../errors.js';
import { parseGeminiResponse } from '../parsing.js';
import type { AiProvider } from '../types.js';

const GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Official Google Gemini provider (free-tier API, server-side only). The API
 * key is never exposed to the client. All failures surface as
 * AiUnavailableError so the product can report an honest state rather than
 * fabricating an AI answer.
 */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly requiresCredentials = true;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate(prompt: string): Promise<string> {
    const url = new URL(`${GENERATE_URL}/${encodeURIComponent(this.model)}:generateContent`);
    url.searchParams.set('key', this.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!res.ok) {
        throw new AiUnavailableError(
          `Gemini request failed (HTTP ${res.status}${res.status === 429 ? ', rate limited' : ''}). Check GEMINI_API_KEY.`,
        );
      }
      return parseGeminiResponse(await res.json());
    } catch (error) {
      if (error instanceof AiUnavailableError) throw error;
      if (controller.signal.aborted) throw new AiUnavailableError('Gemini request timed out.');
      throw new AiUnavailableError(`Gemini request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}