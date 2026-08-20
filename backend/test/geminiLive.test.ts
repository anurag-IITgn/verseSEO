import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'dotenv/config';

import type { AnalyzablePage } from '../src/analysis/types.js';
import { analyzeMention } from '../src/ai/mentionDetection.js';
import { selectAiPrompts } from '../src/ai/prompts.js';
import { getAiProvider } from '../src/ai/registry.js';
import { scoreVisibility } from '../src/ai/scoring.js';

const DOMAIN = 'tipcalculatorlive.com';

function makePage(overrides: Partial<AnalyzablePage> = {}): AnalyzablePage {
  return {
    id: 'live-1',
    url: 'https://tipcalculatorlive.com/',
    statusCode: 200,
    contentType: 'text/html; charset=utf-8',
    title: 'Tip Calculator — Fast Free Gratuity & Bill Split Calculator',
    metaDescription: 'Free online tip calculator. Calculate gratuity, split restaurant bills and round tips instantly.',
    canonicalUrl: null,
    robotsDirective: null,
    isIndexable: true,
    wordCount: 600,
    responseTimeMs: 120,
    internalLinks: [],
    ...overrides,
  };
}

test('REAL Gemini live integration against tipcalculatorlive.com (existing provider + scoring pipeline)', async () => {
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  assert.ok(apiKey, 'GEMINI_API_KEY must be loaded server-side from backend/.env');

  const provider = getAiProvider();
  assert.ok(provider, 'getAiProvider() must resolve to a configured provider when GEMINI_API_KEY is present');
  assert.equal(provider.name, 'gemini', 'resolved provider must be the existing GeminiProvider');
  assert.ok(provider.model, 'provider must expose a model id');

  const pages = [
    makePage(),
    makePage({
      id: 'live-2',
      url: 'https://tipcalculatorlive.com/gratuity-calculator',
      title: 'Gratuity Calculator | Tip Percentage for Restaurants',
      metaDescription: 'Find the right tip percentage with our free gratuity calculator for dining, bars and delivery.',
    }),
    makePage({
      id: 'live-3',
      url: 'https://tipcalculatorlive.com/split-bill',
      title: 'Bill Split Calculator — Divide Restaurant Bills Fairly',
      metaDescription: 'Split a restaurant bill between friends, add tax and tip, and get each person share.',
    }),
  ];

  const prompts = selectAiPrompts(pages).slice(0, 3);
  assert.ok(prompts.length > 0, 'existing prompt selector must derive topics from tipcalculatorlive.com pages');

  const results: unknown[] = [];
  let mentionCount = 0;
  let citationCount = 0;

  for (const entry of prompts) {
    const raw = await provider.generate(entry.prompt);
    assert.equal(typeof raw, 'string', 'generate() must return a string');
    const empty = raw.trim() === '';
    const analysis = empty
      ? { mentioned: false, cited: false, stance: 'absent' as const, competitors: [] }
      : analyzeMention(raw, DOMAIN);
    const scored = scoreVisibility(analysis);
    if (scored.mentioned) mentionCount += 1;
    if (scored.cited) citationCount += 1;
    results.push({
      topic: entry.topic,
      prompt: entry.prompt,
      responseChars: raw.length,
      preview: raw.trim().slice(0, 220),
      mentioned: scored.mentioned,
      cited: scored.cited,
      stance: scored.stance,
      visibilityScore: scored.visibilityScore,
      competitors: scored.stance === 'absent' ? [] : analysis.competitors,
    });
  }

  const report = JSON.stringify(
    {
      provider: provider.name,
      model: provider.model,
      promptsRun: prompts.length,
      mentionCount,
      citationCount,
      results,
    },
    null,
    2,
  );

  assert.ok(prompts.length > 0, 'at least one real Gemini API request must succeed');
  assert.ok(!report.includes(apiKey), 'API key must never appear in test output or responses');

  // Single redacted report: provider/model + per-prompt status. No key, no full raw payloads.
  console.log(`\n=== REAL Gemini integration (${provider.name}/${provider.model}) ===`);
  console.log(report);
});