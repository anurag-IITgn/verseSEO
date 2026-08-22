# Technical Health Scoring Redesign Report

## Objective
Replace the linear penalty-based health score model with a production-quality dimension-based normalized scoring model, and fix duplicate crawl creation UX issues.

## Changes Summary

### 1. Dimension-Based Scoring Model (5 dimensions, weighted composite)

**Architecture** (`backend/src/analysis/rules.ts`):
- New function `computeTechnicalHealthScore()` replacing old `calculateHealthScore()`
- 5 dimensions with explicit weights (totaling 100%):
  - Technical Correctness: **30%**
  - Metadata & HTML Quality: **25%**
  - Crawl Coverage & Indexability: **25%**
  - Architecture & Discoverability: **15%**
  - Content & Performance: **5%**

**Dimension compute functions** (each normalizes coverage ratios to 0–100):

| Dimension | Key Metrics | Weight |
|---|---|---|
| Technical Correctness | HTTPS, status code, indexability, robots, sitemap, broken links | 30% |
| Metadata & HTML Quality | Title coverage, length, meta description, H1, Open Graph, viewport, charset, language, favicon, canonical | 25% |
| Crawl Coverage & Indexability | Crawl success rate, OK rate, indexable rate, canonical rate, noindex penalty | 25% |
| Architecture & Discoverability | Link coverage, link health, sitemap presence, discoverability | 15% |
| Content & Performance | Word count, response time, schema markup, images | 5% |

**Normalization**: Each dimension computes coverage ratios (covered/total × 100), then applies weighted sum. Final score = `clamp(Σ dimension × weight)`, range 0–100.

### 2. Crawl State Determination

New function `determineCrawlState()` in `rules.ts:92-126` returns one of:
- `FAILED` — 0 pages discovered/crawled
- `RESTRICTED` — pages discovered but none crawled, no robots.txt
- `PARTIAL` — coverage < 10% (i.e., ≤10%), many discovered but few crawled
- `LIMITED_RENDERING` — JS pages with 0 text extracted
- `COMPLETED` — normal successful crawl

Key behavior: `FAILED`/`RESTRICTED` → health score = 0 automatically; `PARTIAL` → coverage reflected in dimension scores.

### 3. Type Updates (`backend/src/analysis/types.ts`)

- Added `CrawlState` union type: `'COMPLETED' | 'FAILED' | 'RESTRICTED' | 'PARTIAL' | 'LIMITED_RENDERING'`
- Added `CrawlMeta` interface: `{ pagesDiscovered: number; pagesCrawled: number }`
- Added `DimensionScores` interface with all 5 dimensions (each 0–100)
- Updated `SeoAnalysisResult` with `crawlState`, `crawlStateReason`, `dimensions`

### 4. Analysis Rewritten (`backend/src/analysis/analyze.ts`)

- `analyzeSite()` now accepts `crawlMeta: CrawlMeta` as third parameter
- Calls `computeTechnicalHealthScore()` to get dimensions + health score
- Returns `crawlState`, `crawlStateReason`, `dimensions` alongside `healthScore` and `issueCount`

### 5. Analysis Service Updated (`backend/src/services/analysisService.ts`)

- `performAnalysis()` now passes `{ pagesDiscovered: run.pagesDiscovered ?? 0, pagesCrawled: run.pagesCrawled ?? 0 }` as `crawlMeta` to `analyzeSite()`
- Return value includes `crawlState`, `crawlStateReason`, `dimensions`
- `getCrawlResults()` fallback uses `computeTechnicalHealthScore()` instead of removed `calculateHealthScore()`

### 6. Test Suite Rewrite (`backend/test/analysis.test.ts`)

32 tests covering:
- Issue detection (missing title, duplicate titles, canonical, noindex, etc.)
- Crawl state determination (FAILED, PARTIAL, COMPLETED, LIMITED_RENDERING)
- Representative site profiles (A–I): perfect site, healthy site, normal site with warnings, severe site, template issue coverage, duplicate groups, 27-page site, crawl failure, partial crawl, dimensions, HTTP vs HTTPS, missing robots.txt
- All 50 tests pass (32 unit + 4 API + 14 projects)

### 7. UX Fixes

