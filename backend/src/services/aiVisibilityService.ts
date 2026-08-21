import { eq } from 'drizzle-orm';
import type { AnalyzablePage } from '../analysis/types.js';
import { AiUnavailableError } from '../ai/errors.js';
import { analyzeMention } from '../ai/mentionDetection.js';
import { selectAiPrompts } from '../ai/prompts.js';
import { getAiProvider } from '../ai/registry.js';
import { scoreVisibility } from '../ai/scoring.js';
import { db } from '../db/client.js';
import { aiVisibilityResults, users } from '../db/schema.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import { findProjectById } from '../repositories/projectRepo.js';
import {
  findAiVisibilityResultsByCrawl,
  insertAiVisibilityResults,
  type AiVisibilityRow,
} from '../repositories/aiVisibilityRepo.js';
import { extractTopics } from '../search/extract.js';
import { AppError } from '../utils/errors.js';
import { toAnalyzablePage } from '../utils/pageAdapter.js';
import { requireCrawlOwned } from './ownership.js';

export interface AiVisibilityResultView {
  topic: string;
  prompt: string;
  provider: string;
  model: string;
  mentioned: boolean;
  cited: boolean;
  stance: string;
  visibilityScore: number;
  reason: string;
  competitors: string[];
}

export interface AiVisibilityResponse {
  crawlId: string;
  plan: 'free' | 'pro';
  status: 'ok' | 'unavailable';
  reason: string | null;
  message: string | null;
  provider: string | null;
  model: string | null;
  topicsAnalyzed: number;
  promptsRun: number;
  overallVisibilityScore: number;
  displayScore: number;
  mentionedCount: number;
  citedCount: number;
  recommendationCount: number;
  results: AiVisibilityResultView[];
}

function extractTopicFromPrompt(prompt: string): string {
  const match = prompt.match(/"([^"]+)"\??\s*$/);
  return match ? match[1] : prompt;
}

function displayFromRaw(raw: number): number {
  return Math.min(75, Math.max(15, Math.round(raw / 5) * 5));
}

function toView(row: AiVisibilityRow): AiVisibilityResultView {
  return {
    topic: extractTopicFromPrompt(row.prompt),
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    mentioned: row.mentioned,
    cited: row.cited,
    stance: row.stance,
    visibilityScore: row.visibilityScore,
    reason: row.reason,
    competitors: row.competitors ?? [],
  };
}

function reasonFor(input: {
  mentioned: boolean;
  cited: boolean;
  stance: string;
  topic: string;
  domain: string;
  empty: boolean;
}): string {
  if (input.empty) return `The model returned an empty response for "${input.topic}".`;
  if (!input.mentioned) return `"${input.domain}" was not mentioned in the answer to "${input.topic}".`;
  if (input.cited) return `"${input.domain}" was mentioned and linked in the answer to "${input.topic}".`;
  return `"${input.domain}" appeared in the answer to "${input.topic}" (${input.stance}).`;
}

/**
 * AI Engine Footprint for a completed crawl: derives topical questions from
 * the site's real crawled content, asks the configured AI provider (Gemini by
 * default) and inspects the ACTUAL answers for mentions, citations and
 * competitors. Results are persisted per crawl so repeated calls are
 * idempotent. When no provider is configured or the provider fails, an honest
 * unavailable state is returned — never fabricated answers.
 */
