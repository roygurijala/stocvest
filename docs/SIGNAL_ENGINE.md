# Signal engine (real composite)

This document describes the **server-side** multi-layer stack behind `POST /v1/signals/composite/real`. Tunables live in `SignalParameters` (Secrets Manager JSON); defaults in `stocvest/config/signal_parameters.py` and `stocvest/config/sector_etf_defaults.py`.

## Data contracts

- **Bars / snapshots**: Only `stocvest.data.models.Bar` and `Snapshot` field names. Polygon raw JSON is normalized exclusively in `PolygonClient._parse_snapshot()`.
- **VIX**: `get_vix_snapshot_with_fallback()` (`stocvest/api/services/morning_brief_fetch.py`) tries `I:VIX` → `^VIX` → `VIX`. Do not hardcode a single VIX ticker in analyzers.

## Layers

### Technical (`technical_analyzer.py`)

- **Inputs**: 1-minute `Bar` list (caller/Lambda fetch), `Snapshot`, `TechnicalParameters`, optional `adv` (otherwise volume ratio uses recent-bar average vs `Snapshot.prev_day_volume` when provided as ADV proxy).
- **Outputs**: RSI (Wilder), session VWAP from bars, EMA9/EMA20 stack, ORB over `orb_period_minutes` with expiry at `orb_expiry_hour_et`, ATR-qualified breakout via `orb_atr_qualification_ratio`, volume surge vs `volume_surge_multiplier`.
- **Unavailable**: Fewer than five bars or no valid closes.
- **Limitation**: No dedicated prior-session OHLC on `Snapshot`; PDH/PDL slots on `TechnicalLayerResult` stay `None` until a prior session feed is wired.

### News (`news_analyzer.py`)

- **Inputs**: Polygon `/v2/reference/news` rows (dicts), `NewsParameters`.
- **Sentiment**: Prefers `insights[0].sentiment`; quality gate via `is_quality_article()` (`news_quality_filter.py`).
- **Unavailable**: Zero quality articles after filtering (distinct from neutral verdict).
- **Dashboard Market Intelligence** (`GET /v1/market/news` in `market_data.py`) uses a **different** path: `passes_market_intelligence_gate()` (PR wires may enter the pool) plus **`news_relevance.py`** scoring, deduplication, and `categorize_article()` — do not assume the same filter as the composite news layer.

### Macro (`macro_analyzer.py`)

- **Inputs**: SPY/QQQ/VIX `Snapshot`, Benzinga economics rows (`EconomicCalendarEvent`), `MacroParameters`.
- **Scoring**: Weighted blend of momentum (change %), VIX level/trend (`vix_direction_from_change`), and event-risk keywords on event titles.
- **Regime labels**: `risk_on` / `risk_off` / `avoid` / `neutral` for UI and confluence normalization.

### Sector (`sector_analyzer.py` + `sector_mapper.py`)

- **Mapper**: `PolygonClient.get_ticker_details()` → `sic_code` → internal `SIC_TO_SECTOR` → `SectorParameters.sector_to_etf` benchmark ticker.
- **Cache**: Optional DynamoDB `SectorCache` (`DYNAMODB_SECTOR_CACHE_TABLE`) with TTL attribute `expires_at`.
- **Analyzer**: Relative strength = sector ETF `change_percent` minus SPY `change_percent`; thresholds from `SectorParameters`.

### Geopolitical (`geo_analyzer.py`)

- **Keyword tiers** on last 20 article titles/descriptions; 30-minute in-process memo keyed by content hash.
- **Limitation**: Not a dedicated geopolitical data feed; coverage depends on headlines and keyword lists.

### Internals (`internals_analyzer.py`)

- **VIX** and **breadth proxy** from SPY change buckets; **participation** from SPY+QQQ agreement.
- **Limitation**: Breadth is not NYSE advance/decline; documented approximation until a breadth feed exists.

## Composite

- **Engine**: `CompositeScoreEngine` (`stocvest/signals/composite_score.py`) with weights from `CompositeParameters` and regime multipliers (`bull`/`bear`/`sideways`) derived from macro `market_regime`.
- **Gate**: Fewer than `composite.min_available_layers` available layers → `insufficient_data` response (same envelope as swing composite).

## Confluence

- **Normalization**: `normalize_direction()` and ORB helpers in `stocvest/signals/confluence.py` align payload variants (`bull`, `positive`, `risk_on`, …) with internal `bullish`/`bearish`/`mixed` checks.

## Frontend evidence modal

- After `POST /v1/signals/composite/real`, `applySwingCompositeEnrichment()` (`frontend/lib/signal-evidence.ts`) maps each `body.layers[]` entry to the evidence card by `layer` key (`technical`, `news`, …).
- **Key points**: Prefer `chips` from the API; if empty, split `reasoning` on sentence boundaries; if still empty, show `—` (no fabricated macro/sector/VIX strings).

## Model portfolio (signal tracking)

- **Purpose**: Log notional “tracked positions” when a **bullish** real composite clears gates, for transparency and parameter tuning — **not** trade instructions.
- **DynamoDB**: Table **`ModelPortfolio`** (`pk=PORTFOLIO#v1`, `sk=POSITION#…` or `SUMMARY`), GSIs **`status-entry-index`** and **`symbol-entry-index`**.
- **Auto-open**: After a successful **`composite/real`** response with price, background thread calls `PortfolioRecorder.open_position` when verdict is **bullish**, mapped **0–100 score** `round((composite_score_float + 1) * 50)` is **≥ 72**, and macro `market_regime` ≠ **`avoid`**.
- **Exits**: Scheduled **`signal_resolution`** Lambda uses Polygon **`get_snapshots`** for stop / target / 20-session-day time exit; separate EventBridge rule (**`cron(35 14 ? * MON-FRI *)`** = **14:35 UTC** weekdays) invokes the same Lambda with `{"stocvest_job":"portfolio_reversal"}` to close rows when a fresh composite is **bearish** or mapped score **≤ 35**. That wall-clock is **9:35 AM Eastern** in EST and **10:35 AM Eastern** in EDT (single UTC cron cannot match both without a second rule or seasonal change).
- **API**: Public reads under **`GET /v1/portfolio/*`**; writes under **`POST /v1/portfolio/positions/open|close`** require the same internal header as **`GET /v1/signals/analysis`** (`analysis_authorized`).

## Related routes

- **Legacy client-scored path (unchanged)**: `POST /v1/signals/swing/composite`.
- **New server-scored path**: `POST /v1/signals/composite/real` (+ BFF `frontend/app/api/stocvest/signals/composite/real/route.ts`).
