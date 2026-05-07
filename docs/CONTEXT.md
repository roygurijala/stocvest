# STOCVEST — Session Context

**Read this file at the start of each session.** It summarizes what exists, what is pending, and what is planned—without duplicating the whole repo tree.

**Cursor AI rules** for agents live in **`.cursorrules`** at the repo root (see **`docs/CURSOR_RULES.md`** for a short pointer—do not duplicate the full rules there).

**Last updated:** 2026-05-07  
**Repo:** https://github.com/roygurijala/stocvest  
**Test baseline (regression gate — must match §13):** Backend `pytest tests/ -q` → **757 passed**, **3 skipped**. Frontend `npm run test` → **123 passed** (29 test files). **`npm run build`** last verified: success.

---

## 1. Status at a glance

| Track | Status | Notes |
|--------|--------|--------|
| Core data + indicators | ✅ | Polygon client, `stocvest/indicators/` |
| Swing + day-trading signals | ✅ | `stocvest/signals/` (layers, scanner, briefing, journal engine, PDT tracker); **swing vs day composite** — same six layers; `SwingTechnicalAnalyzer` + daily bars; `POST /v1/signals/composite/swing`; dashboard **Day trade / Swing trade** toggle (`localStorage` `stocvest_trading_mode`) |
| Brokers | ✅ | Mock, IBKR, E*TRADE adapters; factory; PDT hook |
| HTTP API (Lambdas) | ✅ | Market, **signals** (HTTP submodule + public/user record routes + **`GET /v1/signals/founding-members`** paid-plan counter for landing + **model portfolio** `GET/POST /v1/portfolio/*` on signals Lambda), brokers, portfolio, scanner, journal, PDT, orders, auth; **`UserProfile` beta override** (`beta_full_access`, `beta_access_until`, `beta_access_granted_at`) with **`has_full_access`** / **`has_ai_explanations`**; admin **`PATCH /v1/admin/users/{user_id}/beta-access`** (same auth as signal analysis); **`PATCH /v1/users/me`** blocks client writes to subscription + beta fields; **HTTP audit capture** — `audit_capture.py` + `audit_store.py` (DynamoDB when **`DYNAMODB_AUDIT_EVENTS_TABLE`** set, else in-memory), `_with_cors_and_audit` on HTTP dispatch; admin **`GET /v1/admin/audit/users/{user_id}`** and **`GET /v1/admin/audit/sessions/{session_id}`**; clients may send **`x-stocvest-session-id`** for session-scoped replay; journal `user_id` from JWT only; free-text **`text_sanitize`**; **`log_privacy`** for CloudWatch-safe logs |
| Frontend (Next.js) | ✅ | Auth, dashboard redesign, **Gap Intelligence** scanner panel + **morning brief** on scanner paths when enabled (not on home dashboard); scanner/signals/**watchlists**/portfolio/journal/options/crypto/futures, **public landing** (`landing-page.tsx` / `app/page.tsx` — hero, day vs swing modes, live engine **SWING/DAY** tabs, differentiation, workflows, transparency, comparison, yesterday’s signals, pricing + **founding-member** scarcity from **`GET /v1/signals/founding-members`** via **`lib/api/founding-members.ts`**, footer; no home-dashboard morning brief), legal pages; **`/portfolio`** signal-tracking page (notional model portfolio, disclaimers); BFF **`/api/stocvest/signals/**`** + **`/api/stocvest/portfolio/**`** (swing composite, **`composite/real`**, user history, record by id); **signals page** uses server **`composite/real`** for layer scores (no client `bullishBias` heuristic); **after-hours research panel** (`signals-after-hours-panel.tsx`) for closed-market insufficient-data states; **compact PDT status pill** beside Market/VIX (`pdt-status-pill.tsx`); **Market Pulse** strip (SPY/QQQ/VIX + regime from scanner overview) replaces the embedded **Market Intelligence** headline grid; **on-demand `NewsPanel`** (`news-panel.tsx`) — fetch on open, per-symbol **2m** client cache, wired from dashboard signal cards, evidence (incl. “View all news”), signals page; **`vercel.json`** security headers (+ HSTS on **stocvest.app**) |
| Journal automation (B1) | ✅ | `journal_order_hooks` on order submit (open/close rows, optional signal fields), `GET /v1/journal/analytics`, entry GET/PATCH, journal UI + scanner → portfolio order prefill |
| Onboarding + legal acknowledgment (B2) | ✅ | `UserProfile` legal + onboarding fields; `GET`/`PATCH /v1/users/me`; mandatory **legal acknowledgment modal** + optional **onboarding wizard** on `app/dashboard/layout.tsx`; BFF `/api/stocvest/users/me` |
| Order safety (Step 8) | ✅ | `order_safety.py`, validate/submit BFF, confirmation modal, paper/live mode |
| **Watchlists (B4)** | ✅ | `stocvest/data/watchlist_store.py` (**`scan_default_watchlists`**, **`find_users_with_default_watchlist_symbol`** for scheduled jobs only), `scan_symbols.get_scan_symbols`, `GET`/`POST`/`PATCH`/`DELETE` watchlists + default symbols API (brokers Lambda), dashboard **Watchlists** page, BFF `/api/stocvest/watchlists/**`, **dashboard scanner** loads default symbols in parallel with PDT and passes them into **`fetchScannerOverview`** / **`loadScannerDataWithoutBrief`**; scanner gap path defers Dynamo until Polygon 401/403 fallback; **B14** scheduled scan merges platform default-watchlist symbols (cap 30) + config + **`SYSTEM_DEFAULTS`** (cap 40 total); **`watchlist_scanner_alerts`** + **`UserProfile.email`** (optional Dynamo mirror) for best-effort signal emails within **2s** `asyncio.wait_for` + **4h** dedupe via **`had_signal_email_for_symbol_within_hours`** |
| **Alerts email (B3)** | ✅ | `stocvest/data/models.py` alert enums + prefs/record, `alert_store.py`, `stocvest/services/email_service.py` (SES), `alert_trigger.py`, `GET`/`PATCH /v1/alerts/preferences`, `GET /v1/alerts/history`, non-blocking signal + PDT emails; settings **Alert Preferences** + `docs/DEPLOYMENT.md` SES notes; Lambda IAM `ses:SendEmail` |
| Legal compliance pass | ✅ | `GlobalDisclaimer`, `SignalDisclaimerChip`, signal-oriented copy, public API field names + `disclaimer` |
| D1 Signal outcome pipeline | ✅ | `SignalRecord` / `SignalHistory`, `signal_recorder` (record + **`resolve_signals`** using Polygon **1m aggregates** at T+1h and next RTH 4:00 PM ET close for 1d via **`get_evaluated_price_after_signal`**), `GET /v1/signals/recent` + performance summary (**`correct_direction_count`** / **`incorrect_direction_count`** / **`neutral_direction_count`**), **`GET /v1/signals/records/{id}`**, **`GET /v1/signals/me/history`**, **`GET /v1/signals/me/records/{id}`**; resolution Lambda + EventBridge **`stocvest-signal-resolution`** **`ENABLED`**, **`rate(30 minutes)`** → **`stocvest-development-api-signal_resolution`**. Apply **2026-05-03** (see `docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md`). **Optional later:** weekly horizon, extra analytics. |
| News ingestion pipeline | ✅ | **Combined** Benzinga WebSocket + SEC EDGAR 8-K feed in one worker: `stocvest/data/edgar_client.py`, `stocvest/data/news_triage.py`, `stocvest/workers/news_worker.py`, `stocvest/workers/news_consumer_lambda.py`; SQS queue `stocvest-news-triage-queue`; EDGAR filings map into canonical `NewsArticle`; Lambda consumer scores pre-triaged articles with Claude and best-effort pushes scored rows to Redis. |
| Terraform / AWS apply | 🚧 | **Development** now includes the news SQS/Lambda pipeline in `infra/` plus **`AuditEvents`** DynamoDB, **`DYNAMODB_AUDIT_EVENTS_TABLE`** on API Lambdas, and API Gateway routes for **`GET /v1/signals/founding-members`** and admin **beta** / **audit** paths (apply to create/update). **Still pending for always-on ECS runtime:** publish a worker image and set `news_worker_container_image` / `news_worker_desired_count` so the Fargate service is actually created; also keep production/stage promotion, secret rotation, S3 artifact bucket policy review, and Cognito/Vercel env alignment in sync per environment. |
| Phase 7 (E2E, audits, paper validation) | 🚧 | **HTTP/API audit trail to DynamoDB** (`AuditEvents`, redacted summaries) + admin query routes shipped; E2E suite, security review, load tests, extended paper validation still open (**BACKLOG P1**) |

