# AI Visibility Competitor Extraction Fix — Final Report

**Date:** 2026-08-21
**Status:** COMPLETE — Both issues fixed, all tests pass, E2E verified

---

## Problem Summary

Free users saw the complete AI Visibility Report with no Pro upgrade boundary. Root cause: the opportunity/action-step generation logic produced only 1 item for zero-visibility sites, making the `proBoundary` condition (`opps.length > 1`) impossible to satisfy.

---

## Root Cause (Two Layers)

### Layer 1: `hostsFromText` couldn't extract brand names

Gemini responses list competitors as bold plain text:
```
**TipHaus:** An automated tip distribution software...
**Yelp:** Platform for customer reviews...
```

`hostsFromText` only extracted actual URLs and domain-formatted tokens. It missed 40+ brand names across 5 queries.

### Layer 2: `stance === 'absent'` filter discarded even the 1 false positive

```typescript
competitors: scored.stance === 'absent' ? [] : analysis.competitors,
```

When the site wasn't mentioned (all 5 queries), all competitor data was forced to `[]`.

---

## Fixes Applied

### Fix 1: `backend/src/ai/mentionDetection.ts`

Added `brandsFromText()` function:
- Extracts brand names from `**BrandName:**` patterns in AI responses
- Handles multi-brand slash entries (`**DoorDash / Uber Eats / Grubhub:**`)
- Filters category headers via `BRAND_EXCLUSION` regex (starts with "for", is "u.s")
- Filters entries with parentheses (section headers)
- Merges with existing domain extraction, deduplicates, caps at 6

Added `"u.s"` filtering to `hostsFromText()` as well.

Updated `analyzeMention()` to merge `hostsFromText` + `brandsFromText` results.

### Fix 2: `backend/src/services/aiVisibilityService.ts`

Line 187: Removed `stance === 'absent'` override.

Before: `competitors: scored.stance === 'absent' ? [] : analysis.competitors`
After: `competitors: analysis.competitors`

### Fix 3: `backend/test/geminiLive.test.ts`

Same change as Fix 2 to match new production behavior.

---

## Extraction Results (5 Gemini Responses)

### Query 1: "best tipping apps/services"
```
brandsFromText: ["TipHaus","TiPJAR","Gratzi","Instant","Branch","Toast",
                 "Square","TouchBistro","Venmo","Cash App","Ko-fi",
                 "Buy Me a Coffee","Patreon"]
analysis.competitors: ["TipHaus","TiPJAR","Gratzi","Instant","Branch","Toast"]
```

### Query 2: "best restaurant management tools"
```
brandsFromText: ["Yelp","Google Maps","Google Business Profile","TripAdvisor",
                 "OpenTable","Resy","Toast","DoorDash","Uber Eats","Grubhub",
                 "Toast POS","Square for Restaurants","MarketMan","TouchBistro"]
analysis.competitors: ["Yelp","Google Maps","Google Business Profile",
                       "TripAdvisor","OpenTable","Resy"]
```

### Query 3: "best digital tipping for tour guides"
```
brandsFromText: ["TipBrightly","Tiplt","Gratwy","Venmo","Cash App",
                 "PayPal","Stripe","Square"]
analysis.competitors: ["TipBrightly","Tiplt","Gratwy","Venmo","Cash App","PayPal"]
```

### Query 4: "best tools for creating guides"
```
brandsFromText: ["Scribe","Notion","GitBook","Tango","TripAdvisor",
                 "Lonely Planet","AllTrails","WikiHow","Khan Academy","Coursera"]
analysis.competitors: ["Scribe","Notion","GitBook","Tango","TripAdvisor",
                       "Lonely Planet"]
```

### Query 5: "best calculators/tools"
```
brandsFromText: ["WolframAlpha","Google Search Calculator","Desmos",
                 "Microsoft Math Solver","Symbolab","GeoGebra"]
analysis.competitors: ["WolframAlpha","Google Search Calculator","Desmos",
                       "Microsoft Math Solver","Symbolab","GeoGebra"]
```

### Summary
- Total competitors extracted: 29
- Unique competitors: 26
- Average per query: 5.8
- "u.s" false positive: NONE

---

## E2E Verification

### API Response
```
plan: "free"
status: "ok"
results count: 5
overallVisibilityScore: 0
displayScore: 15
mentionedCount: 0
citedCount: 0
```

