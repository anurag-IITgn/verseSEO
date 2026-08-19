import { eq } from 'drizzle-orm';
import type { AnalyzablePage } from '../analysis/types.js';
import { getAiProvider } from '../ai/registry.js';
import { AiUnavailableError } from '../ai/errors.js';
import { planContentSeeds, MAX_RECOMMENDATIONS } from '../content/planner.js';
import { buildContentBriefPrompt } from '../content/prompts.js';
import { parseGeneratedBrief } from '../content/parsing.js';
import { fallbackStructure } from '../content/structure.js';
import type { ContentSeed } from '../content/types.js';
import { db } from '../db/client.js';
import { contentRecommendations } from '../db/schema.js';
import { findPagesByCrawl, type CrawledPageRow } from '../repositories/pageRepo.js';
import { findProjectById } from '../repositories/projectRepo.js';
import { findIssuesByCrawl } from '../repositories/seoRepo.js';
import { findOpportunitiesByCrawl } from '../repositories/searchRepo.js';
import { findAiVisibilityResultsByCrawl } from '../repositories/aiVisibilityRepo.js';
import {
  findRecommendationsByCrawl,
  insertContentRecommendations,
  type ContentRecommendationRow,
} from '../repositories/contentRepo.js';
import { extractTopics } from '../search/extract.js';
import { AppError } from '../utils/errors.js';
import { requireCrawlOwned } from './ownership.js';

export interface ContentRecommendationView {
  topic: string;
  title: string;
  intent: string;
  priority: string;
  rationale: string;
  structure: string[];
  sourceType: string;
  aiEnhanced: boolean;
}

export interface ContentRecommendationsResponse {
  crawlId: string;
  status: 'ok' | 'unavailable';
  reason: string | null;
  message: string | null;
  provider: string | null;
  model: string | null;
  topicsAnalyzed: number;
  total: number;
  recommendations: ContentRecommendationView[];
}

function toAnalyzablePage(page: CrawledPageRow): AnalyzablePage {
  return {
    id: page.id,
    url: page.url,
    statusCode: page.statusCode,
    contentType: page.contentType,
    title: page.title,
    metaDescription: page.metaDescription,
    canonicalUrl: page.canonicalUrl,
    robotsDirective: page.robotsDirective,
    isIndexable: page.isIndexable,
    wordCount: page.wordCount,
    responseTimeMs: page.responseTimeMs,
    internalLinks: page.internalLinks ?? [],
  };
}

function toView(row: ContentRecommendationRow): ContentRecommendationView {
  return {
    topic: row.topic,
    title: row.title,
    intent: row.intent,
    priority: row.priority,
    rationale: row.rationale,
    structure: row.structure.length > 0 ? row.structure.split('\n') : [],
    sourceType: row.sourceType,
    aiEnhanced: row.aiEnhanced,
  };
}

function unavailable(crawlId: string, reason: string, message: string, provider: string | null, model: string | null, topicsAnalyzed: number): ContentRecommendationsResponse {
  return {
    crawlId,
    status: 'unavailable',
    reason,
    message,
    provider,
    model,
    topicsAnalyzed,
    total: 0,
    recommendations: [],
  };
}

function briefFromSeed(seed: ContentSeed, generated: { title: string; intent: string; structure: string[] } | null, domain: string): { title: string; intent: string; structure: string[]; aiEnhanced: boolean } {
  if (generated) {
    return { title: generated.title, intent: generated.intent, structure: generated.structure, aiEnhanced: true };
  }
  return { title: seed.topic, intent: seed.intent, structure: fallbackStructure(seed.intent, seed.topic), aiEnhanced: false };
}

/**
 * Content Generator for a completed crawl. Deterministic content seeds are
 * derived from the site's real topics, SEO issues, Search Opportunities and
 * AI Visibility gaps; the configured AI provider (Gemini) writes a content
 * brief per seed. Briefs are grounded only in real data, never fabricated
 * metrics. When the provider is unavailable, an honest unavailable state is
 * returned — never fake generated content.
 */
export async function getContentRecommendations(userId: string, crawlId: string): Promise<ContentRecommendationsResponse> {
  const { crawl } = await requireCrawlOwned(userId, crawlId);
  if (crawl.status !== 'COMPLETED') {
    throw new AppError(409, 'Crawl run is not completed', 'CRAWL_NOT_COMPLETED');
  }

  const project = await findProjectById(crawl.projectId);
  const domain = project?.domain ?? '';

  const pages = await findPagesByCrawl(crawlId);
  const analyzablePages = pages.map(toAnalyzablePage);
  const topicsAnalyzed = extractTopics(analyzablePages).topics.size;

  const stored = await findRecommendationsByCrawl(crawlId);
  if (stored.length > 0) {
    return buildResponse(crawlId, stored[0].provider ?? null, stored[0].model ?? null, stored, topicsAnalyzed);
  }

  const seeds = planContentSeeds({
    pages: analyzablePages,
    opportunities: await findOpportunitiesByCrawl(crawlId),
    issues: await findIssuesByCrawl(crawlId),
    aiResults: await findAiVisibilityResultsByCrawl(crawlId),
  });
  if (seeds.length === 0) {
    return buildResponse(crawlId, null, null, [], topicsAnalyzed);
  }

  const provider = getAiProvider();
  if (!provider) {
    return unavailable(
      crawlId,
      'NOT_CONFIGURED',
      'Content generation is not connected. Add GEMINI_API_KEY (official Google Gemini API) to enable it.',
      null,
      null,
      topicsAnalyzed,
    );
  }

  const rows: (typeof contentRecommendations.$inferInsert)[] = [];
  try {
    for (const seed of seeds) {
      const raw = await provider.generate(buildContentBriefPrompt(seed, domain));
      const generated = parseGeneratedBrief(raw);
      const brief = briefFromSeed(seed, generated, domain);
      rows.push({
        crawlRunId: crawlId,
        topic: seed.topic,
        title: brief.title,
        intent: brief.intent,
        priority: seed.priority,
        rationale: seed.rationale,
        structure: brief.structure.join('\n'),
        sourceType: seed.sourceType,
        provider: provider.name,
        model: provider.model,
        aiEnhanced: brief.aiEnhanced,
      });
    }
  } catch (error) {
    const message = error instanceof AiUnavailableError ? error.message : 'Content generation is temporarily unavailable.';
    return unavailable(crawlId, 'PROVIDER_ERROR', message, provider.name, provider.model, topicsAnalyzed);
  }

  if (rows.length > 0) {
    await db.transaction(async (tx) => {
      await tx.delete(contentRecommendations).where(eq(contentRecommendations.crawlRunId, crawlId));
      await tx.insert(contentRecommendations).values(rows);
    });
  }

  const storedRows = await findRecommendationsByCrawl(crawlId);
  return buildResponse(crawlId, provider.name, provider.model, storedRows, topicsAnalyzed);
}

function buildResponse(
  crawlId: string,
  providerName: string | null,
  providerModel: string | null,
  rows: ContentRecommendationRow[],
  topicsAnalyzed: number,
): ContentRecommendationsResponse {
  return {
    crawlId,
    status: 'ok',
    reason: null,
    message: null,
    provider: providerName,
    model: providerModel,
    topicsAnalyzed,
    total: rows.length,
    recommendations: rows.map(toView),
  };
}