---

## 2. Implemented (where to look)

**Backend (`stocvest/`)**  
**Also shipped:** **`AuditEvent`** + **`api/services/audit_store.py`** / **`api/services/audit_capture.py`** (writes when **`DYNAMODB_AUDIT_EVENTS_TABLE`** is set); **`get_founding_member_count`** + **`GET /v1/signals/founding-members`** (counts **paid** `swing_pro` / `swing_day_pro` / legacy `founding_*` only; **free** rows never increment the shared “first **100**” pool); admin **`PATCH /v1/admin/users/{user_id}/beta-access`** + audit query routes in **`orders.py`**; **`scripts/beta_access.py`**. **Tests:** **`tests/api/test_audit_capture.py`**, **`tests/api/test_user_profile_plan.py`**, **`tests/api/test_users_me.py`**. **Reliability pass:** `stocvest/data/benzinga_client.py`, `stocvest/data/ticker_name_resolver.py`, and `stocvest/workers/geo_themes_updater.py`; composite engines now merge Benzinga data, `NewsAnalyzer` returns neutral available states (not unavailable) for no-news windows, and `GeoAnalyzer` includes structural baseline + cached daily themes.  
`data/` (models incl. **`UserProfile`** legal/onboarding + optional **`email`** + **beta** fields (Dynamo mirror for scheduled alert delivery), **`SignalRecord`** (optional per-layer **JSON snapshot** columns + **`parameter_version`** for tuning; **`status`** `active` \| `incomplete` for incomplete reference-level payloads), **`AlertPreferences`** / **`AlertRecord`** / **`AlertType`**, **`EconomicCalendarEvent`**, **`watchlist_store`** + **`alert_store`**, **`edgar_client.py`** (SEC 8-K Atom polling + CIK→ticker cache + `EdgarFiling` → `NewsArticle` mapping), **`news_triage.py`** (high-signal keyword/category/watchlist gate + duplicate suppression), Polygon — snapshot parser may drop `day` OHLC/VWAP vs **`lastTrade.p`** only when last is a positive price and any session field is **>5×** off; missing last keeps session bar; **`get_evaluated_price_after_signal`** for D1 bar-based outcomes; **`get_economic_calendar_for_day`** on Benzinga economics when tier allows; **`BenzingaNewsStream`** in `polygon_client.py` for long-lived websocket ingestion), `indicators/`, `signals/` (sentiment, macro, geo, composite, **real layer analyzers** — `technical_analyzer`, **`swing_technical_analyzer`** (daily SMA/MACD/base/volume regime), `news_analyzer`, `macro_analyzer`, `sector_analyzer`, `sector_mapper`, `geo_analyzer`, `internals_analyzer`; **`confluence`** normalization helpers + multi-signal alignment in `confluence.py`, **`gap_intelligence`** + dynamic news lookback + **`news_catalyst_detector`** listicle-aware noise + company-name headline fallback, **`morning_brief`**, **`trade_journal`** + **`compute_journal_analytics`**, briefing markdown generator still in `daily_briefing.py` for legacy tests), `brokers/` (adapters, gateways, OAuth), **`services/email_service.py`**, **`services/alert_trigger.py`**, **`api/services/watchlist_scanner_alerts.py`** (scheduled intraday/EOD setup → watchlist user email; **4h** dedupe), **`api/services/news_relevance.py`** (**`calculate_article_relevance`**, **`categorize_article`**, **`deduplicate_articles`**, **`source_credibility_meta`** — dashboard headline ranking; distinct from composite **`news_analyzer`** filter), **`api/services/news_quality_filter.py`** (**`passes_market_intelligence_gate`** for `/v1/market/news` pool vs **`is_quality_article`** for analyzers), **`api/services/news_panel_format.py`** (panel **`age_label`**, source bucket + **`source_label`**, sentiment score/label, catalyst type for ticker news), `api/` (handlers incl. **`news_handler`** in **`market_data.py`** — **without `symbol`:** Polygon news limit **50**, **4h** lookback (**24h** widen when empty), merged liquid + watchlist tickers (cap **30**), relevance sort + topic dedupe, response **`{ "headlines": [...] }`** with at most **`min(limit, 20)`** rows (`limit` query **1–1000**), full headline fields incl. **`category`**, **`catalyst_category`**, **`relevance_score`**, **`credibility`**, **`matches_watchlist`**; **with `symbol`:** query **`days`** **1–20** (default **20**), **`limit`** **1–100**, rolling Polygon window, response **`{ "symbol", "articles", "has_recent_news", "recent_cutoff_hours", "total_found", "oldest_included" }`** with lean panel items (**`source`**, **`source_label`**, **`sentiment_score`**, **`sentiment_label`**, **`catalyst_type`**, **`is_recent`**, **`age_label`**, **`url`**); **`signal_resolution`**, **`signals`** → **`signals_http_dispatch`** for signal HTTP surface with **dynamic per-layer `reasoning`** in composite `contributions`, **`GET /v1/signals/analysis`** admin/internal tuning aggregate, **`watchlists`**, **`alerts`**, **`GET`/`PATCH /v1/users/me`**, **`text_sanitize.py`**, **`services/signal_recorder.py`** (public lists exclude **`incomplete`** rows), **`services/composite_market_context.py`** (Polygon market status for swing composite insufficient-data responses), **`services/morning_brief_fetch.py`** (VIX via **`get_vix_snapshot_with_fallback`** / **`VIX_SNAPSHOT_FALLBACK_SYMBOLS`**), **`services/scanner_scheduled_pipeline.py`** (platform watchlist symbol merge + notify + optional **`run_portfolio_composite`** portfolio pass), **`services/journal_order_hooks.py`** (auto journal on fill/close; swallowed errors), **`services/gap_intelligence_news.py`** global + per-ticker Polygon news merge, **`POST /v1/scanner/gap-intelligence`**, structured **`POST /v1/signals/day/briefing`** / **`POST /v1/scanner/briefing`**, **`POST /v1/signals/swing/composite`** (client-supplied layer scores) and **`POST /v1/signals/composite/real`** (intraday bars, server-side layers via `real_composite_engine.py`) and **`POST /v1/signals/composite/swing`** (`swing_composite_engine.py`, daily bars, extended news/macro/geo windows) return **`status: insufficient_data`** (HTTP 200) when fewer than three layers are available — no composite record or alert; **`lambda_dispatch.py`** now routes SQS news-consumer events; **`workers/news_worker.py`** is the long-running ECS entrypoint and **`workers/news_consumer_lambda.py`** is the SQS-triggered Claude scoring consumer; journal **`GET /v1/journal/analytics`** + entry by id + PATCH notes, auth, `legal_copy.py`, order safety integration), **`utils/log_privacy.py`**. **`composite_score.py`**: layer/verdict contradiction penalty, **`alignment_ratio`**, **`conflicted_layers`**; **`swing_composite_evidence.py`**: reference-level completeness, R/R quality + warning, catalyst headline pass-through, derived **`risk_factors`** / **`risk_factors_detailed`**; **`user_profile_store`**: lazy singleton (no boto3 on handler import); **`tests/conftest.py`**: Windows **`platform.uname()`** prime to avoid botocore/WMI stderr noise with Python 3.14. **Tests:** **`tests/api/test_article_relevance.py`**, **`tests/services/test_news_relevance.py`**, **`tests/api/services/test_news_panel_format.py`**, **`tests/api/handlers/test_market_data.py`**, **`tests/data/test_edgar_client.py`**, **`tests/data/test_news_triage.py`**, **`tests/signals/test_composite_scorer.py`**, **`tests/signals/test_signal_validation.py`**, **`tests/signals/test_risk_reward.py`**, **`tests/signals/test_catalyst_headlines.py`**, **`tests/signals/test_risk_factors.py`**. **Model portfolio (signal tracking):** DynamoDB **`ModelPortfolio`** (`DYNAMODB_MODEL_PORTFOLIO_TABLE`), `portfolio_recorder.py`, **`portfolio_reversal.py`**, public **`GET /v1/portfolio/summary`**, **`GET /v1/portfolio/positions/open`**, **`GET /v1/portfolio/positions/history`**, **`GET /v1/portfolio/performance`**, internal-header **`POST /v1/portfolio/positions/open|close`** (same auth pattern as signal analysis); auto-log from **`composite/real`** when bullish composite maps to **≥72** on the 0–100 display scale and macro regime ≠ **`avoid`** (background thread); **`signal_resolution`** Lambda runs **D1** resolution ticks plus **stop/target/time** on open rows; **`stocvest_job`=`portfolio_reversal`** uses **EventBridge Scheduler** (`America/New_York`, `infra/eventbridge_scheduler_6g.tf`); **`scanner_scheduled_pipeline`** may run **`run_portfolio_scanner_for_symbol`** after scheduled gap/setups when event **`run_portfolio_composite`** is true (Terraform: premarket + intraday morning); real/swing composite engines support **`enable_portfolio_log`** for portfolio-scanner diagnostics; UI **`/portfolio`** + sidebar **Signal portfolio**; BFF under **`/api/stocvest/portfolio/**`**; script **`scripts/portfolio_status.py`**.

