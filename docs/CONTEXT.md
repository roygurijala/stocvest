# STOCVEST — Session Context

**Read this file at the start of each session.** It summarizes what exists, what is pending, and what is planned—without duplicating the whole repo tree.

**Last updated:** 2026-05-04  
**Repo:** https://github.com/roygurijala/stocvest  
**Test baseline (regression gate — must match §13):** Backend `pytest tests/ -q` → **525 passed**, **3 skipped**. Frontend `npm run test` → **56 passed** (19 test files). **`npm run build`** last verified: success.

---

## 1. Status at a glance

| Track | Status | Notes |
|--------|--------|--------|
| Core data + indicators | ✅ | Polygon client, `stocvest/indicators/` |
| Swing + day-trading signals | ✅ | `stocvest/signals/` (layers, scanner, briefing, journal engine, PDT tracker) |
| Brokers | ✅ | Mock, IBKR, E*TRADE adapters; factory; PDT hook |
| HTTP API (Lambdas) | ✅ | Market, **signals** (HTTP submodule + public/user record routes), brokers, portfolio, scanner, journal, PDT, orders, auth; journal `user_id` from JWT only; free-text **`text_sanitize`**; **`log_privacy`** for CloudWatch-safe logs |
| Frontend (Next.js) | ✅ | Auth, dashboard redesign, **Gap Intelligence** scanner panel + structured **morning brief** (7:45–10:00 ET); scanner/signals/**watchlists**/portfolio/journal/options/crypto/futures, landing, legal pages; BFF **`/api/stocvest/signals/**`** (swing composite, user history, record by id); **signals page stale-data guard** (`hasValidSignal`) + **after-hours research panel** (`signals-after-hours-panel.tsx`) for closed-market insufficient-data states; **`vercel.json`** security headers (+ HSTS on **stocvest.app**) |
| Journal automation (B1) | ✅ | `journal_order_hooks` on order submit (open/close rows, optional signal fields), `GET /v1/journal/analytics`, entry GET/PATCH, journal UI + scanner → portfolio order prefill |
| Onboarding + legal acknowledgment (B2) | ✅ | `UserProfile` legal + onboarding fields; `GET`/`PATCH /v1/users/me`; mandatory **legal acknowledgment modal** + optional **onboarding wizard** on `app/dashboard/layout.tsx`; BFF `/api/stocvest/users/me` |
| Order safety (Step 8) | ✅ | `order_safety.py`, validate/submit BFF, confirmation modal, paper/live mode |
| **Watchlists (B4)** | ✅ | `stocvest/data/watchlist_store.py` (**`scan_default_watchlists`**, **`find_users_with_default_watchlist_symbol`** for scheduled jobs only), `scan_symbols.get_scan_symbols`, `GET`/`POST`/`PATCH`/`DELETE` watchlists + default symbols API (brokers Lambda), dashboard **Watchlists** page, BFF `/api/stocvest/watchlists/**`, **dashboard scanner** loads default symbols in parallel with PDT and passes them into **`fetchScannerOverview`** / **`loadScannerDataWithoutBrief`**; scanner gap path defers Dynamo until Polygon 401/403 fallback; **B14** scheduled scan merges platform default-watchlist symbols (cap 30) + config + **`SYSTEM_DEFAULTS`** (cap 40 total); **`watchlist_scanner_alerts`** + **`UserProfile.email`** (optional Dynamo mirror) for best-effort signal emails within **2s** `asyncio.wait_for` + **4h** dedupe via **`had_signal_email_for_symbol_within_hours`** |
| **Alerts email (B3)** | ✅ | `stocvest/data/models.py` alert enums + prefs/record, `alert_store.py`, `stocvest/services/email_service.py` (SES), `alert_trigger.py`, `GET`/`PATCH /v1/alerts/preferences`, `GET /v1/alerts/history`, non-blocking signal + PDT emails; settings **Alert Preferences** + `docs/DEPLOYMENT.md` SES notes; Lambda IAM `ses:SendEmail` |
| Legal compliance pass | ✅ | `GlobalDisclaimer`, `SignalDisclaimerChip`, signal-oriented copy, public API field names + `disclaimer` |
| D1 Signal outcome pipeline | ✅ | `SignalRecord` / `SignalHistory`, `signal_recorder` (record + **`resolve_signals`** using Polygon **1m aggregates** at T+1h and next RTH 4:00 PM ET close for 1d via **`get_evaluated_price_after_signal`**), `GET /v1/signals/recent` + performance summary (**`correct_direction_count`** / **`incorrect_direction_count`** / **`neutral_direction_count`**), **`GET /v1/signals/records/{id}`**, **`GET /v1/signals/me/history`**, **`GET /v1/signals/me/records/{id}`**; resolution Lambda + EventBridge **`stocvest-signal-resolution`** **`ENABLED`**, **`rate(30 minutes)`** → **`stocvest-development-api-signal_resolution`**. Apply **2026-05-03** (see `docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md`). **Optional later:** weekly horizon, extra analytics. |
| Terraform / AWS apply | 🚧 | **Development** matches applied `infra/` (incl. D1 rule + API routes). **Still pending:** production/stage promotion, secret rotation, S3 artifact bucket policy review, Cognito/Vercel env alignment per environment. |
| Phase 7 (E2E, audits, paper validation) | 🔜 | Not started as a program |

