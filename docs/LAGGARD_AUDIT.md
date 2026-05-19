# Laggard Intelligence Engine — Chunk 1 audit

**Date:** 2026-05-18  
**Scope:** Research only (no feature code).  
**Read first:** [`CONTEXT.md`](./CONTEXT.md), [`BACKLOG.md`](./BACKLOG.md).

---

## THINK — Chunk 1 answers

```text
Q1: Does Polygon client return prevDay data in snapshot responses?
YES. PolygonClient._parse_snapshot() reads ticker["prevDay"] for prev close (c)
and prior session volume (v). Exposed on Snapshot as prev_close and prev_day_volume.
change / change_percent are computed vs prev_close when last_trade_price is present.

Q2: Does the sector layer already fetch any peer/ETF prices?
YES, per-symbol via swing composite (not a static peer registry yet):
  - SPY, QQQ — macro context (snapshots + optional daily bars for weekly RS)
  - Sector ETF from SectorMapper.get_sector_etf() — e.g. AMZN → XRT (Retail)
  - Additional 10 daily bars on sector ETF when resolved (weekly mode)
No batch peer fetch for arbitrary registry lists today.

Q3: Does Polygon client support batch snapshots?
YES.
  - get_snapshots(symbols) — GET /v2/snapshot/.../tickers?tickers=A,B,C
  - get_snapshots_many(symbols, chunk_size=50) — chunks through get_snapshots
  - get_us_stocks_market_snapshots() — full-market paginated feed (plan-dependent)

Q4: Redis/Upstash set/get signature?
Primary (cluster / ElastiCache-style):
  from stocvest.utils.redis_client import get_sync_redis
  r = get_sync_redis()  # redis.Redis | None
  r.get(key)            # str | None (decode_responses=True)
  r.setex(key, ttl, value)
  r.set(key, value, ex=ttl)
  r.incr(key); r.expire(key, seconds)

Upstash (HTTP, dashboard market cache):
  from stocvest.data.dashboard_cache import upstash_configured, get_upstash
  r = get_upstash()  # upstash_redis.Redis
  r.get(key); r.set(key, json_str, ex=ttl)

Scanner response cache pattern:
  stocvest.api.services.scanner_response_cache.cache_get / cache_set

Q5: Where is the Claude/Haiku AI narrative prompt built?
No laggard-specific narrative exists yet (Chunk 5 will add laggard_narrative.py).
Existing Haiku (AI_MODEL_FAST = claude-haiku-4-5-20251001) call sites:
  1) stocvest/signals/ai_explanations.py
     - AIExplanationService.explain_signal_capture()
       system: "You are a signal analysis assistant. Output exactly 2 sentences..."
     - AIExplanationService.explain_news_synthesis()
       system: "You are a signal analysis assistant. Summarize what recent news means..."
     - _claude_text_or_none() → POST ANTHROPIC_API_URL with model AI_MODEL_FAST
  2) stocvest/signals/assistant_chat.py + assistant_prompts.ASSISTANT_SYSTEM_PROMPT
     - Product chatbot (not per-signal laggard copy)
  3) stocvest/signals/geo_exposure_llm.py — optional one-line geo exposure (Haiku)
  4) stocvest/signals/news_sentiment.py — article sentiment (Haiku default)

Q6: What does news_layer.verdict return?
String values: "bullish" | "bearish" | "neutral"
(Source: NewsAnalyzer in stocvest/signals/news_analyzer.py; also NewsLayerResult.verdict.)
Composite layers_out row uses verdict on the news layer dict (same strings).

Q7: Are daily bars (OHLCV) already fetched? How many days back?
YES in swing composite:
  client.get_bars(sym, Timeframe.DAY_1, limit=params.swing_technical.daily_bars_lookback)
Default daily_bars_lookback = 210 (stocvest/config/signal_parameters.py SwingTechnicalParameters).
Sector chain may fetch 10 daily bars on sector ETF + SPY for weekly RS.
Scanner swing setups: frontend posts bars_by_symbol; DailyBarScanner min_bars default 205.

Q8: What does sector layer output look like?
In-memory: SectorLayerResult (sector_analyzer.py)
  status, score, verdict, sector_etf, sector_name, sector_day_pct, spy_day_pct,
  relative_strength, sector_signal, reasoning, chips

API layers[] sector row (swing_composite_engine + sector_layer_api_extras):
  layer, status, score, verdict, reasoning, chips
  sector_resolution_state, sic_mapping_tier, sector_etf, sector_display_name,
  sector_bucket, sector_persistence, sector_sessions_leading, sector_total_sessions,
  sector_trending, sector_rank_1d, sector_rank_5d, sector_interpretation,
  sector_data_available, sector_daily_sessions (optional)

SectorMomentumScore (when momentum path used): persistence, sessions_leading,
total_sessions, rel_1d, rel_5d, trending, verdict, etc.

Q9: Does any code already track days_since_listing?
NO dedicated field or helper found (grep: no days_since_listing, no list_date usage).
PolygonClient.get_ticker_details(symbol) returns raw reference dict; Polygon typically
includes list_date in results — not wired today. Chunk 4B should compute from list_date
or skip IPO mode when missing (do not guess).

Q10: What is the "active universe" for dashboard/scanner?
There is no single backend constant for "all US stocks." Operational universes:

Scanner (client-driven, frontend/lib/api/scanner-load.ts):
  universe = unique(MARKET_PULSE_ANCHORS [SPY, QQQ] + gap symbols + user watchlist)
  fallback if empty: INTRADAY_FALLBACK_SYMBOLS (10 liquid names)
  optional cap: tuning.maxUniverseSymbols

Gap / morning brief (stocvest/data/scan_symbols.py):
  get_scan_symbols(user_id, watchlist_store) → user default watchlist ∪ SYSTEM_DEFAULTS, max 20

Scheduled scan (stocvest/api/services/scanner_scheduled_pipeline.py):
  merge(configured scanner_symbols, platform default-watchlist aggregation ≤30, SYSTEM_DEFAULTS) cap 40

Polygon fallback list (stocvest/data/scanner_universe.py):
  LIQUID_SYMBOLS_FALLBACK (~90 symbols) when full-market snapshot returns 403

Swing setups scan universe:
  Whatever symbols the client supplies in POST /v1/signals/swing/setups bars_by_symbol
  (typically scanner universe above)

Laggard price cache (Chunk 3): registry symbols + watchlist symbols — NOT full market.
Dynamic clusters (Chunk 4B): symbols present in PriceCache after warm (~150–200 target).

Note: Spec files watchlist_evaluator.py and setup_evolution_logger.py are not in repo.
Closest equivalents documented under Reusable Methods.
```

