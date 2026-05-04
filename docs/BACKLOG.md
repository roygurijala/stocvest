# STOCVEST — Backlog

**Use with [`CONTEXT.md`](./CONTEXT.md).**  
`CONTEXT.md` holds **status-at-a-glance**, **what’s implemented**, **near-term ops** (Terraform, secrets, CI, legal), **legal rules**, and **session rules**.  
**This file** holds **planned work only**: themes, sub-items, and notes—**without** repeating the CONTEXT status table or §3 pending list.

**Last updated:** 2026-05-04 (PF9 market-data contracts + session checklist)

---

## Conventions

- **Done** items live in git + `CONTEXT.md` §1–§2; they are **not** re-listed here unless needed as dependency context.
- Update this file when you **add**, **reprioritize**, or **finish** a backlog theme.
- IDs (B1, P3, …) are stable handles for PRs/commits; not sprints.
- **`CONTEXT.md` §13** defines end-of-session steps: completed rows → status **DONE** plus `Done YYYY-MM-DD · commit: <hash>`; in-progress → **In progress**; **never delete a row**.

---

## Near-term operations

Tracked in **`CONTEXT.md` §3** only (Terraform apply, GitHub/AWS/Vercel secrets, broker production runtime, CI tweaks, attorney review). **Do not duplicate §3 here.**

---

