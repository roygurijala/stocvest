# STOCVEST — Session Context

**READ THIS FILE AT THE START OF EVERY SESSION**

This file tracks what has been built, what's in progress, what's broken,
and what must never be changed without explicit discussion.

---

## Current Status

**Phase:** 1 — Complete ✅ / Phase 2 — Complete ✅ / Phase 2.5 — Complete ✅ / Phase 3 — Complete ✅ / Phase 4 — Complete ✅
**Last Updated:** 2026-04-28
**Last Session:** Post-Phase-4 hardening — WebSocket registry migrated to DynamoDB (TTL-backed) with local-dev in-memory fallback

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

TEST STATUS: 282/282 passing ✅

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
❌ frontend/           — Phase 5 (not started)
❌ infra/              — Phase 6 (not started)
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

Phase 5 — Frontend (Next.js on stocvest.app)
  5a–5l. Auth, broker UI, dashboards, order entry, journal, PDT widget

Phase 6 — Infrastructure (Terraform)
  6a–6i. VPC, DynamoDB, Redis, ECS, Lambda, Cognito, EventBridge, Vercel, CI/CD

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
