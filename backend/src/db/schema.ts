import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name'),
    websiteUrl: text('website_url').notNull(),
    domain: text('domain').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('projects_user_website_url_idx').on(table.userId, table.websiteUrl)],
);

export const crawlRuns = pgTable(
  'crawl_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('PENDING'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    pagesDiscovered: integer('pages_discovered').notNull().default(0),
    pagesCrawled: integer('pages_crawled').notNull().default(0),
    robotsFound: boolean('robots_found'),
    sitemapFound: boolean('sitemap_found'),
    healthScore: integer('health_score'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('crawl_runs_project_id_idx').on(table.projectId)],
);

export const crawledPages = pgTable(
  'crawled_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    crawlRunId: uuid('crawl_run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    statusCode: integer('status_code'),
    contentType: text('content_type'),
    title: text('title'),
    metaDescription: text('meta_description'),
    canonicalUrl: text('canonical_url'),
    robotsDirective: text('robots_directive'),
    isIndexable: boolean('is_indexable'),
    wordCount: integer('word_count'),
    responseTimeMs: integer('response_time_ms'),
    internalLinks: text('internal_links').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('crawled_pages_crawl_run_id_idx').on(table.crawlRunId),
    uniqueIndex('crawled_pages_run_url_idx').on(table.crawlRunId, table.url),
  ],
);

export const seoIssues = pgTable(
  'seo_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    crawlRunId: uuid('crawl_run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').references(() => crawledPages.id, { onDelete: 'set null' }),
    issueType: text('issue_type').notNull(),
    severity: text('severity').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('seo_issues_crawl_run_id_idx').on(table.crawlRunId)],
);

export const searchOpportunities = pgTable(
  'search_opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    crawlRunId: uuid('crawl_run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    opportunityType: text('opportunity_type').notNull(),
    score: integer('score').notNull(),
    priority: text('priority').notNull(),
    relevance: integer('relevance').notNull(),
    impact: integer('impact').notNull(),
    confidence: integer('confidence').notNull(),
    reason: text('reason').notNull(),
    suggestedAction: text('suggested_action').notNull(),
    relatedPageId: uuid('related_page_id').references(() => crawledPages.id, { onDelete: 'set null' }),
    relatedPageUrl: text('related_page_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('search_opportunities_crawl_run_id_idx').on(table.crawlRunId)],
);

export const redditDiscussions = pgTable(
  'reddit_discussions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    crawlRunId: uuid('crawl_run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    subreddit: text('subreddit').notNull(),
    postTitle: text('post_title').notNull(),
    postUrl: text('post_url').notNull(),
    permalink: text('permalink').notNull(),
    author: text('author'),
    score: integer('score').notNull().default(0),
    numComments: integer('num_comments').notNull().default(0),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    bodySnippet: text('body_snippet'),
    topic: text('topic').notNull(),
    relevance: integer('relevance').notNull(),
    impact: integer('impact').notNull(),
    confidence: integer('confidence').notNull(),
    opportunityScore: integer('opportunity_score').notNull(),
    priority: text('priority').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('reddit_discussions_crawl_run_id_idx').on(table.crawlRunId)],
);

export const aiVisibilityResults = pgTable(
  'ai_visibility_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    crawlRunId: uuid('crawl_run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    rawResponse: text('raw_response').notNull(),
    mentioned: boolean('mentioned').notNull(),
    cited: boolean('cited').notNull(),
    stance: text('stance').notNull(),
    visibilityScore: integer('visibility_score').notNull(),
    reason: text('reason').notNull(),
    competitors: text('competitors').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ai_visibility_results_crawl_run_id_idx').on(table.crawlRunId)],
);

export const contentRecommendations = pgTable(
  'content_recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    crawlRunId: uuid('crawl_run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    title: text('title').notNull(),
    intent: text('intent').notNull(),
    priority: text('priority').notNull(),
    rationale: text('rationale').notNull(),
    structure: text('structure').notNull(),
    sourceType: text('source_type').notNull(),
    provider: text('provider'),
    model: text('model'),
    aiEnhanced: boolean('ai_enhanced').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('content_recommendations_crawl_run_id_idx').on(table.crawlRunId)],
);