**Frontend (`frontend/`)**  
App router pages (dashboard **`layout.tsx`** wraps routes with **legal acknowledgment** + **onboarding** gate; **`dashboard-page-content.tsx`** uses time-bounded **`fetchMarketOverview`** / scanner / earnings loads so the shell is not blocked by a slow BFF; incl. **`/dashboard/performance`**, scanner (**`/dashboard/scanner`** server page: **`fetchDefaultWatchlistSymbols`** in parallel with **`fetchPdtStatus`**, then **`fetchScannerOverview(..., watchlistSymbols)`**), **`/dashboard/watchlists`**, signals with **Signal history** tab (BFF history + record fetch) + **`POST /api/stocvest/signals/composite/real`** or **`/api/stocvest/signals/composite/swing`** per **Day trade / Swing trade** toggle (and legacy **`swing-composite`**) check for **`insufficient_data`** (amber “Market Data Unavailable” callout when fewer than three layers have live scores); **`hasValidSignal`** now hides stale AI/radar/reference/evidence when status is insufficient and clears signal state; closed-session insufficient path renders **`components/signals-after-hours-panel.tsx`** with last-session levels/news/watchlist CTA; portfolio, **journal** with analytics + cumulative P&amp;L + trade table, settings (**Alert Preferences** + `#alerts`), earnings, public `/performance`, terms, etc.), **landing** (server **`app/page.tsx`** runs **`Promise.all`**: **`GET /v1/signals/recent?landing=true`**, performance summary, **`getFoundingMemberCount`** → **`GET /v1/signals/founding-members`** with **30m** revalidate; **`landing-signals.ts`** + **`FALLBACK_SIGNALS`** (marketing-only examples, **5** rows with ET wall-clock **`generated_at`**, incl. one **incorrect** demo outcome), **`LandingSignalExplorer`** (dynamic 1h % from prices; “(example data)” when API empty), **`LandingBeforeAfterSection`**, **`LandingActivityFeedSection`** (empty states + accuracy copy), `LandingHowItWorksSection`, `LandingPerformanceSection` + optional **`pattern_breakdown`**; shared glow card utilities in **`app/globals.css`** (`.landing-glow-card`, gate/pledge/before-after variants); marketing cards on **`landing-page.tsx`**; no client polling on `/`), design system + theme, API clients under `lib/api/` (incl. **`client.ts`** default **`apiFetch`** timeout; **`market.ts`** — **`fetchMarketOverview`** loads market status + indices only (no `/v1/market/news`); **`ticker-news-panel.ts`** + **`panel-article-to-news-payload.ts`** for **`GET /v1/market/news?symbol=`**; **`fetch-symbol-news.ts`** uses the panel API; **`watchlists.ts`** default symbols fetch, **`public-signals.ts`**, **`swing-composite.ts`**, client-safe **`fetch-symbol-snapshot.ts`**), **`lib/signal-evidence.ts`** + **`signal-evidence-card.tsx`** (R/R warning styling, incomplete-levels messaging, catalyst/risk empty copy), **`lib/snapshot-reference-levels.ts`** (same **5×** + valid-last guard as backend), **`components/pdt-status-pill.tsx`**, **`components/dashboard-redesign.tsx`** (PDT pill + **Market Pulse**; morning brief + signal-card **News** affordances + **`NewsPanel`**), **`components/news-panel.tsx`**, **`components/news-headline-drawer.tsx`** (credibility + relevance line), BFF **`POST /api/stocvest/journal/entries`**, **`GET`/`PATCH /api/stocvest/users/me`**, **`/api/stocvest/watchlists/**`**, **`/api/stocvest/alerts/**`**, **`/api/stocvest/signals/swing-composite`**, **`/api/stocvest/signals/me/history`**, **`/api/stocvest/signals/me/records/[signalId]`**, **`add-to-watchlist-button`** on signals + gap cards, Crisp when `NEXT_PUBLIC_CRISP_WEBSITE_ID` is set. **Sign out** redirects to **`/`** (landing). Scanner: **`fetchScannerOverview`** uses **`POST /v1/scanner/gap-intelligence`**, **`POST /v1/signals/day/setups`** (with snapshots + regime for confluence), structured **`POST /v1/signals/day/briefing`** (context includes gap items + intraday setups); intraday setup cards, signal evidence modal, gap cards, and dashboard morning brief show **confluence** when `is_confluence_alert`; **Open order entry** deep-links to **`/dashboard/portfolio`** with symbol + optional signal query params.