---

## Available Data (no new fetch needed)

| Data | Source | Notes |
|------|--------|--------|
| **1D % change vs prior close** | `Snapshot.change_percent` | From `prevDay.c` + `lastTrade.p` in `_parse_snapshot` |
| **Prior close / prev day volume** | `Snapshot.prev_close`, `prev_day_volume` | Direct from `prevDay` block |
| **Session OHLCV / VWAP** | `Snapshot.day_*` | May be dropped if scale mismatches last trade |
| **Daily OHLCV history** | `PolygonClient.get_bars(..., Timeframe.DAY_1, limit=N)` | Swing default **210** bars; scanner setups expect **≥205** |
| **Sector ETF + display name** | `SectorMapper` in swing engine | Per-symbol SIC → ETF (e.g. XRT); not static peer groups |
| **SPY / QQQ snapshots** | Swing composite `asyncio.gather` | Macro + sector relative strength |
| **Sector persistence / sessions leading** | `SectorMomentumScore` + `sector_layer_api_extras` | `sector_persistence`, `sector_sessions_leading`, `sector_total_sessions` |
| **News gate** | `layers[].verdict` for `news` | `bullish` \| `bearish` \| `neutral` |
| **Earnings proximity** | Swing composite top-level | `earnings_days_away`, `earnings_risk` (from `earnings_calendar.py`) |
| **Technical score / verdict** | Swing `tech` layer | Map to structure: intact / weak / unknown (Chunk 6) |
| **Batch snapshots** | `get_snapshots` / `get_snapshots_many` | Up to 50 tickers per request |
| **Redis caching patterns** | `scanner_response_cache`, `ai_explanations`, rate limits | Key prefix `stocvest:*` |

