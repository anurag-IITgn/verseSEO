import { getAiProvider } from '../ai/registry.js';
import { AiUnavailableError } from '../ai/errors.js';
import { applyBriefEnhancement, buildOpportunityBrief } from '../content/brief.js';
import { parseOpportunityBriefEnhancement } from '../content/parsing.js';
import { buildContentDraftPrompt, buildOpportunityBriefPrompt } from '../content/prompts.js';
import type { OpportunityContentBrief } from '../content/types.js';
import { findGenerationByOpportunity, upsertContentGeneration, type ContentGenerationRow } from '../repositories/contentRepo.js';
import { AppError } from '../utils/errors.js';
import { requireOpportunityOwned } from './ownership.js';

export interface ContentGenerationView {
  opportunityId: string;
  crawlId: string;
  title: string;
  intent: string;
  brief: OpportunityContentBrief;
  draft: string;
  provider: string;
  model: string;
  status: 'GENERATED';
  createdAt: string;
  updatedAt: string;
}

function toView(row: ContentGenerationRow): ContentGenerationView {
  return {
    opportunityId: row.opportunityId,
    crawlId: row.crawlRunId,
    title: row.title,
    intent: row.intent,
    brief: row.brief,
    draft: row.draft,
    provider: row.provider,
    model: row.model,
    status: row.status as 'GENERATED',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function providerErrorCode(error: unknown): AppError {
  const message = error instanceof AiUnavailableError ? error.message : 'Content generation is temporarily unavailable.';
  return new AppError(502, message, 'CONTENT_GENERATION_FAILED');
}

/**
 * Generates content for one selected Search Opportunity: a structured brief
 * grounded in the opportunity's real data (Module 2), then a full article
 * draft that follows the brief, then persistence. The Search Opportunity row
 * is never modified. On any AI failure an error is returned and nothing is
 * persisted — no fake or partial result is ever saved.
 */
export async function generateContentForOpportunity(userId: string, opportunityId: string): Promise<ContentGenerationView> {
  const { opportunity, crawl, project } = await requireOpportunityOwned(userId, opportunityId);
  const domain = project.domain;

  let brief = buildOpportunityBrief(opportunity);
  const provider = getAiProvider();
  if (!provider) {
    throw new AppError(503, 'Content generation is not connected. Add GEMINI_API_KEY (official Google Gemini API) to enable it.', 'CONTENT_NOT_CONFIGURED');
  }

  try {
    const rawBrief = await provider.generate(buildOpportunityBriefPrompt(brief, domain));
    const enhancement = parseOpportunityBriefEnhancement(rawBrief);
    if (enhancement) {
      brief = applyBriefEnhancement(brief, enhancement);
    }
  } catch (error) {
    throw providerErrorCode(error);
  }

  let draft: string;
  try {
    draft = await provider.generate(buildContentDraftPrompt(brief, domain));
  } catch (error) {
    throw providerErrorCode(error);
  }
  if (!draft || draft.trim().length === 0) {
    throw new AppError(502, 'The AI provider returned an empty draft.', 'CONTENT_GENERATION_FAILED');
  }

  const row = await upsertContentGeneration({
    crawlRunId: crawl.id,
    opportunityId: opportunity.id,
    brief,
    title: brief.suggestedTitle,
    intent: brief.searchIntent,
    draft,
    status: 'GENERATED',
    provider: provider.name,
    model: provider.model,
  });

  return toView(row);
}

/**
 * Retrieves a previously generated content brief + draft for an opportunity.
 * Returns an error when nothing has been generated yet; the opportunity itself
 * is untouched either way.
 */
export async function getContentForOpportunity(userId: string, opportunityId: string): Promise<ContentGenerationView> {
  await requireOpportunityOwned(userId, opportunityId);
  const row = await findGenerationByOpportunity(opportunityId);
  if (!row) {
    throw new AppError(404, 'No content has been generated for this opportunity yet.', 'CONTENT_NOT_GENERATED');
  }
  return toView(row);
}