---

## 2. Implemented (where to look)

**Backend (`stocvest/`)**  
`data/` (models incl. **`UserProfile`** legal/onboarding + optional **`email`** (Dynamo mirror for scheduled alert delivery), **`SignalRecord`**, **`AlertPreferences`** / **`AlertRecord`** / **`AlertType`**, **`EconomicCalendarEvent`**, **`watchlist_store`** + **`alert_store`**, Polygon — snapshot parser may drop `day` OHLC/VWAP vs **`lastTrade.p`** only when last is a positive price and any session field is **>5×** off; missing last keeps session bar; **`get_evaluated_price_after_signal`** for D1 bar-based outcomes; **`get_economic_calendar_for_day`** on Benzinga economics when tier allows), `indicators/`, `signals/` (sentiment, macro, geo, composite, AI synthesis, day-trading scanner, **`confluence`** multi-signal alignment score in `confluence.py`, **`gap_intelligence`** + dynamic news lookback + **`news_catalyst_detector`** listicle-aware noise + company-name headline fallback, **`morning_brief`**, **`trade_journal`** + **`compute_journal_analytics`**, briefing markdown generator still in `daily_briefing.py` for legacy tests), `brokers/` (adapters, gateways, OAuth), **`services/email_service.py`**, **`services/alert_trigger.py`**, **`api/services/watchlist_scanner_alerts.py`** (scheduled intraday/EOD setup → watchlist user email; **4h** dedupe), `api/` (handlers incl. **`signal_resolution`**, **`signals`** → **`signals_http_dispatch`** for signal HTTP surface with **dynamic per-layer `reasoning`** in composite `contributions`, **`watchlists`**, **`alerts`**, **`GET`/`PATCH /v1/users/me`**, **`text_sanitize.py`**, **`services/signal_recorder.py`**, **`services/composite_market_context.py`** (Polygon market status for swing composite insufficient-data responses), **`services/morning_brief_fetch.py`**, **`services/scanner_scheduled_pipeline.py`** (platform watchlist symbol merge + notify), **`services/journal_order_hooks.py`** (auto journal on fill/close; swallowed errors), **`services/gap_intelligence_news.py`** global + per-ticker Polygon news merge, **`POST /v1/scanner/gap-intelligence`**, structured **`POST /v1/signals/day/briefing`** / **`POST /v1/scanner/briefing`**, **`POST /v1/signals/swing/composite`** returns **`status: insufficient_data`** (HTTP 200) when fewer than three layers have scores and are not unavailable — no composite record or alert, journal **`GET /v1/journal/analytics`** + entry by id + PATCH notes, auth, `legal_copy.py`, order safety integration), **`utils/log_privacy.py`**.

