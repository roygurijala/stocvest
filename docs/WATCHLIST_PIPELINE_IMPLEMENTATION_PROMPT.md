# Watchlist maturation pipeline — **corrected implementation prompt** (v2)

**Use with:** `docs/CONTEXT.md` (B4 shipped; scanner + dashboard integration), `docs/BACKLOG.md` (B5 subscriptions, B3 alerts), `docs/API_CONTRACTS.md`.

**Test / baseline gate:** Use the counts in `CONTEXT.md` §13 at ship time — do **not** hard-code “732 / 111” in CI docs; they drift.

---

## Opinion (for implementers)

1. **Removing `watchlist_store.py` + the Watchlists page “from scratch” is possible in one release**, but it **does** touch many systems. It is **not** a self-contained Dynamo + Lambda add. Treat this as a **repo-wide contract change** with an explicit integration checklist (below).

2. **Do not add a second Dynamo table also named like the product “watchlist”** without resolving the existing **`Watchlists`** table (`infra/dynamodb.tf`, `userId` + `watchlistId` + `symbols[]`). Either:
   - **(A) Replace in place:** evolve the same Terraform resource (new PK/SK + GSIs) **after** a one-shot migration script from old items → new shape, **or**
   - **(B) Blue/green:** new table + dual-read period + cutover + delete old table.

3. **Original prompt bugs / mismatches with this repo:**
   - API today is **`/v1/watchlists`** (plural), wired in `stocvest/api/lambda_dispatch.py` + `infra/apigateway_6e.tf` → **brokers** Lambda. Introducing parallel **`/v1/watchlist`** doubles gateway surface unless you **replace** routes intentionally.
   - Composite entry points are **`build_swing_composite_response`** / **`build_real_composite_response`** — not `compute_swing_composite` / `compute_day_composite`.
   - **`get_user_profile`** / `user_repository` **do not exist** — use **`get_user_profile_store().get_profile(user_id)`** (`stocvest/api/services/user_profile_store.py`). Plans: `subscription_plan` values such as **`swing_pro`**, **`swing_day_pro`**, **`free`**; beta access uses **`beta_full_access`** — align gates with real fields.
   - **Dashboard watchlist strip** today: `watchlistStatus` is built in **`frontend/lib/api/scanner-load.ts`** from default watchlist symbols + scanner setups — **not** Upstash. Part 9 must either keep that derivation, **or** move summary to the scanner API response — do not assume `WatchlistStrip.tsx` exists.
   - **Cron “8:15 AM ET”:** naive `cron(...)` on EventBridge is **UTC unless** you use **EventBridge Scheduler** `schedule_expression_timezone = America/New_York` (or equivalent). Fix expressions after choosing scheduler type.
   - **GSI sketches** (`pk = mode`) are **operationally unsafe** (hot partition). Replace with a sharded / sparse design or **SQS work queue** filled by a cheap cron.
   - **Free tier striping:** original Part 6 lists `alignment_pct` for free users then sets it `null` — pick **one** contract (recommended: hide **readiness_label**, **missing_**, **top_missing_**; keep coarse **state** + **bias** only if product agrees).
   - **Alert copy:** avoid emoji in subjects unless brand approves; avoid “Setup ready for review” without counsel (reads like advice). Link to **`https://stocvest.app/dashboard/watchlists`** (and signals) — not bare `stocvest.app/watchlist` (route today is **`/dashboard/watchlists`**).

---

## Replace-from-scratch — **integration checklist** (mandatory)

If you delete **`stocvest/data/watchlist_store.py`** and the current UI, you **must** update **all** of:

| Area | Files / systems |
|------|------------------|
| Dynamo + env | `infra/dynamodb.tf`, `infra/lambda_6e.tf` (`DYNAMODB_WATCHLISTS_TABLE` or new env), ECS if any task reads table |
| Scanner universe | `stocvest/data/scan_symbols.py` (`get_default_watchlist` / new equivalent), `stocvest/api/handlers/scanner.py` |
| Scheduled merge | `watchlist_scanner_alerts` + any job using `scan_default_watchlists` / `find_users_with_default_watchlist_symbol` (`stocvest/api/services/watchlist_scanner_alerts.py`, B14 path in CONTEXT) |
| HTTP API | `stocvest/api/handlers/watchlists.py`, `stocvest/api/lambda_dispatch.py`, `infra/apigateway_6e.tf` |
| BFF | `frontend/app/api/stocvest/watchlists/**`, `frontend/lib/api/watchlists.ts` |
| App UI | `frontend/app/dashboard/watchlists/page.tsx`, `frontend/components/watchlists-page-client.tsx`, nav / prefetch links to `/dashboard/watchlists` |
| Dashboard | `frontend/lib/api/scanner-load.ts` (`buildWatchlistDashboardStatus`), `dashboard-redesign.tsx` strip semantics |
| Assistant | Any `usePublishAssistantContext` page keys for watchlists |
| Tests | All `**/test*watchlist**`, scanner tests, dashboard tests touching `watchlistStatus` |

