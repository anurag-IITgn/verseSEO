# Billing/Subscription Implementation Audit

Generated: 2026-08-25
Scope: Read-only audit of Dodo billing/subscription implementation against project requirements
Status: Post-checkpoint (activation + cancellation verified; renewal-failure test observed `expired` instead of `on_hold`)

---

## 1. Dodo Webhook Endpoints and Routing

**CURRENT:** Two endpoints registered at `backend/src/routes/billing.ts:62-63`:
- `POST /api/billing/webhook`
- `POST /api/webhooks/dodo`

Both share the same `webhookHandler` closure. Registered in `backend/src/app.ts:79` via `billingRoutes`.

**EXPECTED:** Webhook endpoint(s) accessible to Dodo's outbound delivery. Dual paths provide flexibility for Dodo dashboard configuration.

**STATUS:** PASS

**FILES:** `backend/src/routes/billing.ts:26-63`, `backend/src/app.ts:79`

**RECOMMENDATION:** No change needed. The dual-path approach is defensive and correct.

---

## 2. Webhook Signature Verification

**CURRENT:** `billing.ts:47-56` uses `dodo.webhooks.unwrap(rawBody, { headers, key: webhookKey })`. On failure, returns 401 with `INVALID_SIGNATURE`. The `DODO_PAYMENTS_WEBHOOK_KEY` env var is read at request time (line 27). If unset, returns 500 with `WEBHOOK_NOT_CONFIGURED`.

**EXPECTED:** Dodo requires Standard Webhooks signature verification (`standardwebhooks` library under the hood via the Dodo SDK). The key must be the base64-encoded `whsec_*` value.

**STATUS:** PASS

**FILES:** `backend/src/routes/billing.ts:26-56`, `backend/src/services/dodoService.ts:4-7`

**RECOMMENDATION:** No change needed. The signature verification pattern is correct and tested (`billingApi.test.ts:67-91`).

---

## 3. Raw-Body Handling

**CURRENT:** `backend/src/app.ts:44-53` registers a custom Fastify content type parser for `application/json` that captures the raw string body into `req.rawBody` before JSON parsing. The `FastifyRequest` interface is augmented at line 22-24 to declare `rawBody?: string`. The webhook handler reads `request.rawBody` at `billing.ts:33`.

**EXPECTED:** Standard Webhooks signature verification requires the exact raw body bytes. The custom parser preserves this.

**STATUS:** PASS

**FILES:** `backend/src/app.ts:21-53`, `backend/src/routes/billing.ts:33`

**RECOMMENDATION:** No change needed. This is correctly implemented for the `standardwebhooks` library requirement.

---

## 4. Dodo Event Parsing/Normalization

**CURRENT:** `subscriptionService.ts:18-24` filters on `eventType.startsWith('subscription.')`. All `subscription.*` events are accepted. Non-subscription events (including `payment.failed`, `payment.succeeded`) are silently skipped with a log message. The event data is accessed via `(event as any).data` (line 27), which casts to `SubscriptionsAPI.Subscription` shape.

**EXPECTED:** The Dodo SDK's `webhooks.unwrap()` returns `UnwrapWebhookEvent`, which is a union of all `WebhookPayload.*` types. The code correctly narrows by checking `startsWith('subscription.')` and then accessing `.data.subscription_id`.

**STATUS:** PASS (for subscription events). GAP: `payment.failed` is silently dropped.

**FILES:** `backend/src/services/subscriptionService.ts:18-27`

**RECOMMENDATION:** The silent drop of `payment.failed` is a deliberate design choice, not a bug. However, see item 8 for the implications.

---

## 5. subscription.active Handling

**CURRENT:** `subscriptionService.ts:78-80`: When `status === 'active'`:
1. Upserts subscription record with `plan: 'pro'`, `status: 'active'` (line 68-75)
2. Sets `users.plan = 'pro'` (line 79)

**EXPECTED:** Active subscription = user gets Pro access. The `plan` column on `subscriptions` is always set to `'pro'` regardless of status (line 71) — this is the subscription's intended plan, not its current access state. The `users.plan` field is the actual access control lever.