export async function getAiVisibility(userId: string, crawlId: string): Promise<AiVisibilityResponse> {
  const { crawl } = await requireCrawlOwned(userId, crawlId);
  if (crawl.status !== 'COMPLETED') {
    throw new AppError(409, 'Crawl run is not completed', 'CRAWL_NOT_COMPLETED');
  }

  const [userRow] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
  const plan: 'free' | 'pro' = (userRow?.plan as 'free' | 'pro') ?? 'free';

  const project = await findProjectById(crawl.projectId);
  const domain = project?.domain ?? '';

  const pages = await findPagesByCrawl(crawlId);
  const analyzablePages = pages.map(toAnalyzablePage);
  const topicsAnalyzed = extractTopics(analyzablePages).topics.size;

  const stored = await findAiVisibilityResultsByCrawl(crawlId);
  if (stored.length > 0) {
    return buildResponse(crawlId, plan, stored[0].provider, stored[0].model, stored, topicsAnalyzed);
  }

  const provider = getAiProvider();
  if (!provider) {
    return {
      crawlId,
      plan,
      status: 'unavailable',
      reason: 'NOT_CONFIGURED',
      message: 'AI visibility is not connected. Add GEMINI_API_KEY (official Google Gemini API) to enable it.',
      provider: null,
      model: null,
      topicsAnalyzed,
      promptsRun: 0,
      overallVisibilityScore: 0,
      displayScore: 15,
      mentionedCount: 0,
      citedCount: 0,
      recommendationCount: 0,
      results: [],
    };
  }

  const prompts = selectAiPrompts(analyzablePages);
  if (prompts.length === 0) {
    return {
      crawlId,
      plan,
      status: 'ok',
      reason: null,
      message: null,
      provider: provider.name,
      model: provider.model,
      topicsAnalyzed,
      promptsRun: 0,
      overallVisibilityScore: 0,
      displayScore: 15,
      mentionedCount: 0,
      citedCount: 0,
      recommendationCount: 0,
      results: [],
    };
  }

  const rows: (typeof aiVisibilityResults.$inferInsert)[] = [];
  try {
    for (const entry of prompts) {
      const raw = await provider.generate(entry.prompt);
      const empty = raw.trim() === '';
      const analysis = empty ? { mentioned: false, cited: false, stance: 'absent' as const, competitors: [] } : analyzeMention(raw, domain);
      const scored = scoreVisibility(analysis);
      rows.push({
        crawlRunId: crawlId,
        prompt: entry.prompt,
        provider: provider.name,
        model: provider.model,
        rawResponse: empty ? '' : raw,
        mentioned: scored.mentioned,
        cited: scored.cited,
        stance: scored.stance,
        visibilityScore: scored.visibilityScore,
        reason: reasonFor({
          mentioned: scored.mentioned,
          cited: scored.cited,
          stance: scored.stance,
          topic: entry.topic,
          domain,
          empty,
        }),
        competitors: analysis.competitors,
      });
    }
  } catch (error) {
    const message = error instanceof AiUnavailableError ? error.message : 'AI visibility is temporarily unavailable.';
    return {
      crawlId,
      plan,
      status: 'unavailable',
      reason: 'PROVIDER_ERROR',
      message,
      provider: provider.name,
      model: provider.model,
      topicsAnalyzed,
      promptsRun: 0,
      overallVisibilityScore: 0,
      displayScore: 15,
      mentionedCount: 0,
      citedCount: 0,
      recommendationCount: 0,
      results: [],
    };
  }

  if (rows.length > 0) {
    await db.transaction(async (tx) => {
      await tx.delete(aiVisibilityResults).where(eq(aiVisibilityResults.crawlRunId, crawlId));
      await tx.insert(aiVisibilityResults).values(rows);
    });
  }

  const storedResults = await findAiVisibilityResultsByCrawl(crawlId);
  return buildResponse(crawlId, plan, provider.name, provider.model, storedResults, topicsAnalyzed);
}

function buildResponse(
  crawlId: string,
  plan: 'free' | 'pro',
  providerName: string | null,
  providerModel: string | null,
  rows: AiVisibilityRow[],
  topicsAnalyzed: number,
): AiVisibilityResponse {
  const results = rows.map(toView);
  const mentionedCount = results.filter((r) => r.mentioned).length;
  const citedCount = results.filter((r) => r.cited).length;
  const recommendationCount = results.filter((r) => r.stance === 'recommendation').length;
  const overallVisibilityScore =
    results.length === 0
      ? 0
      : Math.round(results.reduce((sum, r) => sum + r.visibilityScore, 0) / results.length);

  return {
    crawlId,
    plan,
    status: 'ok',
    reason: null,
    message: null,
    provider: providerName,
    model: providerModel,
    topicsAnalyzed,
    promptsRun: results.length,
    overallVisibilityScore,
    displayScore: displayFromRaw(overallVisibilityScore),
    mentionedCount,
    citedCount,
    recommendationCount,
    results,
  };
}