---

## Data Gaps (need new fetches or computation)

| Gap | Chunk | Notes |
|-----|-------|--------|
| **Static multi-group peer registry** | 2 | Not present; only dynamic SIC→ETF mapping |
| **Cross-peer 1D/5D moves at scale** | 3 | Need `PriceCache` warm for registry + watchlists |
| **20D average volume ratio** | 3 | Derive from daily bars in cache (`vol_avg_20d`) |
| **Laggard detection + narrative** | 4A–5 | Greenfield |
| **Dynamic clusters / dominance** | 4B | Greenfield; universe = cache keys only |
| **`days_since_listing` / IPO flag** | 4B | Call `get_ticker_details` → `list_date`; no existing helper |
| **`laggard_signal` on swing composite** | 6 | Field does not exist on response yet |
| **Pre-IPO activation Redis key** | 6, 9 | `stocvest:pre_ipo_active:{date}` not implemented |
| **Dedicated laggard HTTP endpoints** | 8 | `GET .../laggard`, `GET .../scanner/laggards` |
| **Weekly timeframe / unlock forecast** | 7 | Greenfield (`weekly_timeframe`, `unlock_forecast`) |
| **WatchlistRepository.get_all_active_symbols()** | 3 | Spec name not in repo; use `scan_default_watchlists` + per-user symbols |

---

## Reusable Methods

### Polygon (`stocvest/data/polygon_client.py`)

| Method | Use for laggard |
|--------|-----------------|
| `get_snapshot(symbol)` | Symbol 1D move via `change_percent` |
| `get_snapshots` / `get_snapshots_many` | Warm many registry symbols |
| `get_bars(symbol, Timeframe.DAY_1, limit=25..35)` | 5D change, 20D vol avg, weekly agg |
| `get_ticker_details(symbol)` | Future `list_date` → IPO mode |
| `get_us_stocks_market_snapshots()` | Optional; plan may 403 — use `LIQUID_SYMBOLS_FALLBACK` |

**Rate limiting:** `await_polygon_rest_slot()` uses Redis key `stocvest:rl:polygon:{epoch_second}` with limit `STOCVEST_POLYGON_RATE_PER_SEC` (default **30**/sec in config). Polygon module header notes Stocks Advanced unlimited REST; STOCVEST still throttles client-side.

**`/v2/aggs/ticker/{sym}/range/1/day`:** Used internally by `get_bars` — compatible with current client (verify plan in prod; no separate block found in code).

### Sector (`stocvest/signals/sector_analyzer.py`, `sector_momentum.py`, `composite_sector_wire.py`)

- `SectorAnalyzer.analyze(...)` → day % vs SPY, verdict, chips  
- `sector_layer_api_extras(...)` → persistence fields for unlock forecast (Chunk 7)  
- Not a substitute for peer-group lag detection

### Swing composite (`stocvest/api/services/swing_composite_engine.py`)

- Fetches: symbol daily bars (210), snapshot, SPY/QQQ/VIX, sector ETF snapshot + optional 10d bars  
- Builds `layers_out[]` with per-layer `verdict`, `score`, `status`  
- Sets `fundamental_context`, earnings fields, `news_verdict` in evidence payload  
- **Integration point (Chunk 6):** after layers complete, call `compute_laggard_signal(...)` → `response["laggard_signal"]`

### Watchlist / maturation (spec path aliases)