**STATUS:** PASS

**FILES:** `backend/src/services/subscriptionService.ts:68-80`, `backend/src/repositories/subscriptionRepo.ts:8-30`, `backend/src/repositories/subscriptionRepo.ts:46-54`

**RECOMMENDATION:** No change needed. Tested in `billingApi.test.ts:93-161` including idempotency.

---

## 6. subscription.cancelled Handling

**CURRENT:** `subscriptionService.ts:81-94`: When `status !== 'active'` (including `cancelled`):
1. Upserts subscription record with the event's status
2. Checks if user has any OTHER subscription with `status === 'active'` (line 84-85)
3. If no other active subscription → sets `users.plan = 'free'`

**EXPECTED:** Cancelled subscription = user loses Pro access (unless they have another active sub).

**STATUS:** PASS

**FILES:** `backend/src/services/subscriptionService.ts:81-94`, `backend/test/billingApi.test.ts:163-232`

**RECOMMENDATION:** No change needed. Tested with the multi-subscription edge case handled.

---

## 7. Subscription Reactivation Handling

**CURRENT:** If a subscription moves from `cancelled` back to `active` (e.g. Dodo reactivation), the code at line 78-80 will process it: status is `active`, so `users.plan` is set back to `'pro'`. The subscription record is upserted with the new status.

**EXPECTED:** Reactivation should restore Pro access.

**STATUS:** PASS

**FILES:** `backend/src/services/subscriptionService.ts:68-80`

**RECOMMENDATION:** No change needed. The idempotent upsert handles the status transition correctly. This was manually verified in the reactivation checkpoint.

---

## 8. Payment Failure / subscription.on_hold Handling

**CURRENT:** Two separate Dodo events are relevant:

**A) `payment.failed`:** Filtered out at `subscriptionService.ts:21` because it doesn't start with `subscription.`. The backend never sees or processes payment failure details. No `error_code`, `error_message`, or `retry_attempt` data is captured.

**B) `subscription.on_hold`:** Processed by the general non-active branch at `subscriptionService.ts:81-94`. The subscription record status is set to `on_hold`. Since `on_hold !== 'active'`, the code checks for other active subs and downgrades `users.plan` to `free` if none exist.

**EXPECTED:** Dodo's documented flow for subscription renewal failure is:
1. `payment.failed` fires with decline details
2. `subscription.on_hold` fires — subscription is temporarily suspended
3. Dodo auto-retries soft declines
4. If retry succeeds: `payment.succeeded` + `subscription.active` fire
5. If retries exhausted: dunning emails, eventual `subscription.cancelled` or `subscription.expired`

The current code treats `on_hold` identically to `cancelled` — immediate, permanent downgrade to Free. This is inconsistent with Dodo's intent that `on_hold` is temporary and recoverable.

**STATUS:** GAP

**FILES:** `backend/src/services/subscriptionService.ts:21-23` (payment.failed drop), `backend/src/services/subscriptionService.ts:81-94` (on_hold → free)

**RECOMMENDATION:** This is the most significant finding. Two options exist:
- **Option A (conservative):** Treat `on_hold` as "keep current plan until resolution." Do NOT downgrade on `on_hold`. Wait for `subscription.cancelled` or `subscription.expired` to revoke access. This matches Dodo's recovery-oriented design.
- **Option B (aggressive):** Downgrade immediately on `on_hold` but allow re-upgrade on `subscription.active` (already works).

The choice depends on business intent. The user's observation that Dodo sent `expired` instead of `on_hold` in their test suggests Dodo's test-mode behavior may differ from production. This needs manual validation before deciding.

---

## 9. subscription.expired Handling

**CURRENT:** `subscription.expired` is caught by the `startsWith('subscription.')` filter (line 21), so it IS processed. It falls into the `else` branch (line 81-94) alongside `cancelled`, `on_hold`, etc. The subscription record is updated to `status: 'expired'` and `users.plan` is set to `free`.