**Frontend (`frontend/`)**  
App router pages (dashboard **`layout.tsx`** wraps routes with **legal acknowledgment** + **onboarding** gate; incl. **`/dashboard/performance`**, scanner (**`/dashboard/scanner`** server page: **`fetchDefaultWatchlistSymbols`** in parallel with **`fetchPdtStatus`**, then **`fetchScannerOverview(..., watchlistSymbols)`**), **`/dashboard/watchlists`**, signals with **Signal history** tab (BFF history + record fetch) + **`POST /api/stocvest/signals/swing-composite`** check for **`insufficient_data`** (amber “Market Data Unavailable” callout when fewer than three layers have live scores); **`hasValidSignal`** now hides stale AI/radar/reference/evidence when status is insufficient and clears signal state; closed-session insufficient path renders **`components/signals-after-hours-panel.tsx`** with last-session levels/news/watchlist CTA; portfolio, **journal** with analytics + cumulative P&amp;L + trade table, settings (**Alert Preferences** + `#alerts`), earnings, public `/performance`, terms, etc.), **landing** (server **`app/page.tsx`** fetches **`GET /v1/signals/recent?landing=true`** + performance summary with **30m** revalidate; **`landing-signals.ts`** + **`FALLBACK_SIGNALS`** (marketing-only examples, **5** rows with ET wall-clock **`generated_at`**, incl. one **incorrect** demo outcome), **`LandingSignalExplorer`** (dynamic 1h % from prices; “(example data)” when API empty), **`LandingBeforeAfterSection`**, **`LandingActivityFeedSection`** (empty states + accuracy copy), `LandingHowItWorksSection`, `LandingPerformanceSection` + optional **`pattern_breakdown`**; shared glow card utilities in **`app/globals.css`** (`.landing-glow-card`, gate/pledge/before-after variants); marketing cards on **`landing-page.tsx`**; no client polling on `/`), design system + theme, API clients under `lib/api/` (incl. **`watchlists.ts`** default symbols fetch, **`public-signals.ts`**, **`swing-composite.ts`**, client-safe **`fetch-symbol-snapshot.ts`**), **`lib/snapshot-reference-levels.ts`** (same **5×** + valid-last guard as backend), BFF **`POST /api/stocvest/journal/entries`**, **`GET`/`PATCH /api/stocvest/users/me`**, **`/api/stocvest/watchlists/**`**, **`/api/stocvest/alerts/**`**, **`/api/stocvest/signals/swing-composite`**, **`/api/stocvest/signals/me/history`**, **`/api/stocvest/signals/me/records/[signalId]`**, **`add-to-watchlist-button`** on signals + gap cards, Crisp when `NEXT_PUBLIC_CRISP_WEBSITE_ID` is set. **Sign out** redirects to **`/`** (landing). Scanner: **`fetchScannerOverview`** uses **`POST /v1/scanner/gap-intelligence`**, **`POST /v1/signals/day/setups`** (with snapshots + regime for confluence), structured **`POST /v1/signals/day/briefing`** (context includes gap items + intraday setups); intraday setup cards, signal evidence modal, gap cards, and dashboard morning brief show **confluence** when `is_confluence_alert`; **Open order entry** deep-links to **`/dashboard/portfolio`** with symbol + optional signal query params.

**Docs**  
`docs/API_CONTRACTS.md` — HTTP + broker contracts. **`docs/BACKLOG.md`** — detailed planned work (no duplicate of this file’s status tables). **`docs/DEPLOYMENT.md`** — SES / email alert setup for production. **Detailed file-by-file history was removed from this file** to avoid drift; use README + git.

