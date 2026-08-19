import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalyzablePage } from '../src/analysis/types.js';
import { analyzeMention } from '../src/ai/mentionDetection.js';
import { parseGeminiResponse } from '../src/ai/parsing.js';
import { buildAiPrompt, selectAiPrompts } from '../src/ai/prompts.js';
import { scoreVisibility } from '../src/ai/scoring.js';

function makePage(overrides: Partial<AnalyzablePage> = {}): AnalyzablePage {
  return {
    id: 'page-1',
    url: 'https://example.com/',
    statusCode: 200,
    contentType: 'text/html; charset=utf-8',
    title: 'Example Home Page Title',
    metaDescription: 'A descriptive meta description for the example homepage',
    canonicalUrl: null,
    robotsDirective: null,
    isIndexable: true,
    wordCount: 500,
    responseTimeMs: 100,
    internalLinks: [],
    ...overrides,
  };
}

test('selectAiPrompts derives topical prompts from real crawled content', () => {
  const prompts = selectAiPrompts([makePage()]);
  assert.ok(prompts.length >= 1, 'a single real page must still produce prompts');
  assert.ok(prompts.length <= 5, 'prompt count must be bounded');
  const topics = prompts.map((p) => p.topic);
  assert.ok(topics.some((t) => t.toLowerCase().includes('title')), 'prompts must come from the page title/meta');
  assert.ok(prompts.every((p) => p.topic.trim().length > 0), 'topics must not be empty');
  assert.ok(prompts.every((p) => p.prompt.includes(p.topic)), 'each prompt must ask about its topic');
});

test('selectAiPrompts is deterministic and never contains a website domain', () => {
  const first = selectAiPrompts([makePage()]);
  const second = selectAiPrompts([makePage()]);
  assert.deepEqual(first.map((p) => p.topic), second.map((p) => p.topic), 'selection must be deterministic');
  for (const p of first) {
    assert.ok(!/example\.com/i.test(p.prompt), 'prompts must not leak or hard-code the site domain');
  }
});

test('buildAiPrompt asks a neutral topical question without biasing the answer', () => {
  const prompt = buildAiPrompt('tip calculator');
  assert.ok(prompt.includes('tip calculator'));
  assert.ok(prompt.includes('Question:'));
  assert.ok(!prompt.includes('recommend this'), 'prompt must not instruct the model to recommend the site');
});

test('parseGeminiResponse extracts the model text from a valid payload', () => {
  const text = parseGeminiResponse({
    candidates: [{ content: { parts: [{ text: '  Tip Calculator is the best tool.  ' }, { text: ' Second part.' }] } }],
  });
  assert.equal(text, 'Tip Calculator is the best tool. Second part.');
});

test('parseGeminiResponse tolerates empty, missing and malformed payloads', () => {
  assert.equal(parseGeminiResponse(null), '');
  assert.equal(parseGeminiResponse('garbage'), '');
  assert.equal(parseGeminiResponse({}), '');
  assert.equal(parseGeminiResponse({ candidates: [] }), '');
  assert.equal(parseGeminiResponse({ candidates: [{ content: { parts: [] } }] }), '');
  assert.equal(parseGeminiResponse({ candidates: [{ content: {} }] }), '');
});

test('analyzeMention detects a citation from a URL to the domain', () => {
  const result = analyzeMention('Try the calculator at http://example.com/tip-calculator', 'example.com');
  assert.equal(result.mentioned, true);
  assert.equal(result.cited, true);
  assert.equal(result.stance, 'neutral');
});

test('analyzeMention detects a bare mention without a citation', () => {
  const result = analyzeMention('Some people build their own tools, but example is worth a look.', 'example.com');
  assert.equal(result.mentioned, true);
  assert.equal(result.cited, false);
});

test('analyzeMention detects the brand without the TLD', () => {
  const result = analyzeMention('Everyone keeps mentioning tipcalculator these days.', 'tipcalculator.com');
  assert.equal(result.mentioned, true);
  assert.equal(result.cited, false);
});

test('analyzeMention classifies recommendation, neutral, negative and absent stances', () => {
  const rec = analyzeMention('I recommend example.com for beginners.', 'example.com');
  assert.equal(rec.stance, 'recommendation');

  const neu = analyzeMention('example.com exists as an option.', 'example.com');
  assert.equal(neu.stance, 'neutral');

  const neg = analyzeMention('I do not recommend example.com; it is unreliable.', 'example.com');
  assert.equal(neg.stance, 'negative');

  const absent = analyzeMention('Use calculator.net for all your math needs.', 'example.com');
  assert.equal(absent.mentioned, false);
  assert.equal(absent.cited, false);
  assert.equal(absent.stance, 'absent');
});

test('analyzeMention extracts identifiable competitors and never includes the domain itself', () => {
  const result = analyzeMention(
    'I like calculator.net and www.tipcalcx.com. example.com also has a tool.',
    'example.com',
  );
  assert.ok(result.competitors.includes('calculator.net'));
  assert.ok(result.competitors.includes('tipcalcx.com'));
  assert.ok(!result.competitors.includes('example.com'));
  assert.ok(result.competitors.length <= 6, 'competitor list must be bounded');
});

test('analyzeMention handles an IP-address domain', () => {
  const result = analyzeMention('Try the tool hosted at 127.0.0.1:8080 for splits', '127.0.0.1');
  assert.equal(result.mentioned, true);
  assert.equal(result.cited, true);
});

test('scoreVisibility follows the documented formula', () => {
  assert.equal(scoreVisibility({ mentioned: true, cited: true, stance: 'recommendation' }).visibilityScore, 100);
  assert.equal(scoreVisibility({ mentioned: true, cited: true, stance: 'neutral' }).visibilityScore, 80);
  assert.equal(scoreVisibility({ mentioned: true, cited: false, stance: 'recommendation' }).visibilityScore, 60);
  assert.equal(scoreVisibility({ mentioned: true, cited: false, stance: 'neutral' }).visibilityScore, 40);
  assert.equal(scoreVisibility({ mentioned: true, cited: false, stance: 'negative' }).visibilityScore, 20);
  assert.equal(scoreVisibility({ mentioned: false, cited: false, stance: 'absent' }).visibilityScore, 0);
});

test('scoreVisibility clamps within 0-100', () => {
  assert.equal(scoreVisibility({ mentioned: true, cited: false, stance: 'negative' }).visibilityScore, 20);
  assert.equal(scoreVisibility({ mentioned: false, cited: false, stance: 'absent' }).visibilityScore, 0);
});