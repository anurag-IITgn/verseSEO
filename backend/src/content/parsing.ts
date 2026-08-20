import type { GeneratedBrief, GeneratedBriefEnhancement } from './types.js';

const TITLE_PATTERN = /^TITLE:\s*(.+)$/im;
const INTENT_PATTERN = /^INTENT:\s*(.+)$/im;
const STRUCTURE_PATTERN = /^STRUCTURE:\s*([\s\S]+)$/im;
const OPPORTUNITY_LABELS = '(?:ANGLE|TITLE|STRUCTURE|KEY_POINTS)';

function parseBullets(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((line) => line.length > 0);
}

/** Content of a labelled single-line section (e.g. TITLE / ANGLE). */
function singleLineSection(text: string, label: string): string {
  const match = text.match(new RegExp(`^${label}:\\s*(.*)$`, 'im'));
  return match?.[1]?.trim() ?? '';
}

/**
 * Content of a labelled multi-line section (e.g. STRUCTURE / KEY_POINTS),
 * stopping at the next labelled section so later blocks are never captured.
 */
function multiLineSection(text: string, label: string): string {
  const startMatch = text.match(new RegExp(`^${label}:\\s*`, 'im'));
  if (!startMatch || startMatch.index === undefined) return '';
  const contentStart = startMatch.index + startMatch[0].length;
  const rest = text.slice(contentStart);
  const nextLabel = rest.search(new RegExp(`^\\s*${OPPORTUNITY_LABELS}:\\s*`, 'im'));
  const end = nextLabel === -1 ? rest.length : nextLabel;
  return rest.slice(0, end).trim();
}

/**
 * Parse a labeled AI content brief (TITLE / INTENT / STRUCTURE) into a
 * structured brief. Tolerant of a missing intent or structure block; returns
 * null when no usable title is present so the caller can fall back to a
 * deterministic brief.
 */
export function parseGeneratedBrief(text: string): GeneratedBrief | null {
  const titleMatch = text.match(TITLE_PATTERN);
  const title = titleMatch?.[1]?.trim();
  if (!title || title.length === 0) return null;

  const intentMatch = text.match(INTENT_PATTERN);
  const intent = intentMatch?.[1]?.trim() || '';

  const structureBlock = text.match(STRUCTURE_PATTERN)?.[1]?.trim() ?? '';
  const structure = parseBullets(structureBlock).slice(0, 6);

  return { title, intent: intent || 'informational', structure: structure.length > 0 ? structure : [] };
}

/**
 * Parse a labeled AI opportunity-brief enhancement (ANGLE / TITLE / STRUCTURE /
 * KEY_POINTS). Returns null when no usable title is present so the caller can
 * keep the deterministic brief.
 */
export function parseOpportunityBriefEnhancement(text: string): GeneratedBriefEnhancement | null {
  const title = singleLineSection(text, 'TITLE');
  if (!title || title.length === 0) return null;

  return {
    angle: singleLineSection(text, 'ANGLE'),
    title,
    structure: parseBullets(multiLineSection(text, 'STRUCTURE')).slice(0, 6),
    keyPoints: parseBullets(multiLineSection(text, 'KEY_POINTS')).slice(0, 4),
  };
}