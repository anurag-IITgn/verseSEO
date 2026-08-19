import type { GeneratedBrief } from './types.js';

const TITLE_PATTERN = /^TITLE:\s*(.+)$/im;
const INTENT_PATTERN = /^INTENT:\s*(.+)$/im;
const STRUCTURE_PATTERN = /^STRUCTURE:\s*([\s\S]+)$/im;

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
  const structure = structureBlock
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 6);

  return { title, intent: intent || 'informational', structure: structure.length > 0 ? structure : [] };
}