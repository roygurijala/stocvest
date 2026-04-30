# STOCVEST — Session Context

**READ THIS FILE AT THE START OF EVERY SESSION**

This file tracks what has been built, what's in progress, what's broken,
and what must never be changed without explicit discussion.

---

## Current Status

**Phase:** 1 — Complete ✅ / Phase 2 — Complete ✅ / Phase 2.5 — Complete ✅ / Phase 3 — Complete ✅ / Phase 4 — Complete ✅ / Phase 5 — Complete ✅ / Phase 6 — In Progress 🚧 (6a–6i: Terraform + Vercel config + GitHub Actions CI/CD ✅ / cloud apply + hook wiring pending)
**Last Updated:** 2026-04-29
**Last Session:** Redis-backed scanner cache + Polygon/Claude rate limits; DayTradingSetups sort key + persistence; scheduled scanner Polygon→score→Dynamo→Alerts→WebSocket fan-out; Next.js `DashboardRealtime` + `NEXT_PUBLIC_STOCVEST_WS_URL`

---

## Development Environment

**Phase 1** was built in Claude.ai chat (claude.ai).
**Phase 2 onwards** is being developed in **Cursor** with the codebase
checked into GitHub at: https://github.com/roygurijala/stocvest

Cursor has full codebase context via its indexer.
Claude in Cursor should always read this file before writing any code.

---

## What Has Been Built

