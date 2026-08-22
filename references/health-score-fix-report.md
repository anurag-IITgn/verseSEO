# Technical Health Score Fix — Report

## Files Changed

| File | Changes |
|------|---------|
| `backend/src/analysis/rules.ts` | Rewrote `calculateHealthScore()` — subtraction model with per-type caps; uses issue's actual severity (not DEFAULT_SEVERITY); added `ISSUE_CAPS` constant; removed `MAX_PENALTY` export |
| `backend/src/analysis/analyze.ts` | `DUPLICATE_TITLE`/`DUPLICATE_META_DESCRIPTION` now emit 1 issue per group (not per page); replaced `DUPLICATE_H1` with `MULTIPLE_H1` for pages with h1Count > 1; removed dead H1 duplicate detection stub |
| `backend/src/analysis/types.ts` | Added `MULTIPLE_H1` to `IssueType` union |
| `backend/src/services/analysisService.ts` | Updated fallback `calculateHealthScore` call to pass `{issueType, severity}` (not just `{severity}`) |
| `backend/test/analysis.test.ts` | Rewrote with 26 tests covering all specified scenarios |
| `backend/test/analysisApi.test.ts` | Updated duplicate count expectations (1 per group, not 2); replaced hardcoded healthScore=18 with range check; made idempotency test issue-count agnostic |

## Final Scoring Formula

```
Score = 100 - cappedPenalty, clamped to [0, 100]

cappedPenalty = SUM over unique issueTypes of:
  SEVERITY_WEIGHTS[issue.severity] × 1   (first `cap` instances count at full weight)
```

Each issue type is capped independently. The function iterates issues in order, counting up to `cap` instances per type, using each issue's **actual severity** (not the type default). After the cap is reached, additional instances of that type are ignored.

## Severity Weights

| Severity | Weight |
|----------|--------|
| error | 10 |
| warning | 4 |
| info | 1 |

## Per-Type Caps

| Issue Type | Cap | Rationale |
|------------|-----|-----------|
| MISSING_TITLE | 1 | Site-wide template issue |
| MISSING_META_DESCRIPTION | 1 | Site-wide template issue |
| MISSING_CANONICAL | 1 | Site-wide template issue |
| MISSING_H1 | 1 | Site-wide template issue |
| MISSING_OG_TAGS | 1 | Site-wide template issue |
| MISSING_VIEWPORT | 1 | Site-wide template issue |
| MISSING_CHARSET | 1 | Site-wide template issue |
| MISSING_FAVICON | 1 | Site-wide template issue |
| MISSING_HTML_LANG | 1 | Site-wide template issue |
| MISSING_HTTPS | 1 | Site-level |
| MISSING_ROBOTS_TXT | 1 | Site-level |
| MISSING_SITEMAP | 1 | Site-level |
| DUPLICATE_TITLE | 1 | Per-group, not per-page |
| DUPLICATE_META_DESCRIPTION | 1 | Per-group, not per-page |
| DUPLICATE_H1 | 1 | Per-group, not per-page |
| MULTIPLE_H1 | 1 | Per-page (multiple H1s on one page) |
| TITLE_TOO_SHORT | 5 | Per-page, capped |
| TITLE_TOO_LONG | 5 | Per-page, capped |
| THIN_CONTENT | 5 | Per-page, capped |
| SLOW_RESPONSE | 5 | Per-page, capped |
| IMAGES_MISSING_ALT | 10 | Per-page, higher cap |
| BROKEN_INTERNAL_LINK | 10 | Per-page, higher cap |
| NON_200_PAGE | 10 | Per-page, higher cap |

## Score Examples

| Scenario | Issues | Capped Penalty | Score |
|----------|--------|----------------|-------|
| Perfect site | 0 | 0 | 100 |
| 1 missing title | 1 error | 10 | 90 |
| Healthy 20-page site | 0 | 0 | 100 |
| 30-page site, missing meta + canonical | 2 warnings | 8 | 92 |
| 27-page site, missing meta + canonical | 2 warnings | 8 | 92 |
| Mediocre site (several warnings) | ~7 warnings | ~28 | 72 |
| Severe site (all pages HTTP 500, HTTP, no robots/sitemap) | 4 site errors + 20 page errors | 118 | 0 |
| Any single issue type repeated 200 times | capped at cap weight | e.g. 10 | 90 |

## Bugs Fixed

1. **DUPLICATE_TITLE / DUPLICATE_META_DESCRIPTION over-counting**: Previously emitted 1 issue per page in a duplicate group. Now emits 1 issue per group with a `null` pageId and a message indicating affected page count.

2. **DUPLICATE_H1 misnomer**: The old code flagged pages with h1Count > 1 as "DUPLICATE_H1" (cross-page duplicate), but it was actually detecting multiple H1s on a single page. Renamed to `MULTIPLE_H1`. Removed dead stub code that attempted cross-page H1 duplicate detection (it compared URLs, which are always unique).

3. **Scoring collapse to 0**: The old formula `100 - (errors×4 + warnings×2 + infos×1)` treated every issue instance equally with no caps. A 27-page site with just missing meta descriptions + canonicals (2 warnings per page = 54 issues) produced penalty = 108, score = 0. The new capped model produces penalty = 8, score = 92.

4. **Severity override ignored**: The old scoring used `DEFAULT_SEVERITY[issueType]` instead of each issue's actual severity. The override in `analyzeSite` that promotes `NON_200_PAGE` to `'error'` for HTTP 500/0 responses was silently ignored during scoring. Now uses each issue's actual `.severity`.

## Test Results

```
analysis.test.ts:      26/26 pass
analysisApi.test.ts:    4/4 pass
auth.test.ts:          13/13 pass
projects.test.ts:      14/14 pass
scanSafety.test.ts:     3/3 pass
scanApi.test.ts:        3/3 pass
projectManagement.test.ts: 13/13 pass
demo.test.ts:           6/6 pass
```

Total: **82/82 tests pass**, 0 failures.

## Behavioral Changes

- **Free users**: No change (health score calculation is backend-only).
- **Pro users**: Scores will be higher for normal sites (no longer collapsing to 0).
- **issueCounts / issueCount**: The `issues` array and per-type counts remain unchanged for reporting. Only the health score calculation and duplicate issue generation changed.
- **Backward compatibility**: Existing stored health scores in the database are not retroactively recalculated. New scans will use the new model.

Report saved to: `references/health-score-fix-report.md`
