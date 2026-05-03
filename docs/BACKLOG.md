# STOCVEST — Backlog

**Use with [`CONTEXT.md`](./CONTEXT.md).**  
`CONTEXT.md` holds **status-at-a-glance**, **what’s implemented**, **near-term ops** (Terraform, secrets, CI, legal), **legal rules**, and **session rules**.  
**This file** holds **planned work only**: themes, sub-items, and notes—**without** repeating the CONTEXT status table or §3 pending list.

**Last updated:** 2026-05-03 (B3/B4 shipped; landing polish `313db1e`; **infra:** `terraform plan` 19/14/2 vs gate 7/2/2 — apply skipped 2026-05-03; EventBridge rule verified ENABLED in AWS; B13, P5)

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
| D1 | **Signal outcome pipeline** | In progress | **Shipped in repo:** `SignalRecord` + DynamoDB `SignalHistory` (GSI `scope_generated_at`), `signal_recorder.record_signal` / `resolve_signals` / `get_signal_history`, auto-record on `POST /v1/signals/swing/composite` when `symbol` + `price_at_signal` present, `GET /v1/signals/recent` (50 public rows + outcome fields), summary from 1d outcomes, Lambda module `signal_resolution`, journal optional `signal_id` / `signal_direction` / `signal_generated_at`, dashboard Signal history tab + `/dashboard/performance` + journal signal chip. **Terraform / AWS (2026-05-03):** **`terraform apply -var-file=terraform.tfvars -input=false -auto-approve`** completed — **19 added, 14 changed, 2 destroyed** (API Gateway routes incl. watchlists/alerts/users/journal, Lambda env `STOCVEST_EMAIL_SENDER` / `STOCVEST_PUBLIC_APP_URL`, SES IAM, EventBridge target + permission). Rule **`stocvest-signal-resolution`** **ENABLED**, `rate(30 minutes)` → **`stocvest-development-api-signal_resolution`**. See `docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md` + **CONTEXT** §3 row 5. **DynamoDB journal + PDT:** `TradeJournal` / `PDTState` tables in `infra/dynamodb.tf`, Lambda env `STOCVEST_TRADE_JOURNAL_TABLE` / `STOCVEST_PDT_STATE_TABLE`, IAM + outputs; `config.py` defaults `TradeJournal` / `PDTState`. **B1:** order submit passes optional signal fields → journal rows. **Still open:** optional `GET` by `signal_id`, weekly horizon if desired. |
| D2 | **Backtesting** | Not done | Historical Polygon bars; per-setup and per-regime stats; no promise of future performance in UI. |
| D3 | **Weight / prompt iteration** | Not done | Optional: weekly analytics, suggested layer weight or prompt changes, **human approve** before apply; store `prompt_version` on generations; move prompts toward Secrets Manager (`CONTEXT.md` already flags this under platform). |
| D4 | **Audit trail** | Not done | Immutable order/PDT/admin logs to durable storage (e.g. S3 Glacier-class); retention policy to align with counsel. |
| D5 | **Anonymized behavioral data policy** | Not done | Operationalize user deletion → anonymize behavioral rows; document in Privacy; engineering checklist only—**no** duplicate of legal disclaimers in `CONTEXT.md` §4. |

---

## P — Platform & quality

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| P1 | **Phase 7 hardening** | Not done | E2E suite; security review (tenant isolation, PII); load tests; **minimum 2 weeks paper** per trading mode; staged real-money rollout. **Infra note:** D1 scheduled resolution — `infra/eventbridge.tf` (rule + target + Lambda permission) is **ready to apply**; not a substitute for Phase 7 E2E. |
| P2 | **Secrets-managed prompts** | Not done | Claude system/user prompts loaded from AWS Secrets Manager; version field on API calls; cache on cold start. |
| P3 | **Mobile / PWA** | Not done | Responsive web exists; native or PWA shell, push for alerts when B3 exists. |
| P4 | **Enhanced auth** | Not done | Optional SMS OTP, WebAuthn, magic link—Cognito capabilities; cost/compliance review. |
| P5 | **Infrastructure naming consistency** | Not done | Align DynamoDB table names with Terraform tag conventions **or** update tags to match table names. **Low priority** — no user impact. Example: tag `Name = "stocvest-development-ddb-signal-history"` vs actual table name **`SignalHistory`**. |
| PF1 | **Production: reference levels wrong vs spot** | Resolved | **Cause:** Polygon snapshot sometimes returned `day` OHLC/VWAP on a different price scale than `lastTrade.p`; UI preferred `day_*` so VWAP/Support/Resistance could show ~$700s while last was ~$200. **Original fix:** drop session bar when scale off vs last (initially **2.5×**). **Superseded by PF2** (looser **5×**, keep session when last missing). Done 2026-05-02 (commit message: *Fix reference level prices + Greeks precision*). |
| PF2 | **Regression: reference levels all n/a (9f80282)** | Resolved | **Cause:** **2.5×** check too aggressive and/or compared against missing/stale `lastTrade.p`, stripping valid `day` → UI n/a. **Fix:** Only run ratio check when `last_trade_price` is **> 0**; if last missing, **keep** session bar; threshold **5×**; warning log includes ratio when dropping. Frontend `snapshot-reference-levels.ts` mirrors. **Tests:** `tests/signals/test_reference_levels.py`. Done 2026-05-02 (PF2; see git history). |
| PF3 | **Scanner: ORB EXPIRED badge overlap** | Resolved | Intraday setup card: badge row layout (`flex-wrap`, `margin-left: auto` on amber badge), dimmed card + disabled **Open order entry** styling, italic ET copy line. Done 2026-05-02 (with B9 polish). |
| PF4 | **Scanner: low-quality intraday / micro-cap gaps** | Resolved | Backend: RVOL vs prior-day volume, min score 0.5 (50%), ORB only before 10:00 ET + first-30m volume vs ADV, optional `liquidity_by_symbol` + `company_name` on setups; gap scan requires `prev_day_volume` ≥ 1M when present. Frontend: snapshots → liquidity, 120×1m bars, company on card. Done 2026-05-02. |
| PF5 | **Gap Intelligence: catalyst matching** | Done 2026-05-03 | **Cause:** Tight 24h lookback vs evening/weekend views, global-only Polygon news missing per-ticker articles, broad substring noise (e.g. “this week”). **Fix:** `_catalyst_lookback_hours_at` / `_get_catalyst_lookback_hours` (24h RTH Mon–Fri 9:30–16:00 ET, else 48h); `collect_news_for_gap_intelligence` merges global + per-symbol `get_news(ticker=)` with dedupe; `NewsCatalystDetector` listicle regexes + trimmed noise list + optional `company_name` headline fallback (0.8× narrative penalty vs ticker match); debug log when no catalyst. **Tests:** `tests/signals/test_gap_intelligence.py`, scanner handler assertion on per-symbol fetches. |

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