## B — Product / UX

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| B1 | **Journal automation** | Done 2026-05-02 · commit: 3602db38c839209d3bae3d67fa2d50eee0f93022 | Auto-capture on fill, auto-close on exit, optional `signal_id` / `pattern` / `confluence_score` / `signal_strength` / `signal_direction` on `POST /v1/orders/submit`, `GET /v1/journal/analytics`, entry GET/PATCH, journal page wired to API + scanner → portfolio order prefill + confirmation modal signal block. |
| B2 | **Onboarding** | Done 2026-05-02 (feat(B2) commit on `main`; `git log --oneline -5` for hash) | **Legal:** mandatory full-screen acknowledgment (5 checkboxes + ToS link) before any dashboard interaction; `PATCH /v1/users/me` with `legal_acknowledged_version` **1.0**. **Onboarding:** optional wizard after legal ack; “Remind me later” hides for session until next login; `PATCH` sets `onboarding_completed`. **Backend:** `UserProfile` fields + Dynamo merge via `user_profile_store.put_profile`. **Routes:** `GET`/`PATCH /v1/users/me` (brokers Lambda), API Gateway + `dev_local_api` PATCH. **Frontend:** `app/dashboard/layout.tsx`, `DashboardComplianceClient`, `legal-acknowledgment-modal`, `onboarding-wizard-modal`, BFF `/api/stocvest/users/me`. |
| B3 | **Alerts delivery** | Done 2026-05-03 (B3/B4 on `main`; `git log -1 --oneline` for hash) | **Phase 1 shipped:** SES email via `stocvest/services/email_service.py`, prefs + history in `alert_store` (`preferences` + `hist#` SK), `AlertTriggerService`, non-blocking hooks on swing composite record + order validate (2 trades) / submit PDT 403; `GET`/`PATCH /v1/alerts/preferences`, `GET /v1/alerts/history`; settings Alert Preferences UI; Lambda IAM SES send; `STOCVEST_EMAIL_SENDER` / `STOCVEST_PUBLIC_APP_URL` in `lambda_common_env`; `docs/DEPLOYMENT.md`. **Phase 2 / still pending:** push, webhooks, **SMS (B13)** when phone collection exists. |
| B4 | **Watchlists** | Done 2026-05-03 (B3/B4 on `main`; `git log -1 --oneline` for hash) | **Shipped:** `watchlist_store` + API under brokers Lambda + API Gateway routes; `get_scan_symbols` / scanner defers Dynamo until Polygon aggregate 401/403 fallback; dashboard `/dashboard/watchlists`, sidebar **Watchlists**, BFF routes, **Add to watchlist** on signals + gap cards; limits 5 lists / 50 symbols. |
| B14 | **Watchlist monitoring (scanner + scheduled + alerts)** | Done 2026-05-03 (watchlist monitoring on `main`; `git log --oneline -3` for hash) | **Shipped:** Dashboard **`/dashboard/scanner`** — `fetchDefaultWatchlistSymbols` (`GET /v1/watchlists/default/symbols`) in `Promise.all` with `fetchPdtStatus`, then `fetchScannerOverview(pdt, watchlistSymbols)`; `lib/api/watchlists.ts`. **Scheduled scan:** `scanner_scheduled_pipeline._resolve_scheduled_scan_symbols` merges Lambda `scanner_symbols` + `scan_default_watchlists` (≤100 rows, ≤30 symbols) + `SYSTEM_DEFAULTS`, cap **40**; `merge_scheduled_scan_symbol_universe`. **Alerts:** `watchlist_scanner_alerts.notify_intraday_setups_for_watchlist_users` after intraday + EOD setups, `asyncio.wait_for(..., 2.0)`; `find_users_with_default_watchlist_symbol`; `UserProfile.email` optional in Dynamo; `alert_store.had_signal_email_for_symbol_within_hours` (4h dedupe). **Tests:** `tests/api/test_watchlist_monitoring.py`. |
| B15 | **Market Intelligence headlines (quality + affected stocks)** | Done 2026-05-04 | **Backend:** `news_handler` pulls ticker-scoped market news (`ticker.any_of`, 4h lookback), merges default watchlist symbols (cap 30), filters PR/noise via `news_quality_filter`, and adds `affected_stocks` + `impact_summary` via `news_impact_analyzer`. **Quality pass:** publisher diversity rank with max 2 articles per publisher, expanded retrospective-noise phrases, story-type summary templates (earnings/analyst/macro/default), ticker alias dedupe (`GOOG→GOOGL`, `BRK.A→BRK.B`), and chip relevance filter to liquid/watchlist-known symbols only. **Frontend:** dashboard headlines renamed **Market Intelligence**, tiered source styling, sentiment label, affected-stock chips, click-through to `/dashboard/signals?symbol=...`, impact summary, empty state. **Tests:** service + handler coverage updated. |
| B16 | **Signals page after-hours research panel** | Done 2026-05-04 | Added `frontend/components/signals-after-hours-panel.tsx` and wired signals-page insufficient-data closed-session rendering to show last-session levels, earnings window, recent news, tomorrow watch levels, and watchlist CTA with graceful per-section fallbacks. |
| B5 | **Subscriptions** | Not done | Stripe (Atlas-linked), tier gating (Free / Pro / Institutional), usage limits; **after** attorney-reviewed ToS and entity readiness (`CONTEXT.md` §14). |
| B6 | **Sector & market internals** | Not done | Sector rotation view, breadth (A/D, highs/lows), VIX regime, optional put/call—**data-only** copy per legal framing. |
| B7 | **Risk management UX** | Not done | Position sizing helper (% of portfolio), optional max daily loss guardrails, concentration / correlation hints—**never** framed as advice; copy reviewed with counsel. |
| B8 | **Scanner order placeholder** | Not done | Replace “Order modal placeholder” on scanner with real order entry or deep-link to portfolio panel; align with Step 8 validation flow. |
| B9 | **Earnings calendar UI** | Done 2026-05-02 | Redesign: default **Upcoming** filter, Mon–Fri **This Week**, grouped sections (Today / This Week / Upcoming), grid rows with beat/miss bars, monospace figures. **Polish (density, section/header separation, Actual & Surprise alignment, hover):** resolved 2026-05-02 — same commit as PF3. |
| B10 | **Gap Intelligence + morning brief** | Done 2026-05-02 · commit: 4122c05 | **Backend:** `POST /v1/scanner/gap-intelligence` merges dynamic gaps + 24h news, quality score + filters, catalyst block; `news_catalyst_detector` noise phrases, categories (insider/analyst/fda/merger/earnings/macro), narrative sentiment 0–100; structured morning brief from `morning_brief.py` + `morning_brief_fetch` (SPY/QQQ/VIX, Benzinga economics stub, earnings today, gap-intel top watch, PDT); default intraday `min_score` **0.55**. **Frontend:** single Gap Intelligence panel (2-col scanner with intraday); dashboard morning brief sections. **Terraform:** API route `gap-intelligence`. **Follow-up shipped 2026-05-02:** shared-news headline dedupe across gap cards (`gap_intelligence`), `company_name` snapshot fallback (`polygon_client`), merger/acquirer narrative tweaks (`news_catalyst_detector`), gap card symbol/company typography (`scanner-page-client`). |
| B13 | **Phone number collection + SMS alerts** | Not done | **Priority: low** — do not build until **B3** is complete. **Phase 1** (when B3 alerts ships): Add optional phone field to **Settings → Notifications**. Verify via **AWS SNS** 6-digit SMS code before storing. **Never collect unverified numbers.** **Phase 2:** Make phone required for **Pro** SMS alert tier. **Do NOT** add to signup form — collect only when SMS alerts are ready to deliver. **Framing:** “Add your phone to receive PDT warnings and signal alerts.” **Channels when ready:** PDT warning (free), signal state change (Pro), confluence alert (Pro), morning brief summary (Pro). **Dependencies:** B3 alerts delivery must ship first. **Infrastructure:** AWS SNS for SMS, ~**$0.00645/SMS** in US. **Privacy:** CCPA/GDPR disclosure required in Privacy Policy before collecting. |
| B11 | **Confluence Score** | Done 2026-05-02 | **Confluence Score** — multi-signal alignment: `stocvest/signals/confluence.py`, intraday + swing payloads, morning brief `top_watch` fields; setup cards, signal evidence modal, morning brief styling, gap intelligence **CONFLUENCE** chip (frontend cross-ref by symbol). Tests: `tests/signals/test_confluence.py`. |
| B12 | **Landing: historical signals + trust sections** | Done 2026-05-02 · commit: 4579d1c | **`GET /v1/signals/recent?landing=true`** → resolved-only allowlisted payload; **`SignalRecord.ai_summary`** optional. Landing: **`LandingSignalExplorer`**, **`LandingBeforeAfterSection`**, **`LandingActivityFeedSection`**, server fetch + **`FALLBACK_SIGNALS`**, nav removes How It Works / Performance links; tests in **`tests/api/test_signal_recorder.py`**. **Polish 2026-05-03 · commit `313db1e`:** shared glow card CSS (`.landing-glow-card` / gate / pledge / before-after), consistent cards on landing sections + **`landing-page.tsx`** marketing blocks; realistic fallback tick prices + dynamic 1h % line; explorer “(example data)” on API fallback; Live Engine empty state + accuracy sparkline copy. **Explorer fallback 2026-05-03 · commit `d5a363e`:** ET wall-clock **`generated_at`** for demo rows; **5** fallbacks (AMD, SPY with **incorrect** 1h outcome); tab strip note (4 correct / 1 incorrect vs live “Showing N…”). |

