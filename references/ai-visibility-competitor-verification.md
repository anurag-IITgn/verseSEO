# AI Visibility Competitor Extraction — Raw Data Verification

**Date:** 2026-08-21
**Domain:** tipcalculatorlive.com
**Crawl ID:** 7829fb67-827a-4a85-a7cd-a57a9eef2966
**User plan:** free

---

## Raw Gemini Responses

### Query 1: "best tipping apps/services for small businesses"
```
For tipping services, apps, and platforms, here are the most widely recognized options:
**TipHaus:** An automated tip distribution software used by restaurants...
**TiPJAR:** A cashless tipping platform...
**Gratzi:** A digital tipping platform...
**Toast:** A restaurant-focused POS system...
**Square:** A widespread payment processor...
**TouchBistro:** A POS system designed for restaurants...
**Venmo:** Frequently used for direct P2P digital tipping...
**Cash App:** Similar to Venmo...
**Ko-fi:** Platform for creators...
**Buy Me a Coffee:** Service for creators...
**Patreon:** Leading platform for subscriptions...
```

### Query 2: "best restaurant management/discovery tools"
```
**Yelp:** Platform for customer reviews...
**Google Maps/Google Business Profile:** Essential for location search...
**TripAdvisor:** Global platform for travel recommendations...
**OpenTable:** Reservation management...
**Resy:** Reservation and waitlist management...
**Toast:** Integrated POS, online ordering...
**DoorDash / Uber Eats / Grubhub:** Third-party delivery...
**Toast POS:** All-in-one POS system...
**Square for Restaurants:** POS system...
**7shifts:** Staff scheduling...
**MarketMan:** Inventory management...
**TouchBistro:** iPad-based POS system...
```

### Query 3: "best digital tipping for tour guides"
```
**TipBrightly:** Dedicated digital tipping platform...
**Tiplt:** Service for travel/hospitality industry...
**Gratwy:** Digital tipping for service professionals...
**Venmo / Cash App / PayPal:** P2P transfers...
**Stripe / Square:** Payment processors...
```

### Query 4: "best tools for creating guides"
```
**Scribe:** Auto-generates step-by-step guides...
**Notion:** Versatile workspace for wikis...
**GitBook:** Technical documentation...
**Tango:** Automates how-to guides...
**TripAdvisor:** User-generated reviews...
**Lonely Planet:** Professional travel guides...
**AllTrails:** Hiking/outdoor guides...
**WikiHow:** How-to articles...
**Khan Academy:** Educational guides...
**Coursera:** Course guides...
```

### Query 5: "best calculators/tools"
```
**WolframAlpha:** Computational knowledge engine...
**Google Search Calculator:** Quick-access calculator...
**Desmos:** Graphing calculator...
**Microsoft Math Solver:** Step-by-step solutions...
**Symbolab:** Advanced math problems...
**GeoGebra:** Geometry/algebra/calculus suite...
```

---

## `analyzeMention` Results (Exact Code from mentionDetection.ts)

| Query | `hostsFromText` output | `analysis.competitors` | `analysis.mentioned` | `analysis.stance` |
|-------|----------------------|----------------------|---------------------|------------------|
| 1 | `[]` | `[]` | false | absent |
| 2 | `[]` | `[]` | false | absent |
| 3 | `["u.s"]` (false positive from "the U.S.") | `["u.s"]` | false | absent |
| 4 | `[]` | `[]` | false | absent |
| 5 | `[]` | `[]` | false | absent |

---

## Brand Names in Responses (NOT extracted by hostsFromText)

| Query | Brands mentioned |
|-------|-----------------|
| 1 | TipHaus, TiPJAR, Gratzi, Toast, Square, TouchBistro, Venmo, Cash App, Ko-fi, Buy Me a Coffee, Patreon |
| 2 | Yelp, Google Maps, TripAdvisor, OpenTable, Resy, Toast, DoorDash, Uber Eats, Grubhub, Square, 7shifts, MarketMan, TouchBistro |
| 3 | TipBrightly, Tiplt, Gratwy, Venmo, Cash App, PayPal, Stripe, Square |
| 4 | Scribe, Notion, GitBook, Tango, TripAdvisor, Lonely Planet, AllTrails, WikiHow, Khan Academy, Coursera |
| 5 | WolframAlpha, Google Search Calculator, Desmos, Microsoft Math Solver, Symbolab, GeoGebra |

**Total unique brand names across all queries: ~40+**
**Total extracted by hostsFromText: 0 real competitors (1 false positive)**

---

## Why hostsFromText Produces Empty Results

Gemini responds with brand names in bold plain text format:
```
**TipHaus:** An automated tip distribution software...
```

`hostsFromText` only extracts:
1. **Actual URLs** matching `https?://...` — Gemini responses contain zero URLs
2. **Domain-formatted tokens** matching `[a-z0-9][a-z0-9-]*\.[a-z0-9]...` — "tiphaus" doesn't match because it's not followed by `.com` etc.

The regex `DOMAIN_TOKEN_PATTERN` requires a dot followed by a TLD. Brand names like "TipHaus", "Yelp", "Venmo" don't have dots, so they're never captured.

---

## Two-Layer Filter Chain

### Layer 1: `hostsFromText` extraction (mentionDetection.ts:53-75)
- Input: raw Gemini response text
- Output: array of domain-like tokens
- Result: `[]` for 4/5 queries, `["u.s"]` for 1
- **Root cause:** Gemini returns brand names, not domain URLs

### Layer 2: `stance === 'absent'` override (aiVisibilityService.ts:187)
```typescript
competitors: scored.stance === 'absent' ? [] : analysis.competitors,
```
- Input: `analysis.competitors` from Layer 1
- Output: forced to `[]` when site not mentioned
- Result: even Query 3's `"u.s"` false positive is discarded
- **Impact:** Removes the only non-empty competitors array

### Combined effect
```
Gemini raw response
  → hostsFromText: extracts 0 real domains (40+ brands exist but not in domain format)
    → analyzeMention: returns competitors = []
      → aiVisibilityService: stance === 'absent' → overrides to []
        → stored in DB: competitors = []
          → frontend: topCompetitors = []
            → Section 9/12: only 1 opportunity generated
              → proBoundary condition (length > 1): FALSE
                → Free user sees everything
```

---

## Impact of Fixing Each Layer

### Fix Layer 2 only (remove stance === 'absent' filter)
- Would add `"u.s"` to competitors (false positive)
- `topCompetitors` would have 1 item: `["u.s", 1]`
- Section 9: would add 1 competitor opportunity → `opps.length = 2`
- Section 12: would add 1 competitor action step → `actionSteps.length = 2`
- **But:** The competitor is a false positive ("u.s" from "the U.S."), not a real competitor

### Fix Layer 1 only (enhance hostsFromText to extract brand names)
- Would extract real competitors: TipHaus, Yelp, Venmo, Toast, etc.
- `analysis.competitors` would be non-empty for all 5 queries
- But Layer 2 would still discard them for `stance === 'absent'`
- **Still broken** without also fixing Layer 2

### Fix both layers
- Real competitors extracted and preserved
- `topCompetitors` would have meaningful data
- Section 9/12 would generate 2+ items
- proBoundary would render for Free users

---

## Conclusion

The `stance === 'absent'` filter (Layer 2) is not the primary blocker. The primary blocker is that `hostsFromText` (Layer 1) cannot extract competitors from Gemini's response format. Both layers need to be addressed for the Free/Pro gating to become meaningful.