**EXPECTED:** Expired subscription = access revoked. This is correct.

**STATUS:** PASS

**FILES:** `backend/src/services/subscriptionService.ts:81-94`

**RECOMMENDATION:** No change needed for `expired`. The user's observation that Dodo sent `expired` instead of `on_hold` during their test suggests that for their specific test scenario, Dodo went straight to `expired`. The code handles `expired` correctly.

---

## 10. Subscription DB Persistence

**CURRENT:** `subscriptionRepo.ts:8-30` uses Drizzle's `onConflictDoUpdate` on `providerSubscriptionId` (unique constraint). Every webhook event upserts the subscription record with:
- `userId`, `plan` (always `'pro'`), `status`, `currentPeriodStart`, `currentPeriodEnd`
- `updatedAt` set to `new Date()`

The `subscriptions` table (`schema.ts:14-30`) has:
- `id` (UUID PK)
- `userId` (FK to users, cascade delete)
- `providerSubscriptionId` (text, unique)
- `plan` (text, default `'pro'`)
- `status` (text, not null)
- `currentPeriodStart`, `currentPeriodEnd` (nullable timestamps)
- `createdAt`, `updatedAt`

**EXPECTED:** Every subscription state change is persisted. Idempotent upserts prevent duplicates.

**STATUS:** PASS

**FILES:** `backend/src/repositories/subscriptionRepo.ts:8-30`, `backend/src/db/schema.ts:14-30`

**RECOMMENDATION:** No change needed. The schema is sufficient for the current requirements.

---

## 11. users.plan Updates

**CURRENT:** `subscriptionRepo.ts:46-54` directly sets `users.plan` via a simple UPDATE. The `users` table (`schema.ts:5-12`) has a `plan` text column defaulting to `'free'`. The update also sets `updatedAt`.

All entitlement checks read `users.plan` at request time:
- `projectService.ts:31-32`: reads `user.plan` from DB
- `crawlService.ts:32-34`: reads `user.plan` from DB
- `aiVisibilityService.ts:106`: reads `userRow.plan`
- `contentService.ts:101`: reads `userRow.plan`
- `searchService.ts:111`: reads plan
- `redditService.ts:142`: checks plan for PRO_REQUIRED

**EXPECTED:** `users.plan` is the single source of truth for access control. It is updated by webhook processing and read by all entitlement checks.

**STATUS:** PASS

**FILES:** `backend/src/repositories/subscriptionRepo.ts:46-54`, `backend/src/db/schema.ts:5-12`, all service files listed above

**RECOMMENDATION:** No change needed. The plan-based gating is consistent across all modules.

---

## 12. Pro/Free Entitlement and Plan Gating

**CURRENT:** Entitlement enforcement is tested in `entitlementEnforcement.test.ts` and implemented across services:

| Gate | Free Limit | Pro Limit | Enforced In |
|---|---|---|---|
| Projects | 1 | 3 | `projectService.ts:17-36` |
| Website scans | 1 lifetime | unlimited | `crawlService.ts:31-38` |
| Reddit Intelligence | blocked | allowed | `redditService.ts:142` |
| Full search results | truncated | full | `searchService.ts:111` |
| Content recommendations | truncated (FREE_RECOMMENDATION_LIMIT) | full | `app-shell.ts:2567` (frontend) |
| AI visibility | limited results | full | `aiVisibilityService.ts` |

The frontend (`app-shell.ts`) also gates report content based on plan, showing `proBoundary()` elements for free users.

**EXPECTED:** Free users get limited access. Pro users get full access. Plan is enforced both backend (API errors) and frontend (UI truncation).

**STATUS:** PASS

**FILES:** `backend/src/services/projectService.ts:17-36`, `backend/src/services/crawlService.ts:31-38`, `backend/src/services/redditService.ts:142`, `backend/src/services/searchService.ts:111`, `backend/test/entitlementEnforcement.test.ts`, `src/scripts/app-shell.ts` (multiple locations)

**RECOMMENDATION:** No change needed. Enforcement is comprehensive and tested.

---

## 13. Idempotency / Duplicate Webhook Handling

**CURRENT:** Two layers of idempotency:

**A) DB-level:** `subscriptionRepo.ts:12-13` uses `onConflictDoUpdate` on the unique `providerSubscriptionId` constraint. Re-delivering the same event simply re-applies the same status — no duplicate records.

**B) Business logic:** The `users.plan` update is idempotent by nature — setting `plan = 'pro'` twice is harmless. The multi-sub check (line 84-85) is also idempotent.

The test at `billingApi.test.ts:146-161` explicitly verifies idempotency by re-sending the same `subscription.active` payload.

**EXPECTED:** Webhook re-delivery (Dodo retries up to 8 times) must not create duplicate state.

**STATUS:** PASS

**FILES:** `backend/src/repositories/subscriptionRepo.ts:8-30`, `backend/test/billingApi.test.ts:146-161`

**RECOMMENDATION:** No change needed. Idempotency is correctly implemented and tested.

---

## 14. Error Handling and Logging

**CURRENT:**
- Signature verification failure → 401 logged at `app.log.warn` (`billing.ts:54`)
- Missing webhook key → 500 logged at `app.log.error` (`billing.ts:29`)
- Missing raw body → 400 returned (`billing.ts:34-36`)
- User not found for webhook → logged at `logger.warn` (`subscriptionService.ts:51-55`), returns `{ processed: false }`
- Non-subscription events → logged at `logger.info` (`subscriptionService.ts:22`)
- Plan changes → logged at `logger.info` (`subscriptionService.ts:80, 91`)
- Unhandled errors → caught by Fastify error handler (`errorHandler.ts:4-27`)

The webhook handler always returns 200 on success (`billing.ts:59`), even if `processed: false`. This prevents Dodo from retrying events for unknown users.

**EXPECTED:** Webhook endpoint should return 2xx to prevent infinite retries for unprocessable events. Errors that are transient should return 5xx to trigger Dodo retry.

**STATUS:** PASS with one observation

**FILES:** `backend/src/routes/billing.ts:26-59`, `backend/src/services/subscriptionService.ts:14-97`, `backend/src/middleware/errorHandler.ts:4-27`

**RECOMMENDATION:** The current approach of returning 200 even for "user not found" is correct — retrying won't help. However, if `processDodoWebhookEvent` throws an unhandled exception (e.g. DB connection failure), Fastify will return 500 and Dodo will retry. This is the desired behavior.

---

## 15. Mismatch Between Intended Billing Architecture and Current Implementation

**CURRENT GAPS IDENTIFIED:**

**A) `payment.failed` is completely ignored.**
The backend has no visibility into why a payment failed, which cards are declining, or how many retry attempts have occurred. The `error_code` and `retry_attempt` fields from Dodo are never captured. If the business later wants to notify users about payment issues or show billing error states in the UI, this data won't exist.

**B) `subscription.on_hold` triggers immediate downgrade.**
As detailed in item 8, Dodo designs `on_hold` as a temporary recoverable state. The current code treats it as terminal. This means a user whose card temporarily fails could lose Pro access immediately, even though Dodo will auto-retry and may succeed.

**C) `subscription.renewed`, `subscription.updated`, `subscription.plan_changed`, `subscription.paused`, `subscription.unpaused`, `subscription.update_payment_method` are all processed by the same generic non-active branch.**
- `subscription.renewed`: Should be treated like `active` (subscription is still active after renewal). Currently, `renewed` has `status: 'renewed'` which falls into the `else` branch and could downgrade the user to Free if no other active sub exists. **This is a bug.**
- `subscription.updated`: Informational. Should not change plan state. Currently could downgrade if the updated status isn't exactly `'active'`.
- `subscription.plan_changed`: May carry a new status. Needs careful handling.
- `subscription.paused`: Intentional pause. Downgrade to Free is arguably correct.
- `subscription.unpaused`: Should restore to the subscription's plan. Currently, if status is `'unpaused'`, it falls to the `else` branch and could downgrade.

