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

## Related routes

- **Legacy client-scored path (unchanged)**: `POST /v1/signals/swing/composite`.
- **New server-scored path**: `POST /v1/signals/composite/real` (+ BFF `frontend/app/api/stocvest/signals/composite/real/route.ts`).
