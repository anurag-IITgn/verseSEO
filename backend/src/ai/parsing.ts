interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
}

/**
 * Extract the model text from a Gemini generateContent response payload.
 * Tolerant of missing candidates/parts so a malformed or empty payload
 * degrades to an empty string instead of throwing.
 */
export function parseGeminiResponse(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';
  const { candidates } = payload as GeminiResponse;
  if (!Array.isArray(candidates)) return '';
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  const text = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}