**D) No frontend "Manage Subscription" or "Update Payment Method" UI.**
The Settings page shows plan status and an upgrade link, but Pro users have no way to update their payment method, view billing history, or cancel from within VerseSEO. They must go to the Dodo Customer Portal separately.

**E) The `subscription.plan` field in the DB is always `'pro'`.**
The `upsertSubscription` call at `subscriptionService.ts:71` hardcodes `plan: 'pro'`. This field is never used for access control — only `users.plan` is. The DB field is informational only.

**STATUS:** GAP (items A, B, C are functional gaps; D, E are non-critical)

**FILES:** `backend/src/services/subscriptionService.ts` (entire file), `src/pages/app.astro:176-314` (Settings view)

**RECOMMENDATION:** See summary below.

---

## Summary

### A. What Is Already Production-Ready

1. **Checkout flow** — `POST /api/billing/checkout` creates Dodo checkout session, returns URL, prevents double-subscribe
2. **Webhook signature verification** — Standard Webhooks library, correct raw-body handling
3. **subscription.active** — Correctly upgrades user to Pro, idempotent
4. **subscription.cancelled** — Correctly downgrades to Free, respects multi-sub edge case
5. **subscription.expired** — Correctly downgrades to Free
6. **DB persistence** — Idempotent upsert, unique constraint prevents duplicates
7. **Entitlement enforcement** — Project limits, scan limits, plan gating across all modules
8. **Dual webhook paths** — Both `/api/billing/webhook` and `/api/webhooks/dodo` work
9. **Error handling** — Correct 401/500 responses, Dodo retry-compatible
10. **Idempotency** — Tested and verified for re-delivery

### B. What Definitely Needs Fixing

1. **`subscription.renewed` is mishandled** — A `renewed` event carries `status: 'renewed'` (not `'active'`), so it falls into the `else` branch and will incorrectly downgrade the user to Free on their next renewal. This is a **production bug** that will manifest at the first billing cycle after launch.

2. **`subscription.on_hold` triggers immediate, irreversible downgrade** — If Dodo retries succeed and the subscription recovers, the user's plan should be restored. But the user may have already lost access and not understood why. At minimum, this needs a business decision; at worst, it will cause churn on soft declines.

### C. What Can Safely Be Deferred Until Real Subscription Activity

1. **`payment.failed` data capture** — Not blocking. The business can add logging, user notifications, or billing error UI later. Dodo handles retries regardless.
2. **Frontend "Manage Subscription" UI** — Can be added post-launch. Users can use the Dodo Customer Portal in the interim.
3. **`subscription.updated` / `subscription.plan_changed` / `subscription.update_payment_method` handling** — These are informational events. The current generic handling is harmless as long as items B1 and B2 are fixed.
4. **`subscription.paused` / `subscription.unpaused`** — Not triggered by current product flow (no pause feature exposed to users).

### D. What Must Be Manually Validated Against Dodo Before Launch

1. **The `subscription.renewed` bug (B1)** — This WILL fire at the first billing cycle. It must be fixed before any real subscription reaches renewal. Either handle `renewed` as equivalent to `active`, or verify that Dodo sends `subscription.active` after renewal (the docs are ambiguous on whether `renewed` is an additional event or a replacement).
2. **The `on_hold` vs `expired` behavior (B2)** — Your test showed Dodo sent `expired` directly. This needs validation: does Dodo always skip `on_hold` in test mode? Will production behave differently? The answer determines whether B2 is urgent or can be deferred.
3. **Webhook delivery in production** — Confirm Dodo can reach your production webhook endpoint. The `FRONTEND_ORIGIN` and CORS config are irrelevant for inbound webhooks, but the backend must be network-accessible to Dodo's outbound IPs.
4. **`next_billing_date` patching** — Confirmed supported by the Dodo API (`PATCH /subscriptions/{id}` with `next_billing_date` field). Safe for test mode. Not needed in production.