**Gate:** No PR merges until `pytest tests/ -q` and frontend test gate match `CONTEXT.md` §13 **and** manual smoke: scanner loads with auth, dashboard strip, add/remove symbol.

---

## Product definition (unchanged intent)

*(Keep your original “maturation pipeline”, mode awareness, and tier story.)*

**Clarification for STOCVEST today:** the shipped product still exposes **named lists + default list** (`Watchlists` table). The v2 product can collapse to **“one effective universe per user”** (default-only) **or** preserve multiple lists — **decide in Part 0**; it affects Dynamo key design and `get_scan_symbols`.

---

## Part 0 — Discovery & decisions (before Part 1)

1. **List model:** single flat watchlist per user vs multiple lists — **choose** (scanner today = **default** list only).  
2. **Table strategy:** replace `Watchlists` vs new table + cutover — **choose**; document Terraform state steps.  
3. **Composite adapter spike:** prove one call path from Lambda/job context into `build_swing_composite_response` / `build_real_composite_response` (or smaller internal helpers) with **golden JSON** for layer keys — **no invented kwargs** (`skip_ai_explanation` must map to a real cost-control flag or post-filter AI fields).  
4. **Plan gates:** until B5 (Stripe) ships, implement limits via **`subscription_plan` + `beta_full_access`** with **feature flags** for staging.  
5. **Alerts:** integrate with existing **`alerts_store` / `alert_tasks` / SES`** patterns if present; avoid a second parallel SES client unless necessary. Dedupe keys + idempotency documented.  
6. **URLs & routes:** all user-facing links use **`/dashboard/watchlists`** and **`/dashboard/signals?...`** unless marketing ships a new route.

**Exit:** short design note in repo (optional `docs/WATCHLIST_MATURATION_ARCH.md`) with access patterns + migration.

---

## Part 1 — Data model & DynamoDB

### 1A Terraform

- **Name:** avoid clashing with existing resource **`aws_dynamodb_table.watchlists`** in Terraform state. If replacing, use `terraform state mv` / import plan **or** new resource name e.g. `watchlist_maturation` then cutover.  
- **Billing / PITR:** PAY_PER_REQUEST + PITR as you specified.  
- **Keys:** e.g. `pk = USER#{user_id}`, `sk = SYM#{SYMBOL}#{mode}` — **document** reserved prefixes.  
- **TTL vs archive:** single retention story — `archive_after` (UX) vs `ttl` (physical delete) must not contradict (original had 48h vs 72h).

### 1B GSIs (replace original)

**Do not ship `EvaluationIndex` with `pk = mode` only.**

Pick **one**:

- **G1 — Scheduler queue:** EventBridge → **SQS** batch of `{user_id, symbol, mode}`; workers drain with bounded concurrency. Dynamo is system of record; **no** “all swing rows” query.  
- **G2 — Sharded time index:** `evalShard = {YYYY-MM-DD}#{mode}#{shard_id}` (hash shard 0..N-1), `sk = USER#...#SYM#...`, maintained on write. Query all shards for “today not evaluated”.  
- **G3 — UserStateIndex (fixed):** project attributes e.g. `gsi1pk = USER#{user_id}`, `gsi1sk = STATE#{state}#SYM#{symbol}#MODE#{mode}` on **every** item; query `gsi1pk` + `begins_with(gsi1sk, 'STATE#actionable#')`.

### 1C Python model (`stocvest/models/watchlist.py`)

- Keep enum + `derive_state` **but**:
  - Use **timezone-aware** UTC (`datetime.now(timezone.utc)`) for comparisons; rename **`is_archivable` → `should_hide_from_active_lists`** (or similar) to avoid inverted logic bugs.  
  - Align docstring thresholds with code (`>=3` developing, `>=5` actionable).  
  - `_ALL_LAYERS` must match **actual composite layer keys** from engine output — verify against live payloads / `SIGNAL_ENGINE.md`.

---

## Part 2 — Repository (`stocvest/data/watchlist_repository.py` or replace `watchlist_store.py`)

- **Pagination:** loop `LastEvaluatedKey` on **all** `query` calls.  
- **Dynamo types:** `update_item` expression builders must handle reserved words, **REMOVE** for clearing TTL, and type consistency (`Decimal` for numbers if using boto3 resource).  
- **`_entry_to_item`:** persist **GSI projected attributes** if using G1/G3.  
- **`mode`:** store string `"swing"` / `"day"` consistently.