---

## D — Data, performance & moat

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| D1 | **Signal outcome pipeline** | Done 2026-05-02 · commit: 62b7e65 | **Shipped:** `SignalRecord` + DynamoDB `SignalHistory` (GSI `scope_generated_at`), `signal_recorder.record_signal` / **`resolve_signals`** (Polygon **1m bar** close at T+1h / T+24h, **`get_evaluated_price_after_signal`**), `get_signal_history` / `get_by_id` / `public_signal_detail_dict`, auto-record on `POST /v1/signals/swing/composite` when `symbol` + `price_at_signal` present, `GET /v1/signals/recent`, `GET /v1/signals/performance/summary` (**`correct_direction_count`** / **`incorrect_direction_count`** / **`neutral_direction_count`**), **`GET /v1/signals/records/{signal_id}`**, **`GET /v1/signals/me/history`**, **`GET /v1/signals/me/records/{signal_id}`** (signals Lambda + API Gateway), BFF under **`/api/stocvest/signals/**`**, dashboard Signal history + landing/performance copy. **Scheduled resolution:** EventBridge **`stocvest-signal-resolution`** → **`stocvest-development-api-signal_resolution`** (`infra/eventbridge.tf`); dev apply **2026-05-03** — see `docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md`. Journal optional signal fields (B1). **Optional later:** weekly horizon, richer analytics. |
| D2 | **Backtesting** | Not done | Historical Polygon bars; per-setup and per-regime stats; no promise of future performance in UI. |
| D3 | **Weight / prompt iteration** | In progress | **2026-05-04:** Schema + storage shipped — `stocvest/config/signal_parameters.py` (defaults), Secrets Manager **`stocvest/signal-parameters`**, **`ParameterStore`** (5m cache), DynamoDB **`ParameterHistory`**, **`SignalRecord`** snapshot JSON columns + **`parameter_version`**, **`GET /v1/signals/analysis`** (admin/internal), `docs/TUNING_PLAYBOOK.md`, scripts `init_signal_parameters.py` / `update_parameters.py`. **Still pending:** wire tunables into scoring engines (no weight logic change in this slice); optional prompts in Secrets (P2). |
| D4 | **Audit trail** | Not done | Immutable order/PDT/admin logs to durable storage (e.g. S3 Glacier-class); retention policy to align with counsel. |
| D5 | **Anonymized behavioral data policy** | Not done | Operationalize user deletion → anonymize behavioral rows; document in Privacy; engineering checklist only—**no** duplicate of legal disclaimers in `CONTEXT.md` §4. |
| D6 | **Dynamic per-layer reasoning in swing composite** | Done 2026-05-04 | Added backend per-layer `reasoning` generation in `swing_composite_handler` contributions and wired frontend layer breakdown to consume dynamic reasoning when present instead of static generic text. |