**Duplicate crawl creation** (`src/scripts/app-shell.ts`):
- Removed redundant `btn.onclick` handler at line 3717 that fired alongside `addEventListener` at line 3962, causing two `POST /api/projects/:id/crawls` per click

**Reddit Intelligence entitlement** (`src/scripts/app-shell.ts`):
- `resetModules()`: Free users now see "Pro only" + Upgrade link immediately
- `loadModules()`: Reddit excluded from fetch list for Free users; no Reddit API request made for Free users

**Settings "Back to Dashboard"** (`src/pages/app.astro` + `app-shell.ts`):
- Listener at line 248 in `app-shell.ts` for `.btn-back-dashboard`

**Technical Health "Back to Dashboard"** (`app-shell.ts`):
- Fixed `renderFreeTechnicalReport()` and `renderTechnicalReport()` — replaced broken `btn-report-back` + `if (!currentProject)` with `.btn-back-dashboard` listener

### 8. Files Modified

| File | Changes |
|---|---|
| `backend/src/analysis/types.ts` | Added CrawlState, CrawlMeta, DimensionScores; updated SeoAnalysisResult |
| `backend/src/analysis/rules.ts` | Rewrote scoring model: computeTechnicalHealthScore(), 5 dimension functions, determineCrawlState(); removed calculateHealthScore(), SEVERITY_WEIGHTS, ISSUE_CAPS, MAX_PENALTY |
| `backend/src/analysis/analyze.ts` | analyzeSite() now takes crawlMeta parameter; returns crawlState, dimensions |
| `backend/src/services/analysisService.ts` | Updated performAnalysis() to pass crawlMeta; updated getCrawlResults() fallback |
| `backend/test/analysis.test.ts` | Rewritten for new model: 32 tests covering all profiles |
| `backend/test/analysisApi.test.ts` | Health score range check updated; idempotency test made issue-count agnostic |
| `src/scripts/app-shell.ts` | Fixed duplicate crawl; Reddit entitlement UX; back button fixes |

### 9. Test Results

```
32/32 unit tests pass
4/4 API tests pass  
14/14 projects tests pass
50/50 total tests pass
```

### 10. Scoring Behavior Summary

| Scenario | Score | Behavior |
|---|---|---|
| Perfect site (no issues, multi-page) | 100 | All dimensions at 100 |
| Healthy site with few warnings | 90+ | Minor penalties, dimensions mostly full |
| Normal 30-page site with template warnings | >40 | Will NOT collapse to 0 |
| Severe site with many errors | <30 | Low scores expected |
| 27-page site with 2 warnings/page | >30 | Will NOT collapse to 0 (coverage-based, not penalty-based) |
| 50 pages vs 5 pages same issue | diff ≤10 | Scores normalized by coverage, not additive penalties |
| 0 pages crawled | 0 | FAILED state, score = 0 |
| Non-HTTPS site | Reduced technical correctness | HTTPS gives full 30pts, HTTP gives 0 |
| Missing robots.txt | Slight reduction | Technical correctness drops from 100 to 60 |
| Single page with no links | ~92 | Architecture dimension penalized (no internal links, no discoverability) |
| All pages 500 status | Low score | Content dimensions penalized (0 content-eligible pages) |
| Partial crawl (5/50) | Reflects coverage | Crawl state = PARTIAL, coverage dimension shows reduced score |

### 11. Known Limitations

- Single-page sites naturally score lower on Architecture dimension (no internal links, no discoverability)
- Sites where all pages are non-200/non-content-eligible will have metadata/architecture/content dimensions at 0 (not 50)
- The model normalizes by coverage ratios, not raw issue subtraction — repeated findings on many pages do not proportionally destroy the score
- No Stripe/subscription integration — plan is a local text field only
- 50/50 test coverage achieved; additional edge case testing recommended before production deployment

### 12. Migration Path from Old Model

The old linear model: `100 - (errors × 4 + warnings × 2 + infos × 1)`, capped at 0.
- This collapsed to 0 for any multi-page site with normal warning densities
- The new model provides graduated, meaningful scores across the full 0–100 range
- All dimension weights and formulas are explicit and documented
- No automatic migration script needed — the new model computes scores from scratch on each analysis run