---

## Part 3 — Evaluation engine (`stocvest/workers/watchlist_evaluator.py`)

- Call **verified** composite builders; map JSON → `layers_aligned` / `missing_layers` with **fixture-locked** tests.  
- **Concurrency:** semaphore + symbol-level dedupe of upstream market fetches; per-user Dynamo writes stay isolated.  
- **Failure:** do not blank good state without `eval_status` / `last_error` semantics.  
- **Logging:** use `get_logger(__name__)` — `_LOG` must be defined.

---

## Part 4 — Alerts

- Prefer **extending** existing alert pipeline (`stocvest/api/services/alert_tasks.py`, `alerts_store`, `watchlist_scanner_alerts.py` patterns: dedupe, email mirror).  
- **Subjects/body:** neutral, informational, link to app paths above; **no** emoji unless product approves.  
- **Gates:** respect `AlertPreferences` + plan + `mode` (no day alerts for `swing_pro`).

---

## Part 5 — API

**Recommendation:** evolve **`/v1/watchlists`** instead of introducing `/v1/watchlist` **unless** you intentionally version (`/v2/...`) and update **API Gateway + BFF + clients** in one PR.

- **Auth:** user id from JWT only (unchanged rule).  
- **POST add:** immediate eval = **async** (SQS or `asyncio.create_task` inside Lambda only if runtime supports — prefer **SQS** for Lambda @ retry semantics).  
- **Summary for dashboard:** either extend scanner handler payload **or** add `GET /v1/watchlists/summary` — ensure **frontend** `scanner-load.ts` and dashboard stay consistent.

---

## Part 6 — Plan gates (`watchlist_gates.py` or module colocated with handlers)

- Map **`subscription_plan`** + **`beta_full_access`** to limits/modes — **no** hard-coded `beta_tester` string unless it exists in prod data.  
- **Free tier field contract:** explicitly list nullable fields; avoid contradictions.

---

## Part 7 — Scheduler

- Use **EventBridge Scheduler** with **`America/New_York`** **or** document UTC cron + DST caveat.  
- Two schedules (swing / day) OK; **timeout/memory** sized from worst-case symbol count × composite cost.  
- Target Lambda must exist in **`lambda_dispatch`** **or** dedicated function URL — **match repo’s** `infra/lambda_6e.tf` / module pattern (`brokers` vs `signals`).

---

## Part 8 — Frontend

- **Route:** implement under **`frontend/app/dashboard/watchlists/`** (or add redirect from legacy path) so **nav + prefetch** (`/dashboard/watchlists`) stay valid.  
- **Do not** require `frontend/app/watchlist/page.tsx` unless you also update **`frontend/lib/nav-features.ts`**, sitemap, and marketing links.  
- **Components:** `frontend/components/watchlist/*` is fine; keep **Mode Separation** and **no-advice** copy in upgrade sheets.

---

## Part 9 — Dashboard integration

- **Today:** `buildWatchlistDashboardStatus` in `scanner-load.ts`.  
- **Options:** (a) extend that function with maturation states from API, (b) add server-computed `watchlistSummary` to scanner JSON, (c) optional Upstash cache **behind** the same contract.  
- **Do not** reference non-existent `WatchlistStrip.tsx` unless you create it and **replace** inline strip in `dashboard-redesign.tsx`.

---

## Part 10 — Config

- Add env vars via **`get_settings()`** / existing patterns in `stocvest/utils/config.py`; wire in **`infra/lambda_6e.tf`** (+ any other Lambda bundles touching watchlist).

---

## Part 11 — Tests

Keep your test matrix **plus:**

- Integration tests for **`get_scan_symbols`** with new store.  
- Regression: **scanner** + **dashboard strip** + **BFF routes**.  
- **Remove / rewrite** old watchlist tests when deleting `watchlist_store.py`.

**Final commands:** `pytest tests/ -q`; `cd frontend && npx vitest run`; `npm run build` — thresholds per `CONTEXT.md` §13 at time of PR.

---

## Final verification checklist (amended)

- [ ] Integration checklist (table above) **all** ticked  
- [ ] No hot-partition Dynamo access pattern  
- [ ] Composite integration uses **real** function names + fixtures  
- [ ] Cron timezone **correct** for ET  
- [ ] API paths consistent with **Gateway + BFF**  
- [ ] Dashboard strip data path **documented** (scanner-load vs API)  
- [ ] Alerts use **existing** infra where possible + counsel-safe copy  
- [ ] CONTEXT.md / IMPLEMENTED.md / BACKLOG.md updated on ship  

---

*This file supersedes the uncorrected “complete original prompt” for implementation planning in the STOCVEST repo.*
