# Reddit Intelligence Module — Full Audit

**Date:** 2026-08-21
**Purpose:** Audit existing Reddit Intelligence implementation before integrating Brave Search API

---

## A. Current Reddit Architecture

**Directory structure:**
```
backend/src/reddit/
├── providers/
│   ├── apifyProvider.ts      ← Apify integration (primary)
│   ├── oauthProvider.ts      ← Reddit OAuth fallback
│   └── index.ts              ← Provider registry (Apify > OAuth > null)
├── types.ts                  ← RedditPost, RedditComment, RedditProvider
├── queries.ts                ← NLP-based query selection from crawled pages
├── scoring.ts                ← 3-axis scoring (relevance 0-40, impact 0-30, confidence 0-30)
├── errors.ts                 ← RedditUnavailableError
└── mapping.ts                ← Defensive parsing of Apify/Reddit responses

backend/src/repositories/redditRepo.ts   ← Drizzle queries
backend/src/services/redditService.ts    ← Main service (discovery, caching, persistence)
backend/src/routes/reddit.ts             ← GET /api/crawls/:crawlId/reddit-opportunities
backend/src/controllers/redditController.ts
```

**Database:** `reddit_discussions` table with 21 columns (subreddit, postTitle, postUrl, permalink, author, score, numComments, postedAt, bodySnippet, comments JSONB, topic, relevance, impact, confidence, opportunityScore, priority, reason).

---

## B. Existing Apify Flow

1. `getRedditOpportunities()` checks if discussions already exist in DB (idempotent)
2. `selectRedditQueries()` generates search queries from crawled page content using NLP
3. For each query, `provider.search(query, { limit: 5 })` calls Apify actor `dejMd0QoBemGH3zTn`
4. Apify starts a run → polls every 3s until done → fetches dataset items
5. Each result is scored via `scoreDiscussion()` (3-axis: relevance, impact, confidence)
6. Deduplicates by permalink, sorts by score, takes top 12
7. Persists to `reddit_discussions` table
8. Returns `RedditOpportunitiesResponse`

**Env vars:** `APIFY_API_TOKEN` (primary), `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (fallback)

---

## C. Data Currently Expected by Frontend

**Dashboard card (`renderRedditResult`):**
- `discussions[]` — array of scored discussions
- Per discussion: `subreddit`, `postTitle`, `opportunityScore`, `priority`
- Status badge: count + high-priority count

**API response shape:**
```ts
{
  crawlId: string;
  status: 'ok' | 'unavailable' | 'pending';
  reason: string | null;
  message: string | null;
  total: number;
  topicsAnalyzed: number;
  discussions: [{
    id, crawlRunId, subreddit, postTitle, postUrl, permalink,
    author, score, numComments, postedAt, bodySnippet, comments,
    topic, relevance, impact, confidence, opportunityScore, priority, reason
  }]
}
```

---

## D. What Brave Can Provide

**Brave Web Search API** (`/res/v1/web/search`):
- `result_filter=discussions` returns forum discussion clusters
- Per discussion: `forum_name`, `num_answers`, `question`, `top_comment`
- But: no Reddit post score, no author, no comment count, no body snippet, no comments array
- This is **clustered/summarized** data, not raw Reddit API data

**Brave LLM Context API** (`/res/v1/llm/context`):
- Specifically designed for extracting forum discussions (e.g., from Reddit)
- Returns `grounding.generic[]` with `url`, `title`, `snippets[]`
- Snippets contain actual extracted text chunks from Reddit threads
- `sources[url]` has `title`, `hostname`, `age`
- Token budget control, relevance filtering, goggles support
- **Same price as web search** ($5/1K requests)

**What Brave CANNOT provide:**
- Reddit post score (upvotes)
- Reddit comment count
- Individual comment data (author, body, score)
- Reddit author usernames
- Exact posting timestamps
- Direct Reddit API access

---

## E. What Information We Would Still Need to Extract

From the Brave responses, we'd need to parse:

1. **Post identification** — extract Reddit URL from `grounding.generic[].url` or `discussions.results[].data`
2. **Subreddit** — extract from URL pattern (`/r/{subreddit}/comments/...`)
3. **Post title** — from `discussions.results[].data.question` or LLM Context title
4. **Post content** — from `snippets[]` (LLM Context) or `top_comment` (Web Search discussions)
5. **Comment excerpts** — from `snippets[]` (LLM Context) — multiple snippets per URL could contain multiple comments
6. **Scoring** — would need to compute our own relevance/impact/confidence scores (existing `scoreDiscussion` logic can be adapted)

**What we'd lose vs. Apify:**
- Exact Reddit scores (upvotes/downvotes)
- Exact comment counts
- Individual comment author names
- Structured comment arrays with per-comment scores

---

## F. Can Brave Replace Apify?

**Yes, with caveats.**

Brave LLM Context is purpose-built for exactly this use case — extracting forum discussions for AI consumption. It provides:

- Actual Reddit thread content (not just metadata)
- Multiple discussion snippets per query
- Relevance-scored, pre-extracted content
- Same price point ($5/1K)
- No polling required (single request, ~600ms)

**The tradeoff:** We lose Reddit-native metadata (scores, comment counts, authors) but gain richer text content. For a "Reddit Intelligence" module focused on *what people are discussing* rather than *engagement metrics*, this is actually a better fit.

**Recommendation:** Brave LLM Context should replace Apify as the primary provider. The existing scoring and query selection logic can be reused almost entirely. The database schema already stores `bodySnippet` and `comments` as JSONB — we'd populate these from Brave's extracted snippets instead of Apify's structured data.

---

## G. Smallest Implementation Plan

**Phase 1: Add Brave provider (1 file)**
- Create `backend/src/reddit/providers/braveProvider.ts`
- Implement `RedditProvider` interface using LLM Context API
- Parse `grounding.generic[]` → extract Reddit URLs, titles, snippets
- Map to `RedditPost[]` (subreddit from URL, title from response, bodySnippet from snippets)
- Env var: `BRAVE_API_KEY`

**Phase 2: Update provider registry (1 file edit)**
- Edit `backend/src/reddit/providers/index.ts`
- Priority: Brave (if `BRAVE_API_KEY` set) → Apify (if `APIFY_API_TOKEN` set) → OAuth → null

**Phase 3: Adapt scoring (0-1 files)**
- Existing `scoreDiscussion()` works on `RedditPost` interface — no changes needed
- Brave posts will have `score: 0`, `numComments: 0`, `comments: []` — scoring still works on title/body relevance

**Phase 4: Frontend adjustments (0-1 files)**
- Dashboard card already handles empty comment arrays gracefully
- May want to add a provider badge ("via Brave Search" vs "via Apify")
- No structural changes needed

**Phase 5: Tests (1-2 files)**
- Add `braveProvider.test.ts` (unit tests for response mapping)
- Update existing `redditApi.test.ts` if needed

**Total: ~3 new/edited files. Zero database changes. Zero schema changes. Zero frontend structural changes.**

The existing `RedditPost` interface, `scoreDiscussion()`, query selection, service layer, and repository all work unchanged. Brave is just a new data source that feeds the same pipeline.