**Docs**  
`docs/API_CONTRACTS.md` — HTTP + broker contracts. **`docs/BACKLOG.md`** — detailed planned work (no duplicate of this file’s status tables). **`docs/SIGNAL_ENGINE.md`** — real composite + layer contracts/limitations. **`docs/DEPLOYMENT.md`** — SES / email alert setup for production. **`docs/TUNING_PLAYBOOK.md`** — monthly signal-parameter review using **`GET /v1/signals/analysis`** and Secrets **`stocvest/signal-parameters`**. **DynamoDB `ParameterHistory`** (Terraform) stores versioned parameter JSON + audit fields. **Detailed file-by-file history was removed from this file** to avoid drift; use README + git.

**Public signal API (trust)**  
`GET /v1/signals/recent` (last **50** public `SignalRecord` rows as JSON array when `landing` is absent; **`?landing=true`** returns **`{ "items": [...] }`** with up to **5** rows where **`outcome_1h`** is set — allowlisted fields for marketing only, **`ai_summary`** truncated to **120** chars), `GET /v1/signals/performance/summary` — directional accuracy from **1d** outcomes; JSON **`correct_direction_count`**, **`incorrect_direction_count`**, **`neutral_direction_count`** (and related totals); accuracy = correct ÷ (correct + incorrect). **`GET /v1/signals/founding-members`** — public JSON **`founding_member_count`**, **`founding_spots_total`** (**100**), **`founding_spots_remaining`** (paid subscribers only; see **§1** HTTP row). Authenticated **`GET /v1/signals/me/history`** and per-id **`GET /v1/signals/me/records/{signal_id}`** for user-scoped rows. Responses use `signal_strength`, `disclaimer`, etc. (see Legal section).

