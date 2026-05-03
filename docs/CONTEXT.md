# STOCVEST — Session Context

**Read this file at the start of each session.** It summarizes what exists, what is pending, and what is planned—without duplicating the whole repo tree.

**Last updated:** 2026-05-02  
**Repo:** https://github.com/roygurijala/stocvest  
**Test baseline (regression gate — must match §13):** Backend `pytest tests/ -q` → **410 passed**, **3 skipped**. Frontend `npm run test` → **46 passed** (17 test files). **`npm run build`** last verified: success.

---

## 1. Status at a glance

| Track | Status | Notes |
|--------|--------|--------|
| Core data + indicators | ✅ | Polygon client, `stocvest/indicators/` |
| Swing + day-trading signals | ✅ | `stocvest/signals/` (layers, scanner, briefing, journal engine, PDT tracker) |
| Brokers | ✅ | Mock, IBKR, E*TRADE adapters; factory; PDT hook |
| HTTP API (Lambdas) | ✅ | Market, signals, brokers, portfolio, scanner, journal, PDT, orders, auth routes |
| Frontend (Next.js) | ✅ | Auth, dashboard redesign, **Gap Intelligence** scanner panel + structured **morning brief** (7:45–10:00 ET); scanner/signals/portfolio/journal/options/crypto/futures, landing, legal pages |
| Order safety (Step 8) | ✅ | `order_safety.py`, validate/submit BFF, confirmation modal, paper/live mode |
| Legal compliance pass | ✅ | `GlobalDisclaimer`, `SignalDisclaimerChip`, signal-oriented copy, public API field names + `disclaimer` |
| D1 Signal outcome pipeline | 🚧 | `SignalRecord`, `SignalHistory` table + `signal_recorder`, composite persistence, resolution Lambda module, recent/summary + UI; EventBridge **rate(30 minutes)** → `signal_resolution` in `infra/eventbridge_signal_resolution.tf` (**`terraform apply`** to enable) — see `docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md` |
| Terraform / AWS apply | 🚧 | Modules in `infra/`; **apply**, secrets, S3 artifact bucket, Cognito/Vercel hook wiring **pending** |
| Phase 7 (E2E, audits, paper validation) | 🔜 | Not started as a program |

---

## 2. Implemented (where to look)

**Backend (`stocvest/`)**  
`data/` (models incl. **`SignalRecord`**, **`EconomicCalendarEvent`**, Polygon — snapshot parser may drop `day` OHLC/VWAP vs **`lastTrade.p` only when last is a positive price and any session field is **>5×** off; missing last keeps session bar; **`get_economic_calendar_for_day`** on Benzinga economics when tier allows), `indicators/`, `signals/` (sentiment, macro, geo, composite, AI synthesis, day-trading scanner, **`confluence`** multi-signal alignment score in `confluence.py`, **`gap_intelligence`**, **`morning_brief`**, **`news_catalyst_detector`** categories + narrative sentiment, briefing markdown generator still in `daily_briefing.py` for legacy tests), `brokers/` (adapters, gateways, OAuth), `api/` (handlers incl. **`signal_resolution`**, **`services/signal_recorder.py`**, **`services/morning_brief_fetch.py`**, **`POST /v1/scanner/gap-intelligence`**, structured **`POST /v1/signals/day/briefing`** / **`POST /v1/scanner/briefing`**, auth, `legal_copy.py`, order safety integration).

**Frontend (`frontend/`)**  
App router pages (dashboard incl. **`/dashboard/performance`**, scanner, signals with **Signal history** tab, portfolio, journal, settings, earnings, public `/performance`, terms, etc.), **landing** (`LandingHowItWorksSection`, `LandingPerformanceSection` + optional **`pattern_breakdown`** from `GET /v1/signals/performance/summary`), design system + theme, API clients under `lib/api/` (incl. **`public-signals.ts`**, client-safe **`fetch-symbol-snapshot.ts`**), **`lib/snapshot-reference-levels.ts`** (same **5×** + valid-last guard as backend), Crisp when `NEXT_PUBLIC_CRISP_WEBSITE_ID` is set. **Sign out** redirects to **`/`** (landing). Scanner: **`fetchScannerOverview`** uses **`POST /v1/scanner/gap-intelligence`**, **`POST /v1/signals/day/setups`** (with snapshots + regime for confluence), structured **`POST /v1/signals/day/briefing`** (context includes gap items + intraday setups); intraday setup cards, signal evidence modal, gap cards, and dashboard morning brief show **confluence** when `is_confluence_alert`.

**Docs**  
`docs/API_CONTRACTS.md` — HTTP + broker contracts. **`docs/BACKLOG.md`** — detailed planned work (no duplicate of this file’s status tables). **Detailed file-by-file history was removed from this file** to avoid drift; use README + git.

**Public signal API (trust)**  
`GET /v1/signals/recent` (last **50** public `SignalRecord` rows, outcome fields when resolved), `GET /v1/signals/performance/summary` — directional accuracy from **1d** outcomes (`correct` / `incorrect` / `neutral`; accuracy = correct ÷ (correct + incorrect)). Responses use `signal_strength`, `disclaimer`, etc. (see Legal section).

---

## 3. Pending (near-term ops / engineering)

**Deploy checklist (after you push to `main`):** GitHub Actions runs tests, then **`deploy-lambda`** (zip → S3 → `update-function-code` for every `stocvest-development-api-*` module, including **`signal_resolution`**) and optionally **`deploy-vercel`** (production deploy hook). Full secret/variable names and IAM needs: [root `README.md` § CI/CD](../README.md#cicd-github-actions).

| Step | Action |
|------|--------|
| 1 | **Terraform:** `cd infra && terraform apply` for the target env so DynamoDB (incl. **`SignalHistory`**, **`TradeJournal`**, **`PDTState`**), **every** `api_handler_modules` Lambda (incl. **`signal_resolution`** → name `stocvest-development-api-signal_resolution`), API Gateway, and Lambda env exist. CI updates **code** only (`update-function-code`); it does **not** create functions. If Actions fails with `ResourceNotFoundException` for that name, apply Terraform **before** re-running deploy. |
| 2 | **GitHub:** Repository **variable** `STOCVEST_LAMBDA_S3_BUCKET`; **secrets** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`; optional `VERCEL_DEPLOY_HOOK_URL`. |
| 3 | **Push `main`:** Open **Actions** → confirm backend, frontend, `deploy-lambda`, and `deploy-vercel` (or skip if hook unset). |
| 4 | **Smoke:** `GET /v1/health` on the HTTP API base URL; optional `GET /v1/signals/recent` if D1 table is applied. |
| 5 | **Scheduled resolution:** `aws_cloudwatch_event_rule` **`stocvest-signal-resolution`** (`rate(30 minutes)`) → `stocvest-development-api-signal_resolution` in **`infra/eventbridge_signal_resolution.tf`**. Run **`terraform apply`** so the rule, target, and Lambda permission exist in AWS. Details: [`docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md`](./D1_SIGNAL_RESOLUTION_SCHEDULE.md). |

1. **Infrastructure:** Same as checklist rows 1–2; keep API Gateway URLs and Cognito/Vercel env aligned with the deployed stage.
2. **Broker runtime:** IBKR path needs ECS/Fargate + TWS/ibeam where applicable; E*TRADE OAuth is wired in app but production tokens/env must match deployment.
3. **CI hardening (if not done):** setuptools upgrade in CI before `pip install -e .`; optional skip for Vercel deploy when hook secret missing.
4. **Legal / launch:** Terms at `/terms` are a **draft** — attorney review before paid subscribers; onboarding acknowledgment screen still listed as a future item.

---

## 4. Legal compliance (product & API)

- STOCVEST is **not** a registered investment adviser; frame as **signal intelligence** and data tooling.
- **UI:** Prefer signal summary, signal strength, reference levels, signal parameters—not “verdict,” “recommendation,” “you should,” or “confidence” in **signal** context.
- **`SignalDisclaimerChip`** on signal cards; **`GlobalDisclaimer`** last in `<body>` in root layout.
- **Performance page:** Directional accuracy only; not dollar P&L as “signal performance.”
- **Serialized API:** Use `signal_summary` / `signal_strength` (and related names) where applicable; include `disclaimer`: *Signal data for informational purposes only. Not investment advice.*

---

## 5. Roadmap & backlog

**Full prioritized themes, sub-tasks, and IDs:** [`docs/BACKLOG.md`](./BACKLOG.md) — **single source** for planned work so this file stays short.

**Directional summary:** After infra/broker production readiness (`§3`), focus shifts to **journal automation**, **onboarding + legal ack**, **alerts**, **watchlist-driven scanner**, **subscriptions**, **sector/internals**, **signal outcome pipeline + backtesting**, **Phase 7 hardening**, and the post-beta **trade brief** UI (`BACKLOG.md` sections B, D, P, G, M, T).

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
  `"B2 onboarding wizard | backend: 351 tests | frontend: 52 tests"`  
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
| Backend | `pytest tests/ -q` | **410 passed**, **3 skipped** |
| Frontend tests | `cd frontend && npm run test` | **46 passed** (17 files) |
| Frontend build | `cd frontend && npm run build` | **success** |

---

## 14. Appendix: Business / entity (high level)

- Entity target: **STOCVEST LLC** (Delaware); formation and Stripe Atlas items **track outside this doc**.  
- **What STOCVEST is:** signal intelligence + execution tooling; user keeps custody via their broker.  
- **What it is not:** RIA, broker-dealer, custodian, fund manager.  
- Before **paid** users: attorney-reviewed ToS/Privacy, LLC, Stripe, production infra.