### Competitors Per Result
```
"guide":      6 competitors [Pendo, WalkMe, Appcues, Notion, GitBook, Confluence]
"restaurant": 6 competitors [OpenTable, Resy, Yelp, Google Business Profile, Toast, Square for Restaurants]
"tipping":    6 competitors [Venmo, Cash App, PayPal, Ko-fi, Buy Me a Coffee, Patreon]
"guide tipping": 5 competitors [TipVault, TiPJAR, Venmo, PayPal, Cash App]
"calculator": 6 competitors [calculator.net, WolframAlpha, Google Search Calculator, Desmos, Microsoft Math Solver, Symbolab]
```

### Simulated topCompetitors (Frontend Logic)
```
topCompetitors.length: 8
  Venmo: mentioned in 2 queries
  Cash App: mentioned in 2 queries
  PayPal: mentioned in 2 queries
  Pendo: mentioned in 1 queries
  WalkMe: mentioned in 1 queries
  Appcues: mentioned in 1 queries
  Notion: mentioned in 1 queries
  GitBook: mentioned in 1 queries
```

### Section 9 Opportunities
```
opps.length: 2
  1. [high] Expand content coverage for 5 missing topics
  2. [medium] Analyze competitor visibility
```

### Section 12 Action Plan
```
actionSteps.length: 2
  Step 01: Missing topic coverage for 5 tested queries
  Step 02: Competitor visibility gaps
```

### Gating Verification
```
plan: free
Free sees 1 opportunity out of 2 total
Free sees 1 action step out of 2 total
Section 9 proBoundary shown: true
Section 12 proBoundary shown: true
Gating is WORKING
```

---

## Verification Checklist

| # | Check | Result |
|---|-------|--------|
| 1 | Free account API returns `plan: "free"` | ✅ |
| 2 | At least one genuine competitor extracted | ✅ (29 total, 26 unique) |
| 3 | `topCompetitors.length > 0` | ✅ (8) |
| 4 | `opps.length > 1` | ✅ (2) |
| 5 | `actionSteps.length > 1` | ✅ (2) |
| 6 | Free user sees first item + proBoundary | ✅ (both sections) |
| 7 | Pro user sees all items, no boundary | ✅ (slicing logic unchanged) |
| 8 | "u.s" NOT treated as competitor | ✅ |
| 9 | Existing domain extraction still works | ✅ |
| 10 | No fake competitors introduced | ✅ |

---

## Test Results

### Unit Tests (`test/ai.test.ts`)
```
✔ selectAiPrompts derives topical prompts from real crawled content
✔ selectAiPrompts is deterministic and never contains a website domain
✔ buildAiPrompt asks a neutral topical question without biasing the answer
✔ parseGeminiResponse extracts the model text from a valid payload
✔ parseGeminiResponse tolerates empty, missing and malformed payloads
✔ analyzeMention detects a citation from a URL to the domain
✔ analyzeMention detects a bare mention without a citation
✔ analyzeMention detects the brand without the TLD
✔ analyzeMention classifies recommendation, neutral, negative and absent stances
✔ analyzeMention extracts identifiable competitors and never includes the domain itself
✔ analyzeMention handles an IP-address domain
✔ scoreVisibility follows the documented formula
✔ scoreVisibility clamps within 0-100
ℹ tests 13 | pass 13 | fail 0
```

### API Tests (`test/aiApi.test.ts`)
```
✔ runs a real AI visibility analysis from a crawl, detecting mentions, citations and competitors
✔ repeated requests are idempotent and never duplicate results
✔ returns an honest unavailable state when Gemini is not configured
✔ returns an honest unavailable state when the provider fails
✔ ai visibility endpoint rejects invalid or unknown crawl ids
✔ ai visibility endpoint rejects crawls that did not complete
✔ response includes plan field — free by default
✔ response includes plan field — pro after upgrade
ℹ tests 8 | pass 8 | fail 0
```

---

## What Was NOT Changed

- Plan handling
- `visibleOpps` slicing logic
- `visibleSteps` slicing logic
- `proBoundary()` function
- Sections 1-8 visibility
- Sections 10-11 visibility
- Free/Pro gating conditions in frontend
- `AiVisibilityResponse` interface
- `buildResponse()` function
- Demo flow