---

## 3. Pending (near-term ops / engineering)

**Deploy checklist (after you push to `main`):** GitHub Actions runs tests, then **`deploy-lambda`** (zip → S3 → `update-function-code` for every `stocvest-development-api-*` module, including **`signal_resolution`**) and optionally **`deploy-vercel`** (production deploy hook). Full secret/variable names and IAM needs: [root `README.md` § CI/CD](../README.md#cicd-github-actions).

| Step | Action |
|------|--------|
| 1 | **Terraform:** `cd infra && terraform apply` for the target env so DynamoDB (incl. **`SignalHistory`**, **`TradeJournal`**, **`PDTState`**, **`AuditEvents`**, …), **every** `api_handler_modules` Lambda (incl. **`signal_resolution`** → name `stocvest-development-api-signal_resolution`), API Gateway (incl. **`GET /v1/signals/founding-members`**, admin **beta** / **audit** routes), and Lambda env (**`DYNAMODB_AUDIT_EVENTS_TABLE`**, etc.) exist. CI updates **code** only (`update-function-code`); it does **not** create functions. If Actions fails with `ResourceNotFoundException` for that name, apply Terraform **before** re-running deploy. |
| 2 | **GitHub:** Repository **variable** `STOCVEST_LAMBDA_S3_BUCKET`; **secrets** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`; optional `VERCEL_DEPLOY_HOOK_URL`. |
| 3 | **Push `main`:** Open **Actions** → confirm backend, frontend, `deploy-lambda`, and `deploy-vercel` (or skip if hook unset). |
| 4 | **Smoke:** `GET /v1/health` on the HTTP API base URL; optional `GET /v1/signals/recent` if D1 table is applied. |
| 5 | **Scheduled resolution — APPLIED ✅** **`terraform apply -var-file=terraform.tfvars -input=false -auto-approve`** completed **2026-05-03** (**19 added, 14 changed, 2 destroyed**). Rule **`stocvest-signal-resolution`**: **`ENABLED`**, **`rate(30 minutes)`**, target **`stocvest-development-api-signal_resolution`**. Details: [`docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md`](./D1_SIGNAL_RESOLUTION_SCHEDULE.md). |
| 6 | **Portfolio reversal + scanner payloads — APPLIED ✅** **`terraform apply`** completed **2026-05-05** (**5 added, 2 changed, 3 destroyed**): legacy **`stocvest-portfolio-reversal`** EventBridge rule/target removed; **EventBridge Scheduler** group **`stocvest-development-portfolio-reversal`** + schedule (weekdays **9:35** America/New_York) → **`stocvest-development-api-signal_resolution`** with input **`stocvest_job`=`portfolio_reversal`**; **premarket** + **scanner_intraday_morning** schedules now include **`run_portfolio_composite`: true** in target JSON. |
| 7 | **AuditEvents + founding/audit Gateway routes — APPLIED ✅** **`terraform apply -var-file=terraform.tfvars -input=false -auto-approve`** completed **2026-05-07** (**5 added, 14 changed, 0 destroyed**): DynamoDB **`AuditEvents`**, **`DYNAMODB_AUDIT_EVENTS_TABLE`** on all API Lambdas, HTTP API routes **`GET /v1/signals/founding-members`**, **`PATCH /v1/admin/users/{user_id}/beta-access`**, **`GET /v1/admin/audit/users/{user_id}`**, **`GET /v1/admin/audit/sessions/{session_id}`**, CORS header **`x-stocvest-session-id`**. |

1. **Infrastructure:** Same as checklist rows 1–2; keep API Gateway URLs and Cognito/Vercel env aligned with the deployed stage. **News pipeline note:** queue + consumer Lambda can be applied now; the optional ECS news worker still requires `news_worker_container_image` to be set before Terraform will create the task/service.
2. **Broker/runtime services:** IBKR path needs ECS/Fargate + TWS/ibeam where applicable; the new always-on news worker also needs an image publish/push path plus Redis reachability from the app security group.
3. **CI hardening (if not done):** setuptools upgrade in CI before `pip install -e .`; optional skip for Vercel deploy when hook secret missing. Add worker image build/push automation if you want the ECS runtime deployed from CI.
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
10. News ingestion is now multi-source: Benzinga websocket for live news plus SEC EDGAR 8-K polling, with Claude scoring kept in the SQS-triggered Lambda consumer.

---

## 7. Immutable contracts

Do **not** change without discussion and coordinated updates:

- **`BrokerAdapter`** — eight methods, types, exceptions (`docs/API_CONTRACTS.md` §1).  
- **HTTP paths** — versioned under `/v1/`; breaking changes need `/v2/` or migration.  
- **DynamoDB table names** — `Users`, `BrokerConnections`, `Watchlists`, `Alerts`, `Orders`, **`SignalHistory`**, **`TradeJournal`**, **`PDTState`**, **`AuditEvents`** (HTTP audit items; `pk`/`sk` per `audit_store.py`), etc.  
- **Secrets path** — `/stocvest/{userId}/brokers/{brokerId}`.  
- **Canonical types** — `stocvest/data/models.py` (no raw Polygon dicts in core logic).  
- **Snapshot + intraday + VIX invariants** (verified; do not re‑discover in prompts):
  1. **`Snapshot` model** — Pydantic `Snapshot` in `stocvest/data/models.py` (not a separate parser class). Raw Polygon ticker dicts map only through `PolygonClient._parse_snapshot()` → `Snapshot`. **Do not** add a `SnapshotParser` class, **do not** read raw Polygon keys in layer/analyzer code, **do** use `Snapshot` field names everywhere: `symbol`, `last_trade_price`, `last_trade_size`, `last_quote_bid`, `last_quote_ask`, `day_open`, `day_high`, `day_low`, `day_close`, `day_volume`, `day_vwap`, `prev_close`, `change`, `change_percent`, `pre_market_price`, `pre_market_change_percent`, `after_hours_price`, `after_hours_change_percent`, `market_status`, `company_name`, `prev_day_volume`. Layer analyzers take **`Snapshot`** instances (or derived inputs), not raw dicts.
  2. **`IntradaySetupScanner`** — Does **not** fetch bars. Signature: `scan(bars_by_symbol: dict[str, list[Bar]], …)`. Handlers fetch bars then pass them in. To reuse intraday math inside something like a technical layer, import **`IntradayVWAPCalculator`**, **`IntradayEMA9Calculator`**, **`OpeningRangeBreakoutDetector`** (and related helpers in `day_trading_scanner.py`) — **not** the scanner class as a nested “analyzer.”
  3. **VIX** — Reuse `get_vix_snapshot_with_fallback` and tuple `VIX_SNAPSHOT_FALLBACK_SYMBOLS` from `stocvest/api/services/morning_brief_fetch.py` (`I:VIX` → `^VIX` → `VIX`). **Do not** add another VIX fetcher or a single hardcoded/configured VIX ticker as the primary approach; the **ordered fallback list** is the contract.
  4. **Day vs last trade scale** — `_parse_snapshot` already drops inconsistent `day` OHLC/VWAP when out of line with `lastTrade.p` (5× bound via `_session_day_prices_align_with_last`). Use **`snapshot.last_trade_price`** for current/near price; **do not** duplicate that sanity check downstream.
  5. **Extended hours** — `preMarket`/`premarket` and `afterHours`/`afterhours` key variants are normalized inside `_parse_snapshot` into `pre_market_*` / `after_hours_*` on **`Snapshot`**; use those fields, not raw dict access.

Signal **layer enums** and internal composite types are stable; **customer-facing** naming follows the Legal section above.

---

## 8. Known issues / technical debt

- `pyproject.toml` / setuptools: may need `pip install setuptools --upgrade` before editable install on some machines.  
- PDT rolling window is weekday-based; exchange holidays not modeled—align with broker if needed.  
- Stochastic implementation has a small style debt (not correctness).  
- **Mitigated (local pytest, Windows + Python 3.14):** botocore’s user-agent path could trigger WMI via `platform.uname()` from threads and print “access violation” to stderr; **`tests/conftest.py`** primes `platform.uname()` on import and clears **`DYNAMODB_USERS_TABLE`** in the autouse fixture so handler imports do not eagerly create Dynamo clients.

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

### STEP 0 — Read and verify (no guessing)

Do this **before** designing or naming APIs against external data. **§7 “Snapshot + intraday + VIX invariants”** is the canonical checklist (field names, `IntradaySetupScanner` boundaries, VIX helper, no duplicate day/last checks, extended hours on `Snapshot`).

1. **Open the real implementation** — e.g. `polygon_client.py`, `models.py` (`Snapshot`), `day_trading_scanner.py` (`IntradaySetupScanner` + calculators), `morning_brief_fetch.py` (`get_vix_snapshot_with_fallback`).
2. **Polygon JSON keys** — Only keys read in `_parse_snapshot` (and other explicit parsers in `polygon_client.py`) are authoritative. New surface area → extend `_parse_snapshot` + tests.
3. **Decisions in code reviews** — Prefer commit messages or PR notes with **why** and **rejected alternatives** where non-obvious.
4. **Tests assert design, not trivia** — e.g. VIX fallback order, dropped `day` when scale mismatches, scanner RVOL gates.
5. **Commits** — When several separable decisions land in one session, **order commits** for independent `git revert`. One cohesive change may still use a single commit (§13 STEP 4).

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
Run `cd frontend && npm run test` (Vitest; do not pass Jest’s `--watchAll=false`)  
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
| Backend | `pytest tests/ -q` | **757 passed**, **3 skipped** |
| Frontend tests | `cd frontend && npm run test` | **123 passed** (29 test files); Vitest **`fileParallelism: false`** in **`vitest.config.ts`** (avoids **`global.fetch`** races across files) |
| Frontend build | `cd frontend && npm run build` | **success** |

---

## 14. Appendix: Business / entity (high level)

- Entity target: **STOCVEST LLC** (Delaware); formation and Stripe Atlas items **track outside this doc**.  
- **What STOCVEST is:** signal intelligence + execution tooling; user keeps custody via their broker.  
- **What it is not:** RIA, broker-dealer, custodian, fund manager.  
- Before **paid** users: attorney-reviewed ToS/Privacy, LLC, Stripe, production infra.