---

## P — Platform & quality

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| P1 | **Phase 7 hardening** | Not done | E2E suite; security review (tenant isolation, PII); load tests; **minimum 2 weeks paper** per trading mode; staged real-money rollout. **Infra note:** D1 EventBridge rule is **applied** in development (`CONTEXT.md` §3); still not a substitute for Phase 7 E2E. |
| P2 | **Secrets-managed prompts** | Not done | Claude system/user prompts loaded from AWS Secrets Manager; version field on API calls; cache on cold start. |
| P3 | **Mobile / PWA** | Not done | Responsive web exists; native or PWA shell, push for alerts when B3 exists. |
| P4 | **Enhanced auth** | Not done | Optional SMS OTP, WebAuthn, magic link—Cognito capabilities; cost/compliance review. |
| P5 | **Infrastructure naming consistency** | Not done | Align DynamoDB table names with Terraform tag conventions **or** update tags to match table names. **Low priority** — no user impact. Example: tag `Name = "stocvest-development-ddb-signal-history"` vs actual table name **`SignalHistory`**. |
| PF1 | **Production: reference levels wrong vs spot** | Resolved | **Cause:** Polygon snapshot sometimes returned `day` OHLC/VWAP on a different price scale than `lastTrade.p`; UI preferred `day_*` so VWAP/Support/Resistance could show ~$700s while last was ~$200. **Original fix:** drop session bar when scale off vs last (initially **2.5×**). **Superseded by PF2** (looser **5×**, keep session when last missing). Done 2026-05-02 (commit message: *Fix reference level prices + Greeks precision*). |
| PF2 | **Regression: reference levels all n/a (9f80282)** | Resolved | **Cause:** **2.5×** check too aggressive and/or compared against missing/stale `lastTrade.p`, stripping valid `day` → UI n/a. **Fix:** Only run ratio check when `last_trade_price` is **> 0**; if last missing, **keep** session bar; threshold **5×**; warning log includes ratio when dropping. Frontend `snapshot-reference-levels.ts` mirrors. **Tests:** `tests/signals/test_reference_levels.py`. Done 2026-05-02 (PF2; see git history). |
| PF3 | **Scanner: ORB EXPIRED badge overlap** | Resolved | Intraday setup card: badge row layout (`flex-wrap`, `margin-left: auto` on amber badge), dimmed card + disabled **Open order entry** styling, italic ET copy line. Done 2026-05-02 (with B9 polish). |
| PF4 | **Scanner: low-quality intraday / micro-cap gaps** | Resolved | Backend: RVOL vs prior-day volume, min score 0.5 (50%), ORB only before 10:00 ET + first-30m volume vs ADV, optional `liquidity_by_symbol` + `company_name` on setups; gap scan requires `prev_day_volume` ≥ 1M when present. Frontend: snapshots → liquidity, 120×1m bars, company on card. Done 2026-05-02. |
| PF5 | **Gap Intelligence: catalyst matching** | Done 2026-05-03 | **Cause:** Tight 24h lookback vs evening/weekend views, global-only Polygon news missing per-ticker articles, broad substring noise (e.g. “this week”). **Fix:** `_catalyst_lookback_hours_at` / `_get_catalyst_lookback_hours` (24h RTH Mon–Fri 9:30–16:00 ET, else 48h); `collect_news_for_gap_intelligence` merges global + per-symbol `get_news(ticker=)` with dedupe; `NewsCatalystDetector` listicle regexes + trimmed noise list + optional `company_name` headline fallback (0.8× narrative penalty vs ticker match); debug log when no catalyst. **Tests:** `tests/signals/test_gap_intelligence.py`, scanner handler assertion on per-symbol fetches. |
| PF6 | **Swing composite: minimum live layers + insufficient UI** | Done 2026-05-02 | **`POST /v1/signals/swing/composite`:** require **3** layers with `score` set and `status` ≠ `unavailable` before composite/confluence/record/alert; otherwise HTTP **200** with `status: insufficient_data`, counts, message, `market_status` (`is_market_open`, `next_open`, `market_session` from Polygon via `composite_market_context.py`). **Frontend:** `POST /api/stocvest/signals/swing-composite`, `lib/api/swing-composite.ts`, signals page amber callout (Lucide clock). **Tests:** `tests/api/handlers/test_signals.py`, `test_signal_recorder` composite payload uses three layers. |
| PF7 | **Signals stale data leak on insufficient state** | Done 2026-05-04 | Fixed `frontend/components/signals-page-client.tsx` stale rendering by introducing `hasValidSignal` gating and clearing `compositeResult`, `signalEvidence`, and `radarData` on insufficient-data responses; kept watchlist CTA visible. |
| PF8 | **Scanner API test timeout flake (local/CI variance)** | Done 2026-05-04 | Increased explicit timeout in `frontend/tests/scanner-api.test.ts` from default 5s to 15s for both scanner overview cases to stabilize intermittently slow runs. |
| PF9 | **CONTEXT market-data invariants + reusable VIX snapshot helper** | Done 2026-05-04 (PF9 on `main`; `git log -1 --oneline` for hash) | **`docs/CONTEXT.md` §7 / §13:** codified `Snapshot` + `_parse_snapshot` contract (field names, no raw dicts), `IntradaySetupScanner` bar-fetch boundary + calculator reuse guidance, extended-hours on `Snapshot` only, no duplicate day/last scale check. **`morning_brief_fetch`:** `VIX_SNAPSHOT_FALLBACK_SYMBOLS`, `SupportsPolygonSnapshotFetch`, `get_vix_snapshot_with_fallback` (replace ad-hoc VIX loops). **`tests/api/test_morning_brief.py`:** VIX fallback order / empty last / `PolygonError` chain. Test baseline **536** backend / **56** frontend. |

---

## G — Growth

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| G1 | **Referral program** | Not done | e.g. invite trader → credit; implement **after** Stripe/B5. |

---

## M — Multi-asset & advanced signals

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| M1 | **Cross-asset signal views** | Not done | Optional: options flow vs spot, futures basis vs spot, crypto vs risk proxies—**correlation / divergence as data**, not recommendations. |

---

## T — Post-beta “trade brief” (rich UI)

Single theme (legal review required before customer-facing price language):

- Rich card: reference levels (historical entry zone, reference targets, reference stop) as **data**, signal-parameters block, technical grid (VWAP, EMA, RSI, etc.), catalysts vs risks columns, risk/reward **chart as visualization only**.

Dependencies: D1 data maturity, counsel on display copy.

---

## Done (reference only — do not reopen)

Shipped themes are **not** backlog; see **`CONTEXT.md` §1–§2** (e.g. core signals, brokers, API, frontend redesign, order safety Step 8, legal compliance pass, earnings integration, public performance page shell, PDT enforcement, Crisp, etc.). If something regresses, file a **bug** or a **small** CONTEXT update—not a new backlog row.


