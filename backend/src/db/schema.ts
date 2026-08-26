import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { GscEncryptedTokens, GscOpportunityMetrics, GscQueryRow } from '../gsc/types.js';
import type { OpportunityContentBrief } from '../content/types.js';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
    'subscriptions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        providerSubscriptionId: text('provider_subscription_id').notNull().unique(),
        plan: text('plan').notNull().default('pro'),
        status: text('status').notNull(),
        currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
        currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('subscriptions_user_id_idx').on(table.userId)],
);

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

export const tokens = pgTable(
  'tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    type: text('type').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tokens_user_id_idx').on(table.userId),
    index('tokens_token_hash_idx').on(table.tokenHash),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name'),
    websiteUrl: text('website_url').notNull(),
    domain: text('domain').notNull(),
    gscSiteId: uuid('gsc_site_id').references(() => gscSites.id, { onDelete: 'set null' }),
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
    h1Count: integer('h1_count').notNull().default(0),
    h2Count: integer('h2_count').notNull().default(0),
    h3Count: integer('h3_count').notNull().default(0),
    h4Count: integer('h4_count').notNull().default(0),
    h5Count: integer('h5_count').notNull().default(0),
    h6Count: integer('h6_count').notNull().default(0),
    imageCount: integer('image_count').notNull().default(0),
    imagesMissingAlt: integer('images_missing_alt').notNull().default(0),
    jsonLdTypes: text('json_ld_types').array(),
    ogTitle: text('og_title'),
    ogDescription: text('og_description'),
    ogImage: text('og_image'),
    twitterCard: text('twitter_card'),
    twitterTitle: text('twitter_title'),
    twitterDescription: text('twitter_description'),
    twitterImage: text('twitter_image'),
    serverHeader: text('server_header'),
    cdnHeader: text('cdn_header'),
    hasViewport: boolean('has_viewport').notNull().default(false),
    hasCharset: boolean('has_charset').notNull().default(false),
    hasFavicon: boolean('has_favicon').notNull().default(false),
    htmlLang: text('html_lang'),
    externalLinkCount: integer('external_link_count').notNull().default(0),
    cssFileCount: integer('css_file_count').notNull().default(0),
    jsFileCount: integer('js_file_count').notNull().default(0),
    iframeCount: integer('iframe_count').notNull().default(0),
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

export const gscConnections = pgTable(
  'gsc_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokens: jsonb('tokens').$type<GscEncryptedTokens>().notNull(),
    scope: text('scope'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('gsc_connections_user_id_idx').on(table.userId)],
);

export const gscSites = pgTable(
  'gsc_sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    siteUrl: text('site_url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('gsc_sites_user_site_url_idx').on(table.userId, table.siteUrl)],
);

export const gscQuerySnapshots = pgTable(
  'gsc_query_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    siteUrl: text('site_url').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    queries: jsonb('queries').$type<GscQueryRow[]>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('gsc_snapshots_user_site_url_idx').on(table.userId, table.siteUrl)],
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
    intent: text('intent').notNull().default('informational'),
    coverage: text('coverage').notNull().default('IMPROVEMENT'),
    evidence: jsonb('evidence'),
    score: integer('score').notNull(),
    priority: text('priority').notNull(),
    relevance: integer('relevance').notNull(),
    impact: integer('impact').notNull(),
    confidence: integer('confidence').notNull(),
    reason: text('reason').notNull(),
    suggestedAction: text('suggested_action').notNull(),
    relatedPageId: uuid('related_page_id').references(() => crawledPages.id, { onDelete: 'set null' }),
    relatedPageUrl: text('related_page_url'),
    gsc: jsonb('gsc').$type<GscOpportunityMetrics | null>(),
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
    comments: jsonb('comments'),
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

export const redditScanUsage = pgTable(
  'reddit_scan_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    crawlRunId: uuid('crawl_run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('reddit_scan_usage_user_idx').on(table.userId, table.scannedAt)],
);

export const contentGenerations = pgTable(
  'content_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    crawlRunId: uuid('crawl_run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .unique()
      .references(() => searchOpportunities.id, { onDelete: 'cascade' }),
    brief: jsonb('brief').$type<OpportunityContentBrief>().notNull(),
    title: text('title').notNull(),
    intent: text('intent').notNull(),
    draft: text('draft').notNull(),
    status: text('status').notNull().default('GENERATED'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('content_generations_opportunity_id_idx').on(table.opportunityId)],
);