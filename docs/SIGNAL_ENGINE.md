# Signal engine (real composite)

**Last updated:** 2026-05-08

This document describes the **server-side** multi-layer stacks behind **`POST /v1/signals/composite/real`** (intraday / day-trade mode) and **`POST /v1/signals/composite/swing`** (daily-bar swing mode). Both reuse the same six layer *types*, `CompositeScoreEngine`, and confluence/evidence plumbing; data fetch windows and the technical implementation differ (`technical_analyzer` vs `swing_technical_analyzer`). Tunables live in `SignalParameters` (Secrets Manager JSON); defaults in `stocvest/config/signal_parameters.py` and `stocvest/config/sector_etf_defaults.py`.

## Architecture: Stage A → Stage B (contributor contract)

- **Stage A — per-layer truth:** Each layer analyzer runs on **its own** inputs and produces a **domain-specific** judgment (scores, verdicts, reasoning, chips). Meaning is **not** derived by working backward from a single composite number.
- **Stage B — decision synthesis:** The composite engine and HTTP handlers **reconcile** Stage-A outputs after the fact (weighting, regime scaling, alignment, penalties, hard gates). **Do not** push composite heuristics into Stage-A code paths—that is the main failure mode this split prevents.

## Data contracts

- **Bars / snapshots**: Only `stocvest.data.models.Bar` and `Snapshot` field names. Polygon raw JSON is normalized exclusively in `PolygonClient._parse_snapshot()`.
- **VIX**: `get_vix_snapshot_with_fallback()` (`stocvest/api/services/morning_brief_fetch.py`) tries `I:VIX` → `^VIX` → `VIX`. Do not hardcode a single VIX ticker in analyzers.

## Layers

### Technical — day (`technical_analyzer.py`)

- **Inputs**: 1-minute `Bar` list (caller/Lambda fetch), `Snapshot`, `TechnicalParameters`, optional `adv` (otherwise volume ratio uses recent-bar average vs `Snapshot.prev_day_volume` when provided as ADV proxy).
- **Outputs**: RSI (Wilder), session VWAP from bars, EMA9/EMA20 stack, ORB over `orb_period_minutes` with expiry at `orb_expiry_hour_et`, ATR-qualified breakout via `orb_atr_qualification_ratio`, volume surge vs `volume_surge_multiplier`.
- **Unavailable**: Fewer than five bars or no valid closes.
- **Limitation**: No dedicated prior-session OHLC on `Snapshot`; PDH/PDL slots on `TechnicalLayerResult` stay `None` until a prior session feed is wired.

### Technical — swing (`swing_technical_analyzer.py`)

- **Inputs**: Daily `Bar` list (`Timeframe.DAY_1`), `Snapshot`, `SwingTechnicalParameters`.
- **Outputs**: SMA50/SMA200 stack, daily RSI, MACD vs signal, higher-high/higher-low heuristic, base-range detection, volume accumulation/distribution regime, range-high proximity; chips are **not** VWAP/ORB (swing-specific labels).

### News (`news_analyzer.py`)

- **Inputs**: Polygon `/v2/reference/news` rows (dicts), `NewsParameters`, optional **`lookback_hours`** (defaults to `NewsParameters.lookback_hours`, **8**). Rows older than the window are dropped before scoring.
- **Sentiment**: Prefers `insights[0].sentiment`; quality gate via `is_quality_article()` (`news_quality_filter.py`).
- **Unavailable**: Zero quality articles after filtering (distinct from neutral verdict).
- **Dashboard Market Intelligence** (`GET /v1/market/news` in `market_data.py`) uses a **different** path: `passes_market_intelligence_gate()` (PR wires may enter the pool) plus **`news_relevance.py`** scoring, deduplication, and `categorize_article()` — do not assume the same filter as the composite news layer.

### Macro (`macro_analyzer.py`)

- **Inputs**: SPY/QQQ/VIX `Snapshot`, Benzinga economics rows (`EconomicCalendarEvent`), `MacroParameters`, optional **`events_lookback_days`** (caller fetches a multi-day calendar via `PolygonClient.get_economic_calendar_range` for swing).
- **Scoring**: Weighted blend of momentum (change %), VIX level/trend (`vix_direction_from_change`), and event-risk keywords on event titles.
- **Regime labels**: `risk_on` / `risk_off` / `avoid` / `neutral` for UI and confluence normalization.

### Sector (`sector_analyzer.py` + `sector_mapper.py`)

- **Mapper**: `PolygonClient.get_ticker_details()` → `sic_code` → internal `SIC_TO_SECTOR` (exact) → **`sector_sic_fallback.resolve_sector_bucket_from_sic`** (3-digit then 2-digit SEC division proxies when exact SIC is missing) → `SectorParameters.sector_to_etf` benchmark ticker. Non-classifiable codes (e.g. **9999**) stay on **SPY** / `default` by design.
- **SIC mapping tier** (internal; logs + optional `sic_mapping_tier` on composite sector layer rows): **`exact`** (4-digit table), **`prefix`** (curated 3-digit), **`coarse`** (2-digit division proxy — treat as provisional for analytics), **`fallback_spy`** (empty SIC, excluded codes, unknown after fallbacks, or Polygon error — honest broad market). Prefer extending **`SIC_TO_SECTOR`** for symbols that matter rather than widening 2-digit inference. Do not switch to GICS without a data contract; do not hide coarse usage or silently “upgrade” unknowns. Any future **`sic_description`** keyword overrides should be **optional, override-only, never the default resolver**, and must not override exclusions or blend scores.
- **Cache**: Optional DynamoDB `SectorCache` (`DYNAMODB_SECTOR_CACHE_TABLE`) with TTL attribute `expires_at`.
- **Analyzer**: Relative strength = sector ETF `change_percent` minus SPY `change_percent` (day mode), or optional **`use_weekly`** with caller-supplied **`weekly_sector_pct`** and **`weekly_spy_pct`** (typically ~5 sessions from daily closes) minus SPY weekly %.

### Geopolitical (`geo_analyzer.py`)

- **Keyword tiers** on last 20 article titles/descriptions (after optional **`lookback_hours`** filter); 30-minute in-process memo keyed by content hash.
- **Limitation**: Not a dedicated geopolitical data feed; coverage depends on headlines and keyword lists.

### Internals (`internals_analyzer.py`)

- **VIX** and **breadth proxy** from SPY change buckets; **participation** from SPY+QQQ agreement.
- **Limitation**: Breadth is not NYSE advance/decline; documented approximation until a breadth feed exists.

## Composite

### Engine

- **`CompositeScoreEngine`** (`stocvest/signals/composite_score.py`): base weights from `CompositeParameters`, **regime multipliers** (`bull` / `bear` / `sideways`) keyed off macro **`market_regime`**, per-layer confidence, normalized composite score and verdict, plus **`alignment_ratio`** and **`conflicted_layers`**.

### Weighting, regime, and layer direction (invariant)

- Each layer contributes **`weighted_value = layer_score × effective_weight`**, where **`effective_weight = base_weight × regime_multiplier × confidence`**.
- Default **`REGIME_WEIGHTS`** entries are **strictly positive**; they **amplify or dampen how much** a layer counts, **not** whether a bullish layer input counts as bullish. **Do not** introduce **negative** regime multipliers without an explicit design review and coordinated API/docs updates— that would silently **invert** a layer’s contribution sign.
- **Disagreement is first-class:** alignment metadata and the **contradiction penalty** (`_apply_contradiction_penalty`) reduce the **composite scalar** when layers conflict; they do **not** rewrite individual layer outputs.

### Readiness / signal strength (internal vocabulary)

For **contributors and product copy** (the UI may use terms like “trade readiness” or `signal_strength` / `signal_score` on payloads):

- Treat the headline **0–100-style** read as **alignment and cleanliness after rules and gates**, **not** win probability, expected return, or a trade instruction.
- **Internal mental model** (not necessarily a single literal formula in code): readiness is driven by **weighted directional alignment**, **data quality** (available layers, confidence), and **gate clearance** (e.g. insufficient-data envelope, evidence-side R/R warnings). Features should **not** quietly inflate scores without revisiting this framing.

### Gate taxonomy: eligibility vs degradation

Keep these **conceptually separate** when adding features:

| Kind | Role | Examples |
|------|------|----------|
| **Eligibility gates** | Withhold or replace the **composite body** until inputs are trustworthy | Fewer than `composite.min_available_layers` → **`insufficient_data`** HTTP 200 envelope (real + swing composites); market/session preconditions documented on handlers |
| **Degradation / honesty checks** | Adjust **how strongly** the composite speaks once eligible | `_apply_contradiction_penalty` on the net score from alignment; swing evidence **`rr_warning`** and related narrative fields (`swing_composite_evidence.py`) — quality checks, **not** extra “layers” |

Weighting math and permission-style gates should stay **separate concerns** in code reviews.

### Composite verdict (bullish / neutral / bearish)

- The composite verdict is a **reconciled judgment with friction**, not a simple **majority vote** across layer labels.
- **Optional roadmap (not required in API today):** “stability tiers” (e.g. strong vs leaning bullish/bearish) could be added **later** for explanations and UX; doing so would be a **behavior + contract** change and needs explicit versioning or additive fields—do not half-ship inside layer analyzers.

## Confluence

- **Normalization**: `normalize_direction()` and ORB helpers in `stocvest/signals/confluence.py` align payload variants (`bull`, `positive`, `risk_on`, …) with internal `bullish`/`bearish`/`mixed` checks.

## Frontend evidence modal

- After `POST /v1/signals/composite/real`, `applySwingCompositeEnrichment()` (`frontend/lib/signal-evidence.ts`) maps each `body.layers[]` entry to the evidence card by `layer` key (`technical`, `news`, …).
- **Key points**: Prefer `chips` from the API; if empty, split `reasoning` on sentence boundaries; if still empty, show `—` (no fabricated macro/sector/VIX strings).

## Signal validation ledger (tracked outcomes)

- **Purpose**: Audit how logged **Actionable** decisions behave under **fixed, disclosed rules** — decision-first language, not a brokerage portfolio or performance marketing. Swing vs day are **separate** tracks (`SignalRecord.mode` is `swing` or `day`).
- **Storage**: DynamoDB **`SignalHistory`** rows shaped as **`SignalRecord`** (`stocvest/data/models.py`). Optional ledger attributes (written when enrichment / close jobs populate them) include: **`closed_at`**, **`ledger_entry_date_et`** / **`ledger_exit_date_et`** (NY session dates for swing daily-close framing), **`entry_rationale`**, **`exit_reason`**, **`decision_state_entry`** / **`decision_state_exit`**, **`market_regime_exit`**, **`gate_status_json`** (stored JSON; **`GET /v1/signals/me/history`** returns parsed **`gate_status`** when valid), **`setup_type`**, **`exit_rule`**, **`max_adverse_excursion_pct`**, **`max_favorable_excursion_pct`**, **`hold_duration_minutes`**.
- **API**: Authenticated **`GET /v1/signals/me/history`** with query **`mode=day|swing`** (optional), plus existing **`days`**, **`limit`**, **`symbol`**. Same row shape on **`GET /v1/signals/me/records/{signal_id}`** and public detail helpers that wrap **`_public_api_shape`**.
- **UI**: User setup behavior at **`/dashboard/setup-outcomes`** and **`/dashboard/setup-evolution`** (B46); **`/dashboard/signal-validation`** and **`/dashboard/performance`** redirect to setup-outcomes; admin D2 stratified accuracy at **`/dashboard/admin/historical-validation`**. Legacy **`/portfolio`** redirects to setup-outcomes. Broker holdings remain **`POST /v1/portfolio/holdings|summary|allocation`** (brokers Lambda) and **`/dashboard/portfolio`** — unrelated to the ledger.
- **Retired (do not resurrect in docs)**: The notional **ModelPortfolio** table, signals-lambda **`GET/POST /v1/portfolio/*`** model-book routes, **`portfolio_reversal`** / **`run_portfolio_composite`** automation, and **`/portfolio`** as a model-book surface were removed in favor of this ledger.

## Related routes

- **Legacy client-scored path (unchanged)**: `POST /v1/signals/swing/composite`.
- **New server-scored path**: `POST /v1/signals/composite/real` (+ BFF `frontend/app/api/stocvest/signals/composite/real/route.ts`).

**Product / entitlements (2026-05):** on-demand **AI signal explanations** and related paid surfaces gate on **`UserProfile.has_ai_explanations`** (true when subscribed or **beta** full access is active). See **`docs/API_CONTRACTS.md`** §4.10 and **`docs/CONTEXT.md`** §1.

## Future enhancements (non-blocking)

These are **intentional backlog themes**, not corrections to current behavior:

- **Canonical explanation library:** map common composite outcomes (e.g. high conflict + macro risk-off) to **standard** educator-facing sentences so UI and AI prompts do not drift in tone.
- **“What would need to change” hints:** short, rule-based hints keyed off **which layers dominated a soft veto** (extends informal copy already in places).
- **Regime-segmented “typical” baselines:** later, radar / “vs typical” baselines could be **conditional on regime** to deepen trust without adding noise on every tick.