| Spec path | Actual path | Role |
|-----------|-------------|------|
| `watchlist_evaluator.py` | **Not found** | Use `watchlist_maturation_sync.py`, `workers/watchlist_maturation_refresh.py`, `watchlist_scanner_alerts.py`, `scanner_scheduled_pipeline.py` |
| `setup_evolution_logger.py` | **`api/services/watchlist_maturation_transition_log.py`** | `try_log_maturation_transition()` writes `WatchlistMaturationTransition` rows when maturation state changes |

### Config (`stocvest/utils/config.py`)

- `redis_url` / `REDIS_URL` (default `redis://localhost:6379`)  
- `stocvest_disable_redis`  
- `upstash_redis_rest_url` / `upstash_redis_rest_token` (dashboard cache; optional in Lambda secrets merge)  
- `polygon_api_key`, `polygon_rate_limit_per_second`  
- No `DYNAMODB_OUTCOMES_TABLE` in grep for laggard; verify before Chunk 9 if needed

### Active universe helpers

| Module | Function | Universe |
|--------|----------|----------|
| `data/scan_symbols.py` | `get_scan_symbols` | Watchlist ∪ defaults, max 20 |
| `data/scanner_universe.py` | `LIQUID_SYMBOLS_FALLBACK` | ~90 liquid symbols |
| `api/services/scanner_scheduled_pipeline.py` | `_resolve_scheduled_scan_symbols` | Config + platform WL, cap 40 |
| `frontend/lib/api/scanner-load.ts` | `runScannerLoadWithoutBrief` | Gaps + anchors + watchlist (+ cap) |

**Watchlist symbol aggregation for cache warm (Chunk 3):** implement via `WatchlistStore.scan_default_watchlists(limit)` (see `data/watchlist_store.py`) — there is no `get_all_active_symbols()` today.

---

## AI Prompt Location and Current Prompt

| Surface | File | Function | Model |
|---------|------|----------|-------|
| Signal capture explanation | `signals/ai_explanations.py` | `explain_signal_capture` → `_claude_text_or_none` | `AI_MODEL_FAST` (Haiku) |
| News synthesis | `signals/ai_explanations.py` | `explain_news_synthesis` | Same |
| Assistant chat | `signals/assistant_chat.py` | `AssistantChatService.reply` | Haiku + `ASSISTANT_SYSTEM_PROMPT` |
| Geo one-liner | `signals/geo_exposure_llm.py` | `try_claude_geo_exposure_line` | Haiku |
| News article score | `signals/news_sentiment.py` | Claude sentiment | Haiku default |

**Capture system prompt (verbatim excerpt):**

```text
You are a signal analysis assistant. Output exactly 2 sentences explaining
why this trading setup qualifies from the data given. Be specific.
Never give investment advice. End with: Signal data only.
```

**News system prompt (verbatim excerpt):**

```text
You are a signal analysis assistant. Summarize what recent news means for this
trading setup in 2-3 sentences. Be specific to the headlines provided.
Never give investment advice. Signal data only.
```

**Laggard narratives (Chunk 5):** deterministic builders first; optional Haiku only if product later requires — not in codebase today.

---

## Redis Helper Signature

```python
# Sync Redis (preferred for laggard price cache + scanner cache)
from stocvest.utils.redis_client import get_sync_redis, redis_available

r = get_sync_redis()  # None if disabled/unreachable
if r:
    r.get("stocvest:price:NVDA:5d_change")
    r.setex("stocvest:price:NVDA:5d_change", 90000, "4.2")  # TTL seconds
    r.set("stocvest:dynamic_clusters:2026-05-18", json.dumps([...]), ex=600)

# Upstash (dashboard / market-wide cache only today)
from stocvest.data.dashboard_cache import upstash_configured, get_upstash

if upstash_configured():
    u = get_upstash()
    u.get(key)
    u.set(key, payload, ex=ttl)
```

**Proposed laggard keys (Chunks 3, 6, 9):**

| Key | TTL | Purpose |
|-----|-----|---------|
| `stocvest:price:{SYMBOL}:5d_change` | 25h | Float % |
| `stocvest:price:{SYMBOL}:vol_avg_20d` | 25h | Float |
| `stocvest:price:{SYMBOL}:close_history` | 25h | JSON array |
| `stocvest:price:{SYMBOL}:updated_at` | 25h | ISO timestamp |
| `stocvest:dynamic_clusters:{date}` | 10m (session refresh) | Serialized clusters |
| `stocvest:pre_ipo_active:{date}` | 24h | JSON list of trigger entities |

---

## Active Universe Definition

**Definition (operational):** symbols STOCVEST actually prices and scans in a session — **not** the full listed US market.

**Layers:**

1. **Scanner page universe (primary intraday/swing bar load)**  
   Built client-side: `SPY`, `QQQ` + gap-intelligence symbols + user default watchlist; fallback 10-symbol list; may be capped by `maxUniverseSymbols`.

2. **Gap / brief scan list**  
   `get_scan_symbols`: up to **20** symbols (watchlist + `SYSTEM_DEFAULTS` in `scan_symbols.py`).

3. **Scheduled backend scan**  
   Up to **40** symbols: env `scanner_symbols` + aggregated default watchlists (≤30) + system defaults.

4. **Laggard registry universe (Chunk 2–3)**  
   ~**100–120** unique equities + ~**15** sector/theme ETFs (deduped `get_all_registry_symbols()` once Chunk 2 lands).

5. **Laggard dynamic universe (Chunk 4B)**  
   Intersection of symbols with warmed `PriceCache` entries (registry + watchlist warm targets ~**150–200**).

6. **Full-market snapshot**  
   `get_us_stocks_market_snapshots()` when plan allows; else `LIQUID_SYMBOLS_FALLBACK` (~90). **Not** used for per-request laggard on every symbol.

**Implication:** Laggard scanner endpoint (Chunk 8) scans the **cached registry + watchlist universe**, not all NYSE/NASDAQ names. Document as known limitation in product copy.

---

## Chunk 3 planning notes (from THINK)

| Question | Answer |
|----------|--------|
| Aggs endpoint | Yes — via `get_bars(DAY_1)` |
| Registry size (est.) | ~110–130 symbols + ETFs once Chunk 2 registry is defined |
| Warm duration @ concurrency=10, 30 req/s throttle | ~130 symbols ≈ 13 batches × ~1s ≈ **15–25s** (well under 15 min pre-open window) |
| 25 trading days | `timedelta(days=35)` calendar buffer is sufficient |
| Polygon empty bars | Return `None`, log warning, continue (never raise) |
| Watchlist symbols | Yes — aggregate via `scan_default_watchlists`; no `get_all_active_symbols` yet |
| Dynamic movers in price cache | No — real-time in Chunk 4B only |

---

## Chunk 6 integration field map (preview)

| Laggard input | Swing composite source |
|---------------|------------------------|
| `news_verdict` | `news.verdict` or `layers` news row `verdict` |
| `has_earnings_risk` | `earnings_days_away` in 0–7 and `earnings_risk` ≠ `normal` (confirm threshold in Chunk 6) |
| `tech_score` | Technical layer `score` |
| `symbol_move_1d` | `sym_snap.change_percent` (already on snapshot) |
| `symbol_vol_today` | `day_volume / prev_day_volume` or cache `vol_ratio` |
| `mode` | `"swing"` only; day composite returns `laggard_signal: null` |

---

## Verify (Chunk 1 gate)

- [x] `docs/LAGGARD_AUDIT.md` exists with all 10 Q answers  
- [x] No feature code written  
- [x] Spec file path gaps documented (`watchlist_evaluator`, `setup_evolution_logger`)

**Next:** Chunk 2 — `stocvest/data/sector_peer_registry.py` + tests.

---

## Shipped (Chunks 2–11, 2026-05-18)

All gaps in the table above are implemented. See **`IMPLEMENTED.md` L48** and **`CONTEXT.md` §1** for endpoints, Redis keys, UI surfaces, and test baselines (**1760** backend / **1301** frontend tests).
