import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBriefEnhancement, buildOpportunityBrief } from '../src/content/brief.js';
import { parseOpportunityBriefEnhancement } from '../src/content/parsing.js';
import { buildContentDraftPrompt, buildOpportunityBriefPrompt } from '../src/content/prompts.js';
import type { SearchOpportunityRow } from '../src/repositories/searchRepo.js';

function makeOpportunity(overrides: Partial<SearchOpportunityRow> = {}): SearchOpportunityRow {
  return {
    id: 'op-1',
    crawlRunId: 'crawl-1',
    query: 'resume builder for students',
    opportunityType: 'CONTENT_GAP',
    intent: 'informational',
    coverage: 'GAP',
    evidence: {
      sourcePages: [{ url: 'https://example.com/templates', id: 'page-1' }],
      sourcePhrases: ['build a resume in minutes', 'choose a resume template'],
    },
    score: 80,
    priority: 'high',
    relevance: 32,
    impact: 24,
    confidence: 24,
    reason: 'Topic referenced but no page targets it directly.',
    suggestedAction: 'Publish a dedicated page.',
    relatedPageId: null,
    relatedPageUrl: null,
    createdAt: new Date(),
    ...overrides,
  };
}

test('buildOpportunityBrief is grounded only in the opportunity data', () => {
  const brief = buildOpportunityBrief(makeOpportunity());
  assert.equal(brief.targetTopic, 'resume builder for students');
  assert.equal(brief.searchIntent, 'informational');
  assert.equal(brief.coverage, 'GAP');
  assert.equal(brief.opportunity, 'Topic referenced but no page targets it directly.');
  assert.equal(brief.suggestedAction, 'Publish a dedicated page.');
  assert.deepEqual(brief.evidencePages, ['https://example.com/templates']);
  assert.deepEqual(brief.evidencePhrases, ['build a resume in minutes', 'choose a resume template']);
  assert.equal(brief.aiEnhanced, false);
  assert.ok(brief.suggestedTitle.length > 0);
  assert.ok(brief.structure.length >= 3);
  assert.ok(brief.keyPoints.length > 0);
  assert.equal(brief.angle.length > 0, true);
});

test('buildOpportunityBrief never fabricates unsupported metrics', () => {
  const brief = buildOpportunityBrief(makeOpportunity());
  const serialized = JSON.stringify(brief).toLowerCase();
  for (const metric of ['search volume', 'keyword difficulty', 'cpc', 'traffic', 'rankings']) {
    assert.ok(!serialized.includes(metric), `brief must not contain ${metric}`);
  }
});

test('buildOpportunityBrief derives the angle from the coverage state', () => {
  const gap = buildOpportunityBrief(makeOpportunity({ coverage: 'GAP' }));
  assert.match(gap.angle, /Publish new/);
  const improvement = buildOpportunityBrief(makeOpportunity({ coverage: 'IMPROVEMENT' }));
  assert.match(improvement.angle, /Improve and expand/);
});

test('applyBriefEnhancement overlays AI fields without touching grounded data', () => {
  const brief = buildOpportunityBrief(makeOpportunity());
  const enhanced = applyBriefEnhancement(brief, {
    angle: 'A practical, step-by-step angle for students.',
    title: 'Resume Builder for Students: A Step-by-Step Guide',
    structure: ['Intro', 'Templates', 'Examples', 'Summary'],
    keyPoints: ['Use a chronological layout', 'Quantify achievements'],
  });
  assert.equal(enhanced.aiEnhanced, true);
  assert.equal(enhanced.suggestedTitle, 'Resume Builder for Students: A Step-by-Step Guide');
  assert.deepEqual(enhanced.structure, ['Intro', 'Templates', 'Examples', 'Summary']);
  assert.equal(enhanced.angle, 'A practical, step-by-step angle for students.');
  assert.equal(enhanced.targetTopic, brief.targetTopic, 'grounded topic must never be overwritten');
  assert.equal(enhanced.searchIntent, brief.searchIntent);
  assert.deepEqual(enhanced.evidencePages, brief.evidencePages);
});

test('applyBriefEnhancement keeps deterministic fallbacks for missing AI fields', () => {
  const brief = buildOpportunityBrief(makeOpportunity());
  const enhanced = applyBriefEnhancement(brief, { angle: '', title: 'T', structure: [], keyPoints: [] });
  assert.equal(enhanced.suggestedTitle, 'T');
  assert.equal(enhanced.angle, brief.angle, 'empty angle must fall back');
  assert.deepEqual(enhanced.structure, brief.structure);
  assert.deepEqual(enhanced.keyPoints, brief.keyPoints);
});

test('parseOpportunityBriefEnhancement parses a labelled AI brief', () => {
  const parsed = parseOpportunityBriefEnhancement(
    [
      'ANGLE: Practical step-by-step coverage for students.',
      'TITLE: Resume Builder for Students: A Step-by-Step Guide',
      'STRUCTURE:',
      '- Introduction',
      '- Choosing a template',
      '- Summary',
      'KEY_POINTS:',
      '- Keep it one page',
      '- Use action verbs',
    ].join('\n'),
  );
  assert.ok(parsed);
  assert.equal(parsed?.title, 'Resume Builder for Students: A Step-by-Step Guide');
  assert.equal(parsed?.angle, 'Practical step-by-step coverage for students.');
  assert.deepEqual(parsed?.structure, ['Introduction', 'Choosing a template', 'Summary']);
  assert.deepEqual(parsed?.keyPoints, ['Keep it one page', 'Use action verbs']);
});

test('parseOpportunityBriefEnhancement is tolerant of missing or malformed output', () => {
  assert.equal(parseOpportunityBriefEnhancement(''), null);
  assert.equal(parseOpportunityBriefEnhancement('garbage without a title'), null);
  const partial = parseOpportunityBriefEnhancement('TITLE: Only a title');
  assert.equal(partial?.title, 'Only a title');
  assert.deepEqual(partial?.angle, '');
  assert.deepEqual(partial?.structure, []);
  assert.deepEqual(partial?.keyPoints, []);
});

test('buildOpportunityBriefPrompt grounds the model and forbids invented metrics', () => {
  const brief = buildOpportunityBrief(makeOpportunity());
  const prompt = buildOpportunityBriefPrompt(brief, 'example.com');
  assert.ok(prompt.includes('resume builder for students'));
  assert.ok(prompt.includes('example.com'));
  assert.ok(prompt.includes('Topic referenced but no page targets it directly.'));
  assert.ok(prompt.includes('https://example.com/templates'));
  assert.match(prompt, /Do not invent search volume/);
});

test('buildContentDraftPrompt follows the brief and forbids fabricated facts', () => {
  const brief = applyBriefEnhancement(buildOpportunityBrief(makeOpportunity()), {
    angle: 'Step-by-step guide',
    title: 'Resume Builder for Students',
    structure: ['Intro', 'Examples'],
    keyPoints: ['Quantify achievements'],
  });
  const prompt = buildContentDraftPrompt(brief, 'example.com');
  assert.ok(prompt.includes('Resume Builder for Students'));
  assert.ok(prompt.includes('resume builder for students'));
  assert.ok(prompt.includes('Step-by-step guide'));
  assert.match(prompt, /Do not invent statistics/);
  assert.match(prompt, /human review/);
  assert.match(prompt, /must not stuff keywords/);
});