```
✅ docs/CONTEXT.md              This file
✅ docs/API_CONTRACTS.md        BrokerAdapter §1 (eight async methods) + HTTP placeholder §4
✅ pyproject.toml               Project config + all dependencies
✅ .env.example                 All required environment variables documented
✅ .gitignore                   Python + secrets + terraform ignores
✅ README.md                    Project overview + setup instructions

✅ stocvest/utils/config.py     Pydantic-settings config loader (no hardcoded creds)
✅ stocvest/utils/logging.py    Structured logging (never logs prices/accounts)

✅ stocvest/data/models.py      Canonical Pydantic types:
                                  Bar, Quote, Trade, Snapshot, NewsArticle,
                                  OptionContract, MarketStatus,
                                  Timeframe, AssetType enums

✅ stocvest/data/polygon_client.py  Async Polygon.io client
                                  REST: get_bars, get_snapshot, get_snapshots,
                                        get_gainers_losers, get_news,
                                        get_options_chain, get_market_status,
                                        get_previous_close, get_ticker_details
                                  WebSocket: stream_quotes, stream_trades,
                                             stream_minute_bars (auto-reconnect)

✅ stocvest/indicators/core.py  Full technical indicator engine (pure functions):
                                  SMA, EMA (standard + Wilder), RSI, MACD,
                                  VWAP (intraday, day-reset), Bollinger Bands,
                                  ATR, ADX (+DI / -DI), Stochastic (%K/%D),
                                  OBV, Volume SMA, Relative Volume,
                                  Opening Range, Gap %

✅ tests/data/test_polygon_client.py   Polygon client (mocked REST/WS parsers)
✅ tests/data/test_models.py           Canonical Pydantic models
✅ tests/indicators/test_core.py       Technical indicators (pure)
✅ tests/utils/test_config.py          Settings loader
✅ tests/utils/test_logging.py         Logger factory
✅ tests/test_package_smoke.py         Package import / export smoke tests

TEST STATUS: 310/310 backend tests passing ✅ + 25/25 frontend unit tests passing ✅

✅ stocvest/signals/   — Phase 2 complete
                         ✅ 2a News sentiment scorer (Claude API) implemented
                         ✅ tests/signals/test_news_sentiment.py added (3 tests)
                         ✅ 2b Macro event detector implemented
                         ✅ tests/signals/test_macro_events.py added (5 tests)
                         ✅ 2c Geopolitical scanner implemented
                         ✅ tests/signals/test_geopolitical_scanner.py added (5 tests)
                         ✅ 2d Signal weighting + composite score implemented
                         ✅ tests/signals/test_composite_score.py added (6 tests)
                         ✅ 2e AI synthesis prompt builder + response parser implemented
                         ✅ tests/signals/test_ai_synthesis.py added (5 tests)
                         ✅ 2f Signal engine integration tests implemented
                         ✅ tests/signals/test_signal_engine_integration.py added (2 tests)
✅ Hardening updates completed before 2c:
   - Fixed snapshot bid/ask mapping bug in Polygon parser
   - Added retry/backoff for Polygon REST and Claude sentiment requests
   - Improved WebSocket resilience (callback error isolation + broader reconnect handling)
   - Added bounded-concurrency sentiment batch scoring
   - Expanded Polygon REST tests for snapshots/gainers/options/status/details + retry path
✅ Additional audit fixes after Phase 2 completion:
   - Fixed WebSocket minute-bar volume mapping (`v` vs cumulative `av`)
   - Implemented news pagination traversal in Polygon client
   - Populated snapshot pre-market/after-hours fields when present
   - Hardened geopolitical parser for malformed list fields
   - Improved retry terminal error context for Claude paths
   - Reduced macro cue false positives with phrase-boundary + negation handling
   - Adjusted composite confidence aggregation to weighted-average confidence
   - Added regression tests for all above fixes
✅ Phase 2.5 — Day Trading Scanner complete
   ✅ 2.5a Pre-market gap scanner implemented
   ✅ tests/signals/test_day_trading_scanner.py added (5 tests)
   ✅ 2.5b News catalyst detector implemented
   ✅ tests/signals/test_news_catalyst_detector.py added (5 tests)
   ✅ 2.5c VWAP calculator (real-time intraday) implemented
   ✅ tests/signals/test_intraday_vwap_calculator.py added (4 tests)
   ✅ 2.5d Opening range breakout detector implemented
   ✅ tests/signals/test_opening_range_breakout_detector.py added (4 tests)
   ✅ 2.5e 9 EMA on 1-min bars implemented
   ✅ tests/signals/test_intraday_ema9_calculator.py added (4 tests)
   ✅ 2.5f Intraday setup scanner (every 5 min) implemented
   ✅ tests/signals/test_intraday_setup_scanner.py added (4 tests)
   ✅ 2.5g PDT rule tracker (per user; rolling 5 weekday window; warn at 2, block at 3)
   ✅ tests/signals/test_pdt_tracker.py added (9 tests)
   ✅ 2.5h Daily briefing generator (markdown from scanner + signal inputs)
   ✅ tests/signals/test_daily_briefing.py added (4 tests)
   ✅ 2.5i Trade journal (entries, close flow, Dynamo-shaped items, in-memory journal)
   ✅ tests/signals/test_trade_journal.py added (8 tests)
   ✅ 2.5j Day-trading integration test + repo-wide test gap closure:
      - tests/utils/test_config.py (5), test_logging.py (3)
      - tests/data/test_models.py (8)
      - tests/test_package_smoke.py (5)
      - tests/signals/test_phase25_day_trading_integration.py (1)
   ✅ Phase 2.5 complete — proceed to Phase 3 (brokers) when ready
✅ stocvest/brokers/   — Phase 3 complete
                         ✅ 3a BrokerAdapter ABC + exceptions + Pydantic DTOs
                         ✅ 3b MockBrokerAdapter (orders, positions, cancel)
                         ✅ 3c IBKRBrokerAdapter implemented (gateway-backed for TWS / ib_insync wiring + Level 2 methods)
                         ✅ 3d ETradeBrokerAdapter implemented (gateway-backed for OAuth REST wiring)
                         ✅ 3e BrokerAdapterFactory (mock | ibkr | etrade)
                         ✅ Broker-layer PDT enforcement hook (hard block at PDT limit before submit)
                         ✅ DynamoDB-backed PDT enforcer helper (`DynamoDBAccountPDTEnforcer`)
                         ✅ 3f Sandbox integration tests executed live (`tests/brokers/test_sandbox_integration.py`)
                         ✅ Sandbox integration runner (`scripts/run_sandbox_integration.py`, auto-loads `.env`)
                         ✅ E*TRADE HTTP gateway skeleton (`stocvest/brokers/etrade_http_gateway.py`)
                         ✅ E*TRADE OAuth helper (`stocvest/brokers/etrade_oauth.py`)
                         ✅ tests/brokers/test_mock_adapter.py (8 tests)
                         ✅ tests/brokers/test_factory.py (5 tests)
                         ✅ tests/brokers/test_ibkr_adapter.py (8 tests)
                         ✅ tests/brokers/test_etrade_adapter.py (6 tests)
                         ✅ tests/brokers/test_etrade_http_gateway.py (4 tests)
                         ✅ tests/brokers/test_etrade_oauth.py (4 tests)
                         ✅ tests/brokers/test_pdt_enforcement.py (5 tests)
✅ stocvest/api/       — Phase 4 complete
                         ✅ 4a Lambda function structure + shared utilities
                         ✅ API shared helpers (`response.py`, `shared.py`, typed Lambda event aliases)
                         ✅ Health handler scaffold (`handlers/health.py`)
                         ✅ 4b Cognito JWT authorizer (`auth.py`, `handlers/authorizer.py`)
                         ✅ 4c Market data endpoints (`handlers/market_data.py`)
                         ✅ 4d Signal endpoints (`handlers/signals.py`)
                         ✅ 4e Broker endpoints (`handlers/brokers.py`)
                         ✅ 4f Portfolio endpoints (`handlers/portfolio.py`)
                         ✅ 4g WebSocket handler (`handlers/websocket.py`)
                         ✅ 4h Scanner endpoints (`handlers/scanner.py`)
                         ✅ Broker gateway provider (`api/broker_gateway_provider.py`) resolves live gateways by env binding
                         ✅ Broker handlers reject caller-supplied gateway objects (`handlers/brokers.py`)
                         ✅ E*TRADE OAuth upgraded from PLAINTEXT placeholder to OAuth1 HMAC-SHA1 signer
                         ✅ WebSocket connection registry supports DynamoDB + TTL (`handlers/websocket.py`)
                         ✅ InMemoryWebSocketRegistry retained for development fallback only
                         ✅ tests/api/test_shared.py added (6 tests)
                         ✅ tests/api/test_response.py added (3 tests)
                         ✅ tests/api/handlers/test_health.py added (1 test)
                         ✅ tests/api/test_auth.py added (2 tests)
                         ✅ tests/api/handlers/test_authorizer.py added (3 tests)
                         ✅ tests/api/handlers/test_market_data.py added (6 tests)
                         ✅ tests/api/handlers/test_signals.py added (5 tests)
                         ✅ tests/api/handlers/test_brokers.py added (5 tests)
                         ✅ tests/api/handlers/test_portfolio.py added (4 tests)
                         ✅ tests/api/handlers/test_websocket.py added (5 tests)
                         ✅ tests/api/handlers/test_scanner.py added (5 tests)
                         ✅ tests/api/test_broker_gateway_provider.py added (3 tests)
                         ✅ tests/brokers/test_etrade_oauth.py extended:
                            - RFC OAuth1 HMAC-SHA1 signature verification
                            - live sandbox request-token integration path
                         ✅ tests/api/handlers/test_websocket.py extended:
                            - DynamoDB TTL refresh behavior
                            - dev-only fallback selection behavior
🚧 frontend/           — Phase 5 (started)
                         ✅ 5a initial auth foundation:
                            - Next.js app scaffold (`frontend/`, app router)
                            - token-based login + HTTP-only auth cookie
                            - protected dashboard route + auth middleware
                            - shared frontend API client bootstrap
                            - frontend unit tests (`frontend/tests/session.test.ts`, 3 tests)
                         ✅ 5b broker connectivity panel:
                            - broker health/accounts/positions fetched from backend APIs
                            - per-broker error handling in dashboard cards
                            - frontend unit tests for broker API orchestration (`frontend/tests/brokers-api.test.ts`, 2 tests)
                         ✅ 5c dashboard visualization cards:
                            - market session status, watchlist snapshots, and latest headlines on dashboard
                            - market orchestration layer (`frontend/lib/api/market.ts`) using `/v1/market/status|snapshot|news`
                            - frontend unit tests for market API orchestration (`frontend/tests/market-api.test.ts`, 2 tests)
                         ✅ 5d order entry UI:
                            - dashboard order form (broker/account/symbol/side/type/qty/prices)
                            - server action submits orders to `/v1/brokers/orders` via authenticated API client
                            - frontend broker API tests extended for order submission (`frontend/tests/brokers-api.test.ts`, +1 test)
                         ✅ 5e trade journal UI:
                            - journal API handlers (`GET/POST /v1/journal/entries`) backed by shared TradeJournal engine
                            - dashboard journal panel with entry form + recent entries list
                            - frontend journal API client + tests (`frontend/tests/journal-api.test.ts`, 2 tests)
                            - backend journal handler tests (`tests/api/handlers/test_journal.py`, 2 tests)
                         ✅ 5f PDT widget:
                            - PDT status API handler (`GET /v1/pdt/status`) derived from user journal day-trade entries
                            - dashboard PDT status widget (OK/WARNING/BLOCKED with next-trade allowance)
                            - frontend PDT API client + test (`frontend/tests/pdt-api.test.ts`, 1 test)
                            - backend PDT handler tests (`tests/api/handlers/test_pdt.py`, 2 tests)
                         ✅ 5g scanner dashboard panel:
                            - scanner API orchestration (`frontend/lib/api/scanner.ts`) for gaps/catalysts/intraday/briefing
                            - dashboard scanner overview panel + briefing preview (`frontend/components/scanner-overview-panel.tsx`)
                            - frontend scanner API tests (`frontend/tests/scanner-api.test.ts`, 2 tests)
                         ✅ 5h options chain viewer:
                            - market options API handler (`GET /v1/market/options`) wired to Polygon options chain
                            - dashboard options chain table with Greeks (delta/gamma/theta/vega) columns
                            - prominent UI banner: "Options data delayed by 15 minutes (Polygon Options Starter)"
                            - backend + frontend test coverage for options endpoint and client layer
                         ✅ 5i futures dashboard:
                            - futures panel consumes IBKR broker APIs (`/v1/brokers/health|accounts|positions`) and does not use Polygon
                            - explicit graceful fallback when TWS is unavailable/disconnected
                            - frontend tests for connected + unavailable scenarios (`frontend/tests/futures-api.test.ts`, 2 tests)
                         ✅ 5j crypto panel:
                            - crypto market bars sourced from Polygon Currencies Starter via `/v1/market/bars`
                            - explicit UI statement that on-chain metrics are not included (deferred scope)
                            - frontend crypto API tests (`frontend/tests/crypto-api.test.ts`, 1 test)
                         ✅ 5k portfolio view:
                            - multi-broker portfolio summary aggregation across broker/accounts
                            - disconnected broker/account failures are isolated to per-account cards (partial data still renders)
                            - frontend portfolio API tests (`frontend/tests/portfolio-api.test.ts`, 1 test)
                         ✅ 5l PDT tracker widget hardening:
                            - shows current day trade count, days until reset, and next-trade allowance
                            - explicit warning message when count reaches 2 day trades
                            - backend PDT API now returns `current_day_trade_count` + `days_until_reset`
                            - deterministic edge-case tests for warn-at-2, at-limit, weekend-as_of behavior
                         ✅ Dashboard/broker/scanner performance hardening:
                            - broker aggregation endpoint used for one-call health+accounts+positions per broker
                            - scanner endpoints consume real market data inputs and use 60s server-side cache
                            - futures fetch parallelized with scanner/options/crypto batch on dashboard load
                            - portfolio overview derived from aggregated broker snapshot (no extra portfolio fetch)
                         ✅ Additional test hardening completed:
                            - direct DynamoDB store unit tests for journal + PDT persistence services
                            - scanner cache tests extended for TTL expiry and payload-key isolation
                            - broker overview failure-path and PDT query edge-case tests added
🚧 infra/              — Phase 6 (Terraform)
                         ✅ 6a: VPC, subnets, NAT, route tables, security groups, S3 remote state (`use_lockfile`), tags
                         ✅ 6b: DynamoDB (Terraform) — contract tables; PAY_PER_REQUEST; TTL on `Alerts`; tags — apply + env wiring still pending
                         ✅ 6c: ElastiCache Redis (Terraform) — single-node `cache.t3.micro`, Redis 7.x, private subnets, data SG, parameter group; `REDIS_URL` outputs — apply pending
                         ✅ 6d: ECS (Terraform) — cluster `stocvest-development`, Fargate task def `ibeam` port 4002; apply pending
                         ✅ 6e: Lambda + API Gateway (Terraform) — Lambdas, HTTP + WS APIs, `/v1/*` routes — apply pending
                         ✅ 6f: Cognito (Terraform) — pool `stocvest-development`, SPA + authorizer clients, JWT wired to HTTP API (tfvars overrides optional) — apply pending
                         ✅ 6g: EventBridge Scheduler (America/New_York) → scanner Lambda; IAM + Lambda permission; distinct schedule payloads (`premarket` / `intraday` / `eod_summary`)
                         ✅ 6h: Vercel — `frontend/vercel.json` (Next.js, `iad1`, www→apex redirect); env vars documented from Terraform outputs; PR previews via default Vercel Git behavior
                         ✅ 6i: GitHub Actions — CI on push/PR; `main` deploys Lambda zip to S3 + `update-function-code`; Vercel production via deploy hook; secrets documented in root `README.md`
```

---

## Key Decisions Made

1.  Stack: Next.js frontend on Vercel + Python Lambda backend on AWS
2.  Brokers: IBKR (TWS via ib_insync on ECS Fargate) + ETrade (OAuth REST)
3.  Market data: Polygon.io (replaces Alpha Vantage)
4.  Multi-tenant: Full user isolation at every layer
5.  Assets: Stocks, ETFs, Options, Futures, Crypto
6.  Signal layers: Technical + News + Sector + Macro + Geopolitical + Internals
7.  AI synthesis: Claude API (Sonnet) → structured JSON verdict
8.  Deployment: Vercel (frontend) + AWS (everything else)
9.  TWS authentication: TOTP-based auto-auth via ibeam
10. Benzinga expansions: SKIP — Polygon news + Claude covers it better
11. Crypto on-chain data: DEFERRED — build crypto with technicals + news first
12. Domain: stocvest.app (US-only, no trademark risk)
13. Day trading: YES — proactive scanner added as Phase 2.5
14. Day trading data cost: $0 extra — Stocks Advanced already covers it
15. Level 2 order book: via IBKR TWS (free, already have account)

---

## Immutable Contracts (Do Not Change Without Discussion)

```
BrokerAdapter interface (API_CONTRACTS.md Section 1)
  - All 8 abstract methods are fixed
  - Return types are fixed
  - Exception types are fixed
  - Adding methods requires updating ALL adapters + tests

Signal data model (DATA_MODELS.md Section 6)
  - SignalLayer enum values are fixed
  - Verdict structure is fixed
  - REGIME_WEIGHTS keys are fixed

API endpoint paths (API_CONTRACTS.md Section 4)
  - Changing paths breaks frontend
  - Versioned at /v1/ — breaking changes go to /v2/

DynamoDB table names:
  Users, BrokerConnections, Watchlists, Alerts, Orders, DayTradingSetups
  - Changing names requires migration

Secrets Manager path format:
  /stocvest/{userId}/brokers/{brokerId}
  - Changing breaks credential retrieval for all users

Data model canonical types (stocvest/data/models.py):
  - All downstream code uses these types — never raw Polygon dicts
  - Changing field names requires updating all callers
```

---

## Known Issues / Technical Debt

```
- pyproject.toml uses setuptools.backends which requires setuptools>=68.
  On some systems pip install -e . may warn. Workaround: pip install setuptools --upgrade first.
- Stochastic d_result alignment uses a manual padding loop — could be cleaner.
  Not a correctness issue, flagged for future refactor.
- PDT rolling window uses Mon–Fri only (no NYSE holiday set). For broker-identical
  counts, add an exchange calendar when integrating execution.
```

---

## Open Questions

```
1. Polygon.io plans — RESOLVED ✅
   Stocks Advanced:    $1,920/y  real-time WebSocket, 1-min bars, trades,
                                 NBBO quotes, snapshot API, pre/after-hours
   Options Starter:    $288/y   Greeks, IV, Open Interest (15-min delay)
   Currencies Starter: $468/y   Crypto + Forex real-time WebSocket
   Indices Basic:      $0       End of day, sufficient for VIX/internals
   Total Polygon:      $2,676/y

2. ETrade sandbox credentials — RESOLVED ✅
   Connected locally via `.env` and exercised in Phase 3f sandbox harness.

3. IBKR paper trading account — RESOLVED ✅
   Paper path configured locally and exercised in Phase 3f sandbox harness.

4. Domain name — RESOLVED ✅
   Domain: stocvest.app — registered at Cloudflare

5. AWS account — UNRESOLVED ⏳
   New dedicated account or existing?

6. Crypto on-chain data — DEFERRED 🔜

7. Futures data source — RESOLVED ✅
   Use IBKR TWS — free through existing account.
```

---

## Complete Data & Cost Picture

```
SERVICE                              COST/YEAR    PURPOSE
────────────────────────────────────────────────────────────────────
Polygon Stocks Advanced              $1,920       Stocks, ETFs, real-time
Polygon Options Starter              $288         Options chain, Greeks, IV
Polygon Currencies Starter           $468         Crypto real-time
IBKR TWS (existing account)          $0           Futures, Level 2, execution
stocvest.app domain                  ~$25         Cloudflare Registrar
Vercel Pro (frontend)                $240         Hosting + CDN
AWS (Lambda, ECS, DynamoDB etc.)     ~$125-380    Backend infra
Claude API (Sonnet)                  ~$200-600    AI synthesis
                                    ────────
Total estimated annual cost          ~$3,266-3,921
```

---

## Day Trading Scanner — Design Summary

```
SCAN SCHEDULE
  8:00 AM ET  Pre-market scan
    └── Gap scanner (>2% gap on volume)
    └── Earnings movers
    └── News catalyst detector
    └── Output: top 5-8 ranked setups

  9:30 AM ET  Market open
    └── WebSocket connects for flagged stocks
    └── Opening range established (first 15 min)
    └── VWAP calculated real-time

  Every 5 min  Intraday scanner
    └── ORB breakout detection
    └── VWAP reclaim detection
    └── 9 EMA bounce on 1-min chart
    └── High/Low of day breakout
    └── PDT rule tracker per user

  3:45 PM ET  EOD summary

KEY SIGNALS (day trading specific)
  VWAP, Opening Range, 9 EMA (1-min), Level 2, Volume surge, Pre-market gap

PDT RULE TRACKER
  Track day trades per user (max 3 in 5 days under $25k account)
  Warn at 2 trades, block at 3 unless account > $25k confirmed
```

---

## Build Order (Final)

```
Phase 1 — Core Infrastructure                         ✅ COMPLETE
  1a. Python project structure + virtual env setup    ✅
  1b. Polygon.io data service                         ✅
  1c. Technical indicators engine                     ✅
  1d. Tests for all technical calculations            ✅ (66/66)

Phase 2 — Swing Trading Signal Engine                 ✅ COMPLETE
  2a. News sentiment scorer (Claude API)              ✅
  2b. Macro event detector                            ✅
  2c. Geopolitical scanner (Claude web search)        ✅
  2d. Signal weighting + composite score              ✅
  2e. AI synthesis prompt builder + response parser    ✅
  2f. Tests for signal engine                         ✅

Phase 2.5 — Day Trading Scanner                       ✅ COMPLETE
  2.5a. Pre-market gap scanner                        ✅
  2.5b. News catalyst detector                        ✅
  2.5c. VWAP calculator (real-time intraday)         ✅
  2.5d. Opening range breakout detector              ✅
  2.5e. 9 EMA on 1-min bars                          ✅
  2.5f. Intraday setup scanner (every 5 min)         ✅
  2.5g. PDT rule tracker (per user, DynamoDB)        ✅
  2.5h. Daily briefing generator                      ✅
  2.5i. Trade journal                                 ✅
  2.5j. Tests for all scanner components (+ utils/models/package smoke) ✅

Phase 3 — Broker Layer                               ✅ COMPLETE
  3a. BrokerAdapter base class + exceptions          ✅
  3b. MockAdapter (for all testing)                  ✅
  3c. IBKRAdapter (TWS via ib_insync) + L2 + futures  ✅ (gateway-backed adapter complete)
  3d. ETradeAdapter (OAuth REST)                     ✅ (gateway-backed adapter complete)
  3e. BrokerAdapterFactory                           ✅
  3f. Integration tests against broker sandboxes     ✅

Phase 4 — API Layer                                  ✅ COMPLETE
  4a. Lambda function structure + shared utilities   ✅
  4b. Cognito JWT authorizer                         ✅
  4c. Market data endpoints                          ✅
  4d. Signal endpoints (swing + day trading)         ✅
  4e. Broker endpoints                               ✅
  4f. Portfolio endpoints                            ✅
  4g. WebSocket handler                              ✅
  4h. Scanner endpoints                              ✅

Phase 5 — Frontend (Next.js on stocvest.app)             🚧 IN PROGRESS
  5a. Auth foundation (scaffold + session + guarded routes) ✅
  5b. Broker connectivity UI                              ✅
  5c. Market/signal dashboard cards                       ✅
  5d. Order entry UI                                      ✅
  5e. Trade journal UI                                    ✅
  5f. PDT widget                                           ✅
  5g. Scanner overview panel                               ✅
  5h. Options chain viewer                                 ✅
  5i. Futures dashboard                                    ✅
  5j. Crypto panel                                         ✅
  5k. Portfolio view                                       ✅
  5l. PDT tracker widget hardening                         ✅

Phase 6 — Infrastructure (Terraform)                   🚧 IN PROGRESS
  6a. VPC, subnets, security groups, NAT               ✅
  6b. DynamoDB (contract tables + TTL on Alerts)       ✅ (Terraform in repo; apply pending)
  6c. Redis (ElastiCache single-node dev)               ✅ (Terraform in repo; apply pending)
  6d. ECS (Fargate cluster + TWS/ibeam task definition)  ✅ (Terraform in repo; apply pending)
  6e. Lambda + HTTP/WebSocket API Gateway               ✅ (Terraform in repo; apply pending)
  6f. Cognito (user pool + app clients + JWT wiring)    ✅ (Terraform in repo; apply pending)
  6g. EventBridge (Scheduler → scanner Lambda)         ✅ (Terraform in repo; apply pending)
  6h. Vercel (`frontend/vercel.json` + env mapping)     ✅ (config in repo; project + domain wiring pending)
  6i. CI/CD (GitHub Actions)                             ✅ (workflow in repo; secrets + S3 bucket + hooks pending)

Phase 7 — Testing & Hardening
  7a. End-to-end test suite
  7b. Security audit (multi-tenant isolation)
  7c. Load testing
  7d. Paper trading validation — swing (2 weeks minimum)
  7e. Paper trading validation — day trading (2 weeks minimum)
  7f. Staged rollout to real trading
```

---

## Rules for Every Session

1. **Read this file first** before writing any code
2. **One phase at a time** — don't jump ahead
3. **Tests before moving on** — phase N must pass before phase N+1
4. **Update this file** at end of every session
5. **Flag uncertainty** — especially on financial math and broker APIs
6. **Never skip paper trading** — minimum 2 weeks per trading mode
7. **Never hardcode credentials** — always Secrets Manager
8. **Never log sensitive data** — no prices, accounts, or credentials in logs
9. **PDT rule is non-negotiable** — always enforce, never bypass

UI Redesign Plan
Status: Not started — begins after CONTEXT.md update
Decision: Full UI redesign before Phase 7
Reason: Current UI is a developer dashboard with no visual hierarchy and does not communicate product differentiation
Design Goals:

Elegant, minimal, wow factor
TradingView meets Apple design language
Dark theme by default, light theme available
User theme preference persisted in localStorage
Google-level simplicity — one primary focus per screen
Easy navigation, everything one click away

Design System:

Dark theme base: deep navy/charcoal (#0a0e1a)
Accent: electric blue (#3b82f6)
Green for bullish: #22c55e
Red for bearish: #ef4444
Amber for caution: #f59e0b
Typography: clean modern sans-serif, monospace for prices
Tailwind CSS throughout, no inline styles
Framer Motion for page transitions and micro-animations
Recharts for all data visualizations

Navigation:

Sidebar with icons, collapsible to icons-only on mobile
Pages: Dashboard, Scanner, Signals, Portfolio, Options, Crypto, Futures, Journal, Settings
User email and sign out at bottom of sidebar
Theme toggle sun/moon icon in top bar

Core differentiators to highlight prominently in UI:

Signal Intelligence Panel — radar/spider chart of all 6 signal layers
Morning Briefing — hero feature at 8 AM with ranked setups
PDT Guardian — shield icon, trust and safety feature not a warning
Multi-broker cards — premium feel with real-time P&L
AI Verdict card — Claude as analyst not data feed
Signal Evidence Card — full reasoning transparency on every signal

Signal Evidence Card — most important component:
Every signal verdict must show full reasoning:

Verdict header: symbol, direction, confidence gauge 0-100%
Signal layer breakdown: one row per layer with icon, status, weight, plain English explanation, key data points
Layers: Technical (📊), News Sentiment (📰), Macro (🌍), Sector (🏭), Geopolitical (🌐), Internals (📈)
AI verdict: Claude assessment displayed as analyst quote
Risk factors: contradicting layers highlighted in amber
Key levels: support, resistance, VWAP, opening range high/low
Confidence breakdown: bar chart showing each layer contribution
Transparency principle: users always see exactly what drove the signal
Never show REGIME_WEIGHTS or internal formulas — verdicts and explanations only

Landing Page — public route at /:

Full viewport hero: dark navy, animated background, bold headline
Headline: Trade with institutional intelligence.
Subheadline: Six signal layers. AI synthesis. Multi-broker execution. Built for serious retail traders.
Two CTAs: Start Free Trial (primary) and Watch Demo (secondary)
Section 2: The Problem — old way vs STOCVEST way, three columns
Section 3: Signal Intelligence — animated radar chart, 6 layers animate in on scroll, example verdict card
Section 4: Morning Briefing — animated 8 AM briefing mockup
Section 5: Comparison table vs ThinkorSwim, Unusual Whales, Finviz
AI Synthesis:      STOCVEST ✅  ThinkorSwim ❌  Unusual Whales ❌  Finviz ❌
Multi-broker:      STOCVEST ✅  ThinkorSwim ❌  Unusual Whales ❌  Finviz ❌
Signal Reasoning:  STOCVEST ✅  ThinkorSwim ❌  Unusual Whales ❌  Finviz ❌
Pre-market Intel:  STOCVEST ✅  ThinkorSwim ❌  Unusual Whales ❌  Finviz ❌
PDT Guardian:      STOCVEST ✅  ThinkorSwim ❌  Unusual Whales ❌  Finviz ❌
Day plus Swing:    STOCVEST ✅  ThinkorSwim ✅  Unusual Whales ❌  Finviz ❌
Section 6: PDT Guardian — shield icon with green glow animation
Section 7: Pricing — Free $0, Pro $49/mo, Institutional $199/mo
Section 8: Final CTA — full width dramatic dark section
Footer: © 2026 STOCVEST LLC | Terms | Privacy | Not investment advice
Authenticated users redirect to /dashboard automatically

Redesign Phases:

Phase A: Design system — colors, typography, spacing, theme provider with localStorage ✅ COMPLETE
Phase B: Navigation — sidebar, routing, theme toggle, collapsible mobile ✅ COMPLETE
Phase C: Dashboard — hero market sentiment, stat cards, PDT guardian, headlines feed ✅ COMPLETE
Phase D: Individual pages — Scanner, Signals with evidence card, Portfolio, Journal, Options, Settings
Phase E: Landing page — full public marketing page with animations
Phase F: Signal Evidence Card — reasoning transparency on all signal views

Rules:

Backend code untouched during redesign
npm run build and npm run test after every phase
Mobile responsive throughout
Commit after every phase with passing tests


Order Execution — Current State and Gaps
How it works:

STOCVEST routes orders to users own brokerage accounts
STOCVEST never holds customer funds or securities
Users authenticate directly with their broker
ETrade: OAuth, user logs in on ETrade website, STOCVEST gets access token
IBKR: IB Gateway connection, credentials handled by ibeam
Orders placed via official broker API into user own account

What exists:

BrokerAdapter base class with PDT enforcement at submission
MockAdapter: fully working, simulates fills instantly
IBKRAdapter: built, needs ECS Fargate TWS container running
ETradeAdapter: built, needs OAuth UI flow in frontend
Order entry UI: exists but missing safety gates
POST /v1/brokers/{broker}/orders endpoint: exists

Critical gaps before real money:

Order confirmation screen — full details and dollar value before submit
Paper vs live mode toggle — paper default, live requires typing CONFIRM LIVE TRADING
Order status tracking — pending, filled, rejected with fill price and reason
ETrade OAuth UI flow — connect button, redirect, callback, token storage
Auto journal on fill — automatic entry creation when order fills
Trade This Setup button — on every signal card, pre-fills form and captures signal context

Safety rules non-negotiable:

Paper mode is always the default
No auto-execution without explicit user confirmation
Every order shows dollar value before confirmation
PDT guardian checks before every submission
2 weeks paper trading minimum before real money
Phase 7 security audit must complete before real money
Legal disclaimers on every order screen


Trade Journal — Current State and Plan
Current state:

Manual entry only
No automatic capture
No signal context recorded
No exit tracking
No analytics

Why this is critical:

Manual journals do not get filled in consistently
Without automatic capture there is no performance data
Without performance data there is no data flywheel
Without data flywheel there is no competitive moat

Required implementation:

Auto-capture on order fill
When place_order() succeeds automatically create journal entry
Capture: symbol, side, quantity, fill price, timestamp, broker, is_day_trade, signal_id
Wire into broker layer so all adapters capture automatically
Signal context capture
Add signal_context parameter to order flow
When Trade This Setup clicked pass verdict, confidence, active layers, setup type
Store with journal entry automatically
Link trade to signal via signal_id foreign key
Exit tracking
When position closes calculate P&L, hold time, winner/loser
Update original journal entry with exit data automatically
Compute: entry price vs exit price, dollar P&L, percent P&L, hold duration
Journal analytics
Win rate: winners divided by total trades
Average winner vs average loser
Best performing setup types ranked by win rate
Best performing times of day
P&L chart over time using Recharts
Current win/loss streak tracker
Expectancy = (win rate x avg winner) minus (loss rate x avg loser)
Trade This Setup button
On every signal card and scanner setup
Pre-fills order entry form with symbol and suggested size
Captures signal context for journal automatically
Creates the complete signal to trade to outcome loop


Self-Improvement Architecture
Current state: static signal weights, no feedback loop
Target: continuously learning system that improves weekly
Four improvement loops:
Loop 1 — Signal Weight Tuning
Weekly analytics job measures per-layer win rates
Weight advisor suggests adjustments max 5% per layer per week
Minimum 100 signals per layer before suggesting changes
Human admin review required before applying any change
Full audit trail of every weight change with reasoning
Loop 2 — Claude Prompt Refinement
Every signal stores prompt_version field
A/B testing: 50% control, 50% variant
Promote variants that outperform control by more than 5%
Discard variants that underperform
Loop 3 — Setup Pattern Recognition
Track win rates per setup type: ORB, VWAP, gap, 9 EMA
Scanner ranks setups by historically proven win rates
Minimum 50 occurrences before including in rankings
Loop 4 — Market Regime Adaptation
Detect regime: bull/bear/sideways, high/low VIX, trending/ranging
Apply regime-specific weight adjustments
Validate adjustments against historical regime performance
New components to build:
stocvest/signals/performance_tracker.py
record_signal_verdict() — writes to SignalPerformance table
update_signal_outcomes() — fetches Polygon prices and fills outcomes
get_layer_accuracy(layer, days) — win rate per layer
get_setup_accuracy(setup_type, days) — win rate per setup
stocvest/signals/analytics_engine.py
Runs every Sunday 6 AM ET via EventBridge
Computes per-layer win rates for 30/60/90 day windows
Computes per-setup-type win rates
Computes per-market-regime win rates
Computes per-time-of-day win rates
Stores results in SignalAnalytics DynamoDB table
Generates weight adjustment suggestions
stocvest/signals/weight_advisor.py
Reads SignalAnalytics table
Computes suggested REGIME_WEIGHTS adjustments
Stores in WeightSuggestions table with reasoning
Never auto-applies — human review only
stocvest/api/handlers/admin.py
Weekly summary email to admin
Shows accuracy trends and suggested weight changes
POST /v1/admin/weights/approve
POST /v1/admin/weights/reject
New DynamoDB tables needed:
SignalPerformance
PK: signalId
Fields: userId, symbol, verdict, confidence, signalLayers,
setupType, promptVersion, price_at_signal, timestamp,
price_1h_after, price_1d_after, price_1w_after,
outcome_1h, outcome_1d, outcome_1w
GSI 1: verdict-timestamp-index
GSI 2: setupType-timestamp-index
GSI 3: userId-timestamp-index
Retention: PERMANENT — never add TTL
SignalAnalytics
PK: weekStartDate
SK: metricType
Retention: PERMANENT
WeightSuggestions
PK: suggestionId
SK: createdAt
GSI: status-index
Retention: PERMANENT
Human oversight principle:
AI measures and suggests
Human admin reviews and approves
System implements approved changes only
Every change logged permanently
Timeline:
Month 1: data collection only, no adjustments
Month 2: first suggestions generated for review
Month 3: first approved adjustments applied
Month 6: measurable accuracy improvement visible
Year 1: publishable accuracy track record

Data Architecture and Retention Policy
Two buckets of all data:
BUCKET 1 — Personal Data (belongs to user)
What: email, name, preferences, broker connections, OAuth tokens
Where: Cognito and Users DynamoDB table and Secrets Manager
On deletion: permanently deleted immediately
On inactivity 2 years: 30-day warning email then permanently deleted
BUCKET 2 — Anonymized Behavioral Data (STOCVEST asset)
What: trade outcomes, signal performance, win/loss records, setup results
Where: Journal, Orders, SignalPerformance, SignalAnalytics tables
On deletion: userId replaced with string ANONYMIZED, all other fields kept
Legal basis: anonymized data is not personal data under CCPA and GDPR
Business purpose: signal improvement, backtesting, moat
Retention: PERMANENT
Complete retention schedule:
DATA TYPE                    RETENTION    STORAGE
Signal performance           Forever      DynamoDB permanent
Trade journal anonymized     Forever      DynamoDB permanent
Weight change history        Forever      DynamoDB permanent
Prompt version history       Forever      DynamoDB permanent
Personal data active user    While active Cognito
Personal data inactive 2yr   Delete       After 30-day warning
Order audit logs             7 years      S3 Glacier
PDT decision logs            7 years      S3 Glacier
Admin action logs            7 years      S3 Glacier
Application error logs       90 days      CloudWatch
Market data snapshots        30 days      DynamoDB TTL
Real-time quotes             60 seconds   Redis TTL
Scanner results              300 seconds  Redis TTL
WebSocket connections        24 hours     Redis TTL
Raw Polygon bars             Do not store Fetch on demand
User deletion flow:
Step 1: Replace userId with ANONYMIZED in all behavioral tables
Step 2: Delete Users DynamoDB record
Step 3: Delete OAuth tokens from Secrets Manager
Step 4: Delete Cognito account
Step 5: Log deletion event to S3 audit bucket
Step 6: Confirm to user what was deleted and what was anonymized
Inactive user cleanup:
EventBridge: first of every month
Find users with last_login more than 2 years ago
Send reactivation email with 30-day warning
If no login within 30 days: anonymize and delete per above flow
Cost estimate at 1000 users after 10 years:
DynamoDB permanent tables: approximately $25/month
S3 Glacier audit logs: approximately $0.20/month
Total: negligible — never a cost reason to delete valuable data
10-year value:
Signal performance validated across multiple market cycles
Decade of continuously improving accuracy
Potential licensing asset for institutions
No competitor can shortcut time — data moat compounds annually

Competitive Moat Strategy
Reality: code can be replicated with AI tools in weeks
Real moat: data, trust, distribution, and iteration speed
Five pillars of defensibility:

Data flywheel
Track every signal verdict against actual price outcomes
After 6 months: dataset competitors cannot copy overnight
After 3 years: validated across multiple market regimes
Action: build SignalPerformance tracking before launch
Published performance track record
Public page at stocvest.app/performance
Shows aggregate signal accuracy with no login required
Launch when 30 days of real data exists
No competitor can fake historical accuracy
User workflow lock-in
Journal history, custom watchlists, connected brokers
Switching cost grows every day of use
Target: make journal and watchlists indispensable
Prompt quality iteration
Claude prompts stored in AWS Secrets Manager not in code
Prompt versions tracked, accuracy measured per version
Continuous improvement based on real market feedback
Distribution first mover advantage
Target: 100 serious traders in first 90 days
Strategy: Pro free for 90 days for first 100 users
Channels: fintwit, r/Daytrading, trading Discord servers
Goal: establish trust before competitors exist

Proprietary files — never expose internals in API responses:
stocvest/signals/composite_score.py       REGIME_WEIGHTS
stocvest/signals/news_sentiment.py        Claude prompts
stocvest/signals/geopolitical_scanner.py  Claude prompts
stocvest/signals/macro_events.py          Macro logic
stocvest/api/services/scanner_scheduled_pipeline.py  Ranking
Protection measures:
Repo stays private permanently
Signal endpoints return verdicts only, never weights or formulas
Claude prompts moved to AWS Secrets Manager
Rate limiting: 100 signal API calls per user per day
ToS prohibits scraping, reselling, reverse engineering

Legal and Business Structure
Entity: STOCVEST LLC Delaware
Formation method: Stripe Atlas $500 one-time
Status: In progress
What Stripe Atlas includes:
Delaware LLC formation
EIN from IRS
Stripe account activated
Mercury business bank account
Operating agreement
Registered agent first year free
Basic legal document templates
AWS credits and startup perks
Post-formation checklist:
Foreign qualification in home state $100-300
Move all STOCVEST expenses to Mercury account
AWS, Polygon, Anthropic, domain are all business expenses
Terms of Service using Termly.io as starting point
Privacy Policy CCPA compliant
Securities lawyer consultation 1 hour $300-500
Ask: RIA registration needed?
Ask: Broker-dealer registration needed?
Ask: Are disclaimers sufficient?
Update footer: 2026 STOCVEST LLC All rights reserved
What STOCVEST is:
SaaS signal platform
Order routing layer to users own broker accounts
Analytics and intelligence tool
What STOCVEST is not:
Registered investment advisor
Broker-dealer
Custodian of funds
Fund manager
Required legal disclaimers in app:
Footer every page: STOCVEST signals are for informational purposes only and do not constitute investment advice. You are solely responsible for your trading decisions.
Order confirmation: This order will be placed in your personal brokerage account. STOCVEST does not provide investment advice or manage your funds.
Signal cards: small Not investment advice label
Onboarding: explicit acknowledgment screen user must accept
Before charging users:
LLC formation complete
Terms of Service live on site
Privacy Policy live on site
Securities lawyer review complete
Stripe subscription configured

Future Features Backlog
PRIORITY 1 — Automatic Journal Capture
Auto-capture on every order fill via broker layer hook
Signal context captured when Trade This Setup clicked
Exit tracking with automatic P&L calculation
Journal analytics: win rate, avg winner/loser, setup performance, expectancy
Trade This Setup button on all signal and scanner cards
Note: manual journal exists but will not be used consistently
Note: this creates the performance data moat
PRIORITY 2 — Alerting System
Email alerts when setup triggers
Push notifications mobile
SMS for critical PDT warnings
Webhook support for power users
Note: Alerts DynamoDB table exists, nothing sends to users yet
PRIORITY 3 — Signal Performance Tracking
Track every verdict against actual price outcomes 1h, 1d, 1w
Performance dashboard with accuracy metrics
Public page at stocvest.app/performance
Per signal type win rate and average return
Note: credibility proof and primary marketing asset
PRIORITY 4 — Backtesting Engine
Run signal engine against 2 years of Polygon historical data
Win rate, average return, max drawdown per signal type
Backtest ORB, VWAP reclaim, 9 EMA bounce, gap strategies
Compare performance across bull, bear, sideways regimes
Note: number one credibility feature for serious traders
PRIORITY 5 — Watchlist Management
Create and edit named watchlists per user
Scanner runs on user watchlist not hardcoded symbols
Share watchlists between swing and day trading scanner
Wire to Watchlists DynamoDB table already exists
PRIORITY 6 — Paper Trading Mode UI
Toggle between paper and live in UI
Paper mode always default
Live mode requires typing CONFIRM LIVE TRADING
Track paper P&L separately from real P&L
MockAdapter exists but no UI toggle yet
Required before real money — 2 weeks minimum per rules
PRIORITY 7 — Onboarding Flow
Welcome screen explaining STOCVEST value proposition
Step-by-step broker connection wizard
First signal walkthrough with explanation
Empty states that guide rather than show no data
Legal acknowledgment screen user must accept
PRIORITY 8 — Risk Management Layer
Position sizing calculator percentage of portfolio per trade
Max daily loss limit with auto-stop if hit
Correlation warnings e.g. 80 percent long tech
Kelly criterion or fixed fractional sizing suggestions
PRIORITY 9 — Earnings Calendar Integration
Upcoming earnings for watchlist symbols
Flag earnings risk on open positions
Pre-earnings volatility signals
Post-earnings gap scanner
Note: Polygon has this data not yet wired in
PRIORITY 10 — Sector and Market Internals Dashboard
Sector rotation heatmap showing leaders and laggards
Market breadth: advance/decline, new highs/lows
VIX trend and regime indicator
Put/call ratio
PRIORITY 11 — Subscription and Monetization
Pricing tiers: Free $0, Pro $49/month, Institutional $199/month
Stripe integration via Atlas account already created
Feature gating by tier
Usage limits per tier
Referral program: invite a trader, both get free Pro month
PRIORITY 12 — Audit Trail for Orders
Every order attempt logged with timestamp
PDT decision logged with full reasoning
Signal that triggered trade recorded
Immutable audit log in S3 Glacier
PRIORITY 13 — Multi-Asset Signal Correlation
Cross-asset signals e.g. USD strength vs commodity weakness
Options flow vs price action divergence
Futures premium/discount vs spot price
Crypto correlation with risk assets
PRIORITY 14 — Mobile App
React Native or PWA wrapper
Push notifications for alerts
Mobile-optimized order entry
PDT guardian widget on home screen

Immediate Next Actions — Ordered by Priority

Fix GitHub Actions CI/CD
Add pip install --upgrade setuptools before pip install -e . in backend job
Fix deploy-vercel job to skip gracefully when VERCEL_DEPLOY_HOOK_URL is missing
File: .github/workflows/ci.yml
Add VERCEL_DEPLOY_HOOK_URL to GitHub secrets
Vercel project Settings → Git → Deploy Hooks
Create hook named github-actions on branch main
Add URL as secret in GitHub
Verify Lambda deployment after CI fix
Push to main, watch Actions tab
Confirm all 10 Lambda functions updated
Test: curl https://oumjg5j4z2.execute-api.us-east-1.amazonaws.com/v1/health
UI Redesign Phase A — Design system
Create frontend/lib/design-system.ts
Theme provider with localStorage persistence
Dark and light color palettes
UI Redesign Phase B — Navigation
Sidebar with icons and collapsible mobile
All page routes wired
Theme toggle button
UI Redesign Phase C — Dashboard
Hero section with market sentiment
Stat cards for SPY QQQ IWM
PDT Guardian as shield widget
Headlines feed on right panel
UI Redesign Phase D — Individual pages
Scanner, Signals with Evidence Card, Portfolio, Journal, Options, Settings
UI Redesign Phase E — Landing page
Full public marketing page with animations
Comparison table, pricing, CTAs
UI Redesign Phase F — Signal Evidence Card
Full reasoning transparency on every signal
6-layer breakdown with plain English explanation
Order execution safety gates
Confirmation screen with dollar value
Paper vs live mode toggle
Order status tracking
ETrade OAuth UI flow
Automatic journal capture
Auto-capture on fill via broker layer
Trade This Setup button
Exit tracking and P&L calculation
Journal analytics page
Self-improvement infrastructure
SignalPerformance tracking wired into signal generation
Hourly price outcome update job
Weekly analytics engine
Weight advisor with human review
Admin notification and approval flow
Data retention infrastructure
S3 Glacier audit bucket for 7-year logs
CloudWatch logs updated to 90-day retention
Market data TTL 30 days in DynamoDB
Inactive user cleanup job monthly
Audit logger utility wired into broker and PDT layers
Legal disclaimers throughout app
Footer on every page
Order confirmation disclaimer
Not investment advice on signal cards
Onboarding acknowledgment screen
Claude prompts to AWS Secrets Manager
Move all prompt strings from code to Secrets Manager
Load at Lambda cold start and cache
Add prompt_version field to all Claude API calls
Phase 7 — Testing and hardening
End-to-end test suite
Security audit: multi-tenant isolation, no PII leaks
Load testing: market open spike simulation
Paper trading validation 2 weeks swing
Paper trading validation 2 weeks day trading
Staged rollout to real trading
Beta launch to first 100 traders
LLC formation complete
Legal docs live
Securities lawyer sign-off
Pro free 90 days for first 100 users
Outreach to fintwit and r/Daytrading