**Public signal API (trust)**  
`GET /v1/signals/recent` (last **50** public `SignalRecord` rows as JSON array when `landing` is absent; **`?landing=true`** returns **`{ "items": [...] }`** with up to **5** rows where **`outcome_1h`** is set — allowlisted fields for marketing only, **`ai_summary`** truncated to **120** chars), `GET /v1/signals/performance/summary` — directional accuracy from **1d** outcomes; JSON **`correct_direction_count`**, **`incorrect_direction_count`**, **`neutral_direction_count`** (and related totals); accuracy = correct ÷ (correct + incorrect). Authenticated **`GET /v1/signals/me/history`** and per-id **`GET /v1/signals/me/records/{signal_id}`** for user-scoped rows. Responses use `signal_strength`, `disclaimer`, etc. (see Legal section).

---

## 3. Pending (near-term ops / engineering)

**Deploy checklist (after you push to `main`):** GitHub Actions runs tests, then **`deploy-lambda`** (zip → S3 → `update-function-code` for every `stocvest-development-api-*` module, including **`signal_resolution`**) and optionally **`deploy-vercel`** (production deploy hook). Full secret/variable names and IAM needs: [root `README.md` § CI/CD](../README.md#cicd-github-actions).

| Step | Action |
|------|--------|
| 1 | **Terraform:** `cd infra && terraform apply` for the target env so DynamoDB (incl. **`SignalHistory`**, **`TradeJournal`**, **`PDTState`**), **every** `api_handler_modules` Lambda (incl. **`signal_resolution`** → name `stocvest-development-api-signal_resolution`), API Gateway, and Lambda env exist. CI updates **code** only (`update-function-code`); it does **not** create functions. If Actions fails with `ResourceNotFoundException` for that name, apply Terraform **before** re-running deploy. |
| 2 | **GitHub:** Repository **variable** `STOCVEST_LAMBDA_S3_BUCKET`; **secrets** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`; optional `VERCEL_DEPLOY_HOOK_URL`. |
| 3 | **Push `main`:** Open **Actions** → confirm backend, frontend, `deploy-lambda`, and `deploy-vercel` (or skip if hook unset). |
| 4 | **Smoke:** `GET /v1/health` on the HTTP API base URL; optional `GET /v1/signals/recent` if D1 table is applied. |
| 5 | **Scheduled resolution — APPLIED ✅** **`terraform apply -var-file=terraform.tfvars -input=false -auto-approve`** completed **2026-05-03** (**19 added, 14 changed, 2 destroyed**). Rule **`stocvest-signal-resolution`**: **`ENABLED`**, **`rate(30 minutes)`**, target **`stocvest-development-api-signal_resolution`**. Details: [`docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md`](./D1_SIGNAL_RESOLUTION_SCHEDULE.md). |

1. **Infrastructure:** Same as checklist rows 1–2; keep API Gateway URLs and Cognito/Vercel env aligned with the deployed stage.
2. **Broker runtime:** IBKR path needs ECS/Fargate + TWS/ibeam where applicable; E*TRADE OAuth is wired in app but production tokens/env must match deployment.
3. **CI hardening (if not done):** setuptools upgrade in CI before `pip install -e .`; optional skip for Vercel deploy when hook secret missing.
4. **Legal / launch:** Terms at `/terms` are a **draft** — attorney review before paid subscribers; **mandatory legal acknowledgment (B2)** is implemented before dashboard use; optional onboarding wizard remains dismissible per session until completed.

---

## 4. Legal compliance (product & API)

- STOCVEST is **not** a registered investment adviser; frame as **signal intelligence** and data tooling.
- **UI:** Prefer signal summary, signal strength, reference levels, signal parameters—not “verdict,” “recommendation,” “you should,” or “confidence” in **signal** context.
- **`SignalDisclaimerChip`** on signal cards; **`GlobalDisclaimer`** last in `<body>` in root layout.
- **Performance page:** Directional accuracy only; not dollar P&L as “signal performance.”
- **Serialized API:** Use `signal_summary` / `signal_strength` (and related names) where applicable; include `disclaimer`: *Signal data for informational purposes only. Not investment advice.*
- **Logging / persistence:** Sanitize user-supplied free text before Dynamo (`text_sanitize`); keep CloudWatch logs free of unnecessary PII (`log_privacy`). Server-side identity for journal and protected routes comes from the **JWT**, not from client-supplied `user_id` body fields.

---

## 5. Roadmap & backlog

**Full prioritized themes, sub-tasks, and IDs:** [`docs/BACKLOG.md`](./BACKLOG.md) — **single source** for planned work so this file stays short.

**Directional summary:** After infra/broker production readiness (`§3`), focus shifts to **subscriptions**, **sector/internals**, **D2 backtesting / analytics**, **Phase 7 hardening**, and the post-beta **trade brief** UI (`BACKLOG.md` sections B, D, P, G, M, T). **D1** signal outcomes, **B1** journal automation, **B2** onboarding + legal acknowledgment, **B3** alerts (email), and **B4** watchlists are shipped (see status table). **B13** (SMS) remains pending until phone collection is ready.

---

## 6. Key decisions (unchanged summary)

1. Stack: Next.js (Vercel) + Python Lambdas (AWS).  
2. Brokers: IBKR (TWS / ib_insync) + E*TRADE (OAuth REST).  
3. Market data: Polygon.io (stocks advanced + options + crypto tiers as configured).  
4. Multi-tenant isolation end-to-end.  
5. Asset scope: stocks, ETFs, options, futures, crypto (scope varies by data source).  
6. Six signal layers: Technical, News, Macro, Sector, Geopolitical, Internals.  
7. AI: Claude (Sonnet) → structured JSON for synthesis; **public APIs use compliance field names** (`signal_summary`, `signal_strength`, …).  
8. Domain: **stocvest.app**.  
9. Day trading: Phase 2.5 scanner + PDT tracker are first-class.  
10. Benzinga: skipped; Polygon + Claude sufficient.

---

## 7. Immutable contracts

Do **not** change without discussion and coordinated updates:

- **`BrokerAdapter`** — eight methods, types, exceptions (`docs/API_CONTRACTS.md` §1).  
- **HTTP paths** — versioned under `/v1/`; breaking changes need `/v2/` or migration.  
- **DynamoDB table names** — `Users`, `BrokerConnections`, `Watchlists`, `Alerts`, `Orders`, **`SignalHistory`**, **`TradeJournal`**, **`PDTState`**, etc.  
- **Secrets path** — `/stocvest/{userId}/brokers/{brokerId}`.  
- **Canonical types** — `stocvest/data/models.py` (no raw Polygon dicts in core logic).

Signal **layer enums** and internal composite types are stable; **customer-facing** naming follows the Legal section above.

---

## 8. Known issues / technical debt

- `pyproject.toml` / setuptools: may need `pip install setuptools --upgrade` before editable install on some machines.  
- PDT rolling window is weekday-based; exchange holidays not modeled—align with broker if needed.  
- Stochastic implementation has a small style debt (not correctness).

---

## 9. Open questions

- **AWS account model:** dedicated org account vs existing (confirm for production).  
- **Crypto on-chain metrics:** deferred.  
- **E*TRADE / IBKR production:** credentials, redirect URLs, and ECS capacity for TWS.

---

## 10. Development environment

```bash
python -m venv .venv
pip install -e ".[dev]"
cp .env.example .env   # fill Polygon, Claude, etc.
pytest tests/ -q
```

Frontend: `cd frontend && npm ci && npm run build && npm run test`

---

## 11. Cost picture (approximate / year)

| Item | ~USD/yr | Purpose |
|------|---------|---------|
| Polygon (stocks + options + crypto tiers) | ~2.7k | Market data |
| IBKR | $0 (account) | Execution, futures, L2 |
| Claude | ~200–600 | Synthesis |
| Vercel + AWS + domain | varies | Hosting + compute |

---

## 12. Day-trading scan rhythm (reference)

- **Pre-market:** gap + catalyst scan → ranked candidates.  
- **RTH:** intraday setup scanner (~5 min cadence per design), VWAP/OR/EMA logic in engine.  
- **PDT:** warn at 2 day trades, block at 3 (non-exempt) in rolling window.

---

## 13. Session rules

### Before writing any code

1. Read `docs/CONTEXT.md` and `docs/BACKLOG.md` in full.
2. Confirm exact test counts:
   - Run: `pytest tests/ -q`
   - Run: `cd frontend && npm run test`
   - Record actual numbers — do not use “~” approximations.
   - If counts are **lower** than the baseline in **§13 Test baseline** (and the summary line under the document title), stop and report the regression before doing anything else.
3. Do not implement anything already marked ✅ in §1.
4. Do not implement anything not in `BACKLOG.md` without flagging it to the user first.
5. Do not change any contract in `docs/API_CONTRACTS.md` without explicit instruction.

### Every prompt must end with ALL of these steps

 **STEP 1 — Tests**  
Run `pytest tests/ -q`  
Run `cd frontend && npm run test`  
Run `cd frontend && npm run build`  
Report exact counts. If any count dropped, fix before proceeding to documentation updates.

**STEP 2 — Update `docs/CONTEXT.md`**  
- §1 Status table: mark completed tracks ✅; update Notes if anything changed.  
- §2 Implemented: add new files/modules built this session.  
- §3 Pending: remove items that are now resolved; add new blockers discovered this session.  
- §13 Test baseline: update exact backend and frontend test counts (and note if `npm run build` was verified).  
- Document title summary line: keep test baseline in sync with §13.  
- **Last updated** date: set to today.

**STEP 3 — Update `docs/BACKLOG.md`**  
- Items completed this session: change status to **DONE**; add: `Done YYYY-MM-DD · commit: <hash>`.  
- Items discovered this session: add with new ID, description, and acceptance criteria.  
- Items in progress but not finished: change status to **In progress**.  
- **Do not delete any row — ever.**  
- **Last updated** date.

**STEP 4 — Commit**  
- Stage: all code + `docs/CONTEXT.md` + `docs/BACKLOG.md` together.  
- Message format (required):  
  `"<feature> | backend: <N> tests | frontend: <N> tests"`  
  where **backend N** = pytest **passed** count and **frontend N** = Vitest **passed** count (from the respective summaries).  
  Example:  
  `"B2 onboarding wizard | backend: 468 tests | frontend: 50 tests"`  
- Never commit code without committing updated docs.  
- Never commit docs without committing the code they describe.

### What goes where — hard rules

| Content type | File | Rule |
|--------------|------|------|
| What is built and working | CONTEXT.md §1–2 | Reality only |
| Near-term blockers & ops | CONTEXT.md §3 | Keep current; not duplicated in BACKLOG |
| Planned work & acceptance notes | BACKLOG.md | Full detail; **never delete rows** (mark DONE + date + commit) |
| HTTP & broker contracts | API_CONTRACTS.md | Change only with explicit instruction |
| Legal framing (copy & public API) | CONTEXT.md §4 | Align product language and payloads |

### Test baseline (exact counts — update after every verified run)

| Suite | Command | Last verified |
|-------|---------|---------------|
| Backend | `pytest tests/ -q` | **525 passed**, **3 skipped** |
| Frontend tests | `cd frontend && npm run test` | **56 passed** (19 files) |
| Frontend build | `cd frontend && npm run build` | **success** |

---

## 14. Appendix: Business / entity (high level)

- Entity target: **STOCVEST LLC** (Delaware); formation and Stripe Atlas items **track outside this doc**.  
- **What STOCVEST is:** signal intelligence + execution tooling; user keeps custody via their broker.  
- **What it is not:** RIA, broker-dealer, custodian, fund manager.  
- Before **paid** users: attorney-reviewed ToS/Privacy, LLC, Stripe, production infra.
