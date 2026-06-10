# Signal engine (real composite)

**Last updated:** 2026-06-10

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
- **PDH/PDL**: `resolve_day_technical_layer` (`day_technical_close_fallback.py`) sets `Snapshot.prev_day_high` / `prev_day_low` from the **prior completed daily bar** (`daily_bars[-2]`) before scoring.
- **Outputs**: RSI (Wilder), session VWAP from bars, EMA9/EMA20 stack, ORB over `orb_period_minutes` with expiry at `orb_expiry_hour_et`, ATR-qualified breakout via `orb_atr_qualification_ratio`, volume surge vs `volume_surge_multiplier`, **session momentum** (ROC vs session open, pullback from session high, recent-bar momentum fade), PDH/PDL score contributions when prior levels are present.
- **Unavailable**: Fewer than five bars or no valid closes.
- **Closed session**: When intraday bars are insufficient, `resolve_day_technical_layer` falls back to daily-bar swing technical with status `as_of_close` and reduced composite confidence (`AS_OF_CLOSE_COMPOSITE_CONFIDENCE`).

### Technical — swing (`swing_technical_analyzer.py`)

- **Inputs**: Daily `Bar` list (`Timeframe.DAY_1`), `Snapshot`, `SwingTechnicalParameters` (Secrets `swing_technical` block).
- **Outputs**: **SMA20 primary anchor**, SMA50/SMA200 structural context, daily RSI, **10-session ROC**, **% below 60-session high**, MACD histogram (incl. fading), higher-highs/lows and lower-highs/lows, base-range detection, volume accumulation/distribution regime; chips are swing-specific (not VWAP/ORB).
- **Tuning goal**: Recent multi-day breakdown must dominate extended structural uptrend (avoids DELL-like “bullish 77” on a sharp drawdown).

### News (`news_analyzer.py`)

- **Inputs**: Polygon `/v2/reference/news` rows (dicts), `NewsParameters`, optional **`lookback_hours`** (defaults to `NewsParameters.lookback_hours`, **8**). Rows older than the window are dropped before scoring.
- **Sentiment**: Prefers `insights[0].sentiment`; quality gate via `is_quality_article()` (`news_quality_filter.py`).
- **IPO narrative filter** (`news_ipo_narrative.py`): During active S-1 / post-listing windows, competitive-displacement headlines mentioning OpenAI/Anthropic/SpaceX on **corporate backer** symbols (e.g. MSFT, GOOGL) are **downweighted**; stake-repricing copy is modestly boosted. Surfaced in layer chips/reasoning — does not change verdict thresholds directly.
- **Unavailable**: Zero quality articles after filtering (distinct from neutral verdict).
- **Dashboard Market Intelligence** (`GET /v1/market/news` in `market_data.py`) uses a **different** path: `passes_market_intelligence_gate()` (PR wires may enter the pool) plus **`news_relevance.py`** scoring, deduplication, and `categorize_article()` — do not assume the same filter as the composite news layer.

### Macro (`macro_analyzer.py`)

- **Inputs**: SPY/QQQ/VIX `Snapshot`, Benzinga economics rows (`EconomicCalendarEvent`), `MacroParameters`, optional **`events_lookback_days`** (caller fetches a multi-day calendar via `PolygonClient.get_economic_calendar_range` for swing).
- **Scoring**: Weighted blend of momentum (change %), VIX level/trend (`vix_direction_from_change`), and event-risk keywords on event titles. Default blend: **momentum 0.45**, **volatility 0.35**, **event 0.20** (`MacroParameters` / Secrets `macro` block).
- **Regime labels**: `risk_on` / `risk_off` / `avoid` / `neutral` for UI and confluence normalization.
- **Regime thresholds (code, not Secrets)**: `market_regime=risk_on` when `macro_score >= 63`; `risk_off` when `macro_score <= 45` (sharp index selloffs with calm VIX must not read neutral); `avoid` when VIX above `vix_high`. Secrets `macro.momentum_weight` must stay at **0.45** for the blend to align with these thresholds.

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
- **Per-mode weights**: `resolve_composite_block(params, mode)` selects **`swing_composite`** or **`day_composite`** from Secrets when present; otherwise falls back to shared **`composite`**. Pre-beta priors (v1.1.0): swing favors macro/sector (`technical 0.22`, `macro 0.20`, `sector 0.18`); day favors technical/internals (`technical 0.35`, `internals 0.21`).

### Weighting, regime, and layer direction (invariant)

- Each layer contributes **`weighted_value = layer_score × effective_weight`**, where **`effective_weight = base_weight × regime_multiplier × confidence`**.
- Default **`REGIME_WEIGHTS`** entries are **strictly positive**; they **amplify or dampen how much** a layer counts, **not** whether a bullish layer input counts as bullish. **Do not** introduce **negative** regime multipliers without an explicit design review and coordinated API/docs updates— that would silently **invert** a layer’s contribution sign.
- **Disagreement is first-class:** alignment metadata and the **contradiction penalty** (`_apply_contradiction_penalty`) reduce the **composite scalar** when layers conflict; they do **not** rewrite individual layer outputs.

### Readiness / signal strength (internal vocabulary)

For **contributors and product copy** (the UI may use terms like “trade readiness” or `signal_strength` / `signal_score` on payloads):

- Treat the headline **0–100-style** read as **alignment and cleanliness after rules and gates**, **not** win probability, expected return, or a trade instruction.
- **Internal mental model** (not necessarily a single literal formula in code): readiness is driven by **weighted directional alignment**, **data quality** (available layers, confidence), and **gate clearance** (e.g. insufficient-data envelope, evidence-side R/R warnings). Features should **not** quietly inflate scores without revisiting this framing.

### Trade conviction tiers (frontend display, B50)

Signals and watchlist cards may show **A+** / **B+** / **Developing** bands from `frontend/lib/trade-conviction-tier.ts`. These are **explanatory only** — they do **not** change composite verdicts, actionable counts, maturation `derive_state`, or the validation ledger.

| Band | Rough rule |
|------|------------|
| **A+** | Actionable verdict + R/R ≥ **2.0** + ≥ **5/6** alignment + no counter-trend / regime-conflict blocks |
| **B+** | ≥ **5/6** alignment + R/R in **[1.3, 2.0)** — discretionary context; not STOCVEST’s default recommendation |
| **Developing** | Below B+ floor or major blocks |

Desk **verdict** R/R gates remain mode-specific: swing **≥ 2.0**, day **≥ 1.3** (`minRiskRewardForVerdict`). **Scenario Builder** structural `low_risk_reward` uses the same desk minimum; the **2.0** bar is the separate **A-tier** label, not the day desk gate.

### Entry-zone synthesis & validation

The served **entry zone** is a **tight, anchored, validated band** — the price
region where it is still reasonable to enter — **not** the full session/swing
range (a historical bug had it spanning `[day_low, day_high]`, which also let the
top edge equal T1). Implemented in **`stocvest/api/services/entry_zone.py`** and
wired as a **post-processing step** on the finalized reference levels in both
engines, so the headline R/R (computed from the **current price**) is unchanged.

- **Compute** — anchor to `preferred_anchor` (VWAP for day, SMA20 for swing, with
  fallback), cap the width by `min/max_width_pct` rails (ATR-scaled within them).
  Long → `[anchor‐clamped low, last]`; short mirrored.
- **Validate** — clamp the **far** edge inward so the band clears the stop, sits
  short of the **traded** target (the same T1/T2 selection the headline R/R uses),
  and keeps **worst-case R/R ≥ `min_rr_from_zone_high`** measured from that far
  edge. We **clamp, never raise**; if no valid band remains it is flagged
  `no_clean_entry` (graceful degradation, not suppression).
- **Served fields** — `historical_entry_zone {low, high}`, `entry_zone_quality`
  (`clean` \| `clamped` \| `no_clean_entry`), `entry_zone_worst_case_rr`. The
  worst-case floor is held **≤ headline `min_rr`** so elevated-VIX days never get
  contradictory thresholds. Config: `entry_zone` block (see TUNING_PLAYBOOK.md).

### Universe eligibility (`symbol_universe_eligibility.py`)

- **`MIN_LISTED_DAYS = 90`** — composite (day + swing) blocks symbols listed fewer than 90 sessions when Polygon `list_date` is present.
- **Known recent IPO tickers** (e.g. `SPCX` from `ipo_ecosystem_registry.py`) **fail closed** when reference/`list_date` is missing — composite returns **`liquidity_filtered`**, not an unscored body.
- **Snapshot-only paths** (`PremarketGapScanner`, `dynamic_gap_candidates_from_snapshots`, opportunity-desk funnel) apply **`listing_age_exclusion_reason(symbol, None)`** using IPO calendar + known-ticker fail-closed — no Polygon reference call. Gap intel attaches **`market_context_flags`**, caps volume on unseasoned / index-inclusion windows, and routes unseasoned **listed issuers** to **`ipo_watch`** (unscored) instead of ranked movers (`gap_intelligence.enrich_gap_items_with_market_context`).
- **Intraday setup scanner** (`intraday_listing_age_filter.py`): `POST /v1/signals/day/setups`, `POST /v1/scanner/intraday`, and scheduled intraday/EOD scans **filter** `bars_by_symbol` through the same listing-age gate before `IntradaySetupScanner` runs.
- **IPO ecosystem metadata** — `ipo_ecosystem_registry.py` + `market_context_flags.py` drive laggard peer groups (`sector_peer_registry` PRE_IPO_PROXY), composite **`market_context_flags.warnings`**, and scanner gap caveats. Refresh stake notes after S-1 / holdings reports.

### Gate taxonomy: eligibility vs degradation

Keep these **conceptually separate** when adding features:

| Kind | Role | Examples |
|------|------|----------|
| **Eligibility gates** | Withhold or replace the **composite body** until inputs are trustworthy | Fewer than `composite.min_available_layers` → **`insufficient_data`** HTTP 200 envelope (real + swing composites); market/session preconditions documented on handlers |
| **Degradation / honesty checks** | Adjust **how strongly** the composite speaks once eligible | `_apply_contradiction_penalty` on the net score from alignment; **`market_context_composite_dampener`** (Option B renormalize — no weight redistribution) scales sector/internals during **active index-inclusion windows** only; technical dampening tiers by `listed_days`; ecosystem backers dampen at 0.70 only during inclusion windows (not S-1 roadshow alone); swing evidence **`rr_warning`** — quality checks, **not** extra “layers” |

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
- **Storage**: DynamoDB **`SignalHistory`** rows shaped as **`SignalRecord`** (`stocvest/data/models.py`). Optional ledger attributes (written when enrichment / close jobs populate them) include: **`closed_at`**, **`ledger_entry_date_et`** / **`ledger_exit_date_et`** (NY session dates for swing daily-close framing), **`entry_rationale`**, **`exit_reason`**, **`decision_state_entry`** / **`decision_state_exit`**, **`market_regime_exit`**, **`gate_status_json`** (stored JSON; **`GET /v1/signals/me/history`** returns parsed **`gate_status`** when valid — may nest **`gates`**, soft **`execution_quality`**, **`evaluation_source`**: `ledger_capture` \| `on_demand`), **`setup_type`**, **`exit_rule`**, **`max_adverse_excursion_pct`**, **`max_favorable_excursion_pct`**, **`hold_duration_minutes`**, **`ledger_qualified`** (bool).
- **Scheduled gate capture (B62, 2026-05-22):** EventBridge runs day + swing composites with **`ledger_capture=True`** inside ledger entry windows (see **`WATCHLIST_MATURATION_ARCH.md`**). Writes **qualified** rows when all gates pass, or **shadow** audit rows when they do not (`pattern` suffix **`:ledger_capture_shadow`**, **`ledger_qualified=false`**) with full layer snapshots and per-gate outcomes in **`gate_status_json`**. Prior maturation-only schedules (8:15 swing, 9:35 day, 4:30 EOD) did **not** align with ledger entry windows — that timing gap explains pre-B62 **`ledger_qualified=true`** counts of zero despite maturation **Actionable** transitions. **Coverage:** default watchlists only; env caps **`STOCVEST_LEDGER_CAPTURE_SCAN_LIMIT`** (500) and **`STOCVEST_LEDGER_CAPTURE_MAX_CALLS`** (1500 composites/run); round-robin across users — not every Cognito user on every run.
- **Split day/swing schedules (fix, 2026-06-08):** The original single **`ledger_capture`** invocation (`desk="both"`) at 3:55 PM ET drained the **entire day queue first**, then swing. With the scanner Lambda's 120 s timeout the invocation **died inside the day loop and never reached swing** — so **zero `mode="swing"` rows were ever captured** (confirmed: every shadow row in `SignalHistory` was `mode="day"`, generated 19:55–20:05 UTC, with 2–3 async retries per day re-running the day loop and inflating day shadow volume). Fix: (1) two dedicated single-desk schedules — **`ledger_capture_day`** at **3:55 PM ET** (day RTH ≤15:59) and **`ledger_capture_swing`** at **4:00 PM ET** (swing post-close window 15:50–16:15 ET); (2) the worker now **interleaves** day/swing jobs for any combined `desk="both"` run so neither desk can starve the other; (3) scanner Lambda timeout raised **120 s → 300 s** for headroom. Requires an infra deploy to take effect.
- **Sector score clustering fix (P66, 2026-06-09):** Sector layer scores were stuck near **20** when Redis was disabled on scanner/signals Lambdas — relative-strength cache missed and gates saw composite-scale values. Fix: **`STOCVEST_DISABLE_REDIS=0`** on scanner + signals (`infra/lambda_6e.tf`); **`sector_daily_cache.py`** dual-writes Redis + Dynamo **`SectorDailyCache`** with read fallback; validation gates reject composite-scale sector scores via **`is_composite_layer_signal_scale()`**; swing shadow rows persist **`sector_layer_score`**. **Ops verify:** invoke **`sector_daily_cache`** worker — scores should vary by ETF (e.g. XLK ~14, XLF ~68), not flat 20.
- **Maturation alignment (P66, 2026-06-09):** Watchlist maturation could drift from composite **`decision_state`** after ledger capture. Fix: **`derive_maturation_state`** uses composite decision; **`watchlist_ledger_capture.py`** syncs maturation after each capture; one-time **`scripts/catchup_watchlist_maturation.py`** for stale rows (prod: 186 jobs). **Remaining gap:** `signal_summary` fallback when composite omits field (**BACKLOG** P66-followups).
- **Daily ops report:** **`scripts/ledger_signal_report.py`** + **`docs/LEDGER_DAILY_VERIFICATION.md`** — counts qualified/shadow/actionable per desk without querying raw Dynamo manually.
- **Execution quality (B62 Phase 2):** Informational soft payload on day/swing composite responses — **`band`**, **`stop_atr_ratio`**, **`level_path`**, **`volume_band`**, **`session_window`**, **`setup_tags`**, **`disclaimer`**. **Not a gate** — does not change actionable verdicts or maturation state. Persisted inside **`gate_status_json.execution_quality`** during capture; surfaced on Evidence card summary line.
- **Phase 3 (deferred ~2–3 weeks post-deploy):** Analyze shadow rows (`ledger_only=false`, pattern **`*:ledger_capture_shadow`**) to see which gates bind before changing swing R/R or other thresholds. **Do not** lower swing R/R from **2.0 → 1.5** without this telemetry — would confound execution-quality improvements with threshold tuning.
- **API**: Authenticated **`GET /v1/signals/me/history`** with query **`mode=day|swing`** (optional), plus existing **`days`**, **`limit`**, **`symbol`**. Same row shape on **`GET /v1/signals/me/records/{signal_id}`** and public detail helpers that wrap **`_public_api_shape`**.
- **UI**: User setup behavior at **`/dashboard/setup-outcomes`** and **`/dashboard/setup-evolution`** (B46); **`/dashboard/signal-validation`** and **`/dashboard/performance`** redirect to setup-outcomes; admin D2 stratified accuracy at **`/dashboard/admin/historical-validation`**. Legacy **`/portfolio`** redirects to setup-outcomes. Broker holdings remain **`POST /v1/portfolio/holdings|summary|allocation`** (brokers Lambda) and **`/dashboard/portfolio`** — unrelated to the ledger.
- **Retired (do not resurrect in docs)**: The notional **ModelPortfolio** table, signals-lambda **`GET/POST /v1/portfolio/*`** model-book routes, **`portfolio_reversal`** / **`run_portfolio_composite`** automation, and **`/portfolio`** as a model-book surface were removed in favor of this ledger.

## Related routes

- **Legacy client-scored path (unchanged)**: `POST /v1/signals/swing/composite`.
- **New server-scored path**: `POST /v1/signals/composite/real` (+ BFF `frontend/app/api/stocvest/signals/composite/real/route.ts`).

**Product / entitlements (2026-05):** on-demand **AI signal explanations** and related paid surfaces gate on **`UserProfile.has_ai_explanations`** (true when subscribed or **beta** full access is active). See **`docs/API_CONTRACTS.md`** §4.10 and **`docs/CONTEXT.md`** §1.

## Macro / FOMC limitations (assessed 2026-06-08)

What the engine does **today** around Fed and macro events:

| Capability | Status |
|------------|--------|
| Economic calendar in macro layer | ✅ Benzinga economics rows; **event-risk** keyword scoring (20% of macro blend) lowers score on high-impact event days |
| Reactive regime (`risk_on` / `risk_off` / `avoid`) | ✅ From SPY/QQQ momentum + VIX; thresholds in **`macro_analyzer.py`** (not Secrets) |
| Calendar warnings in UI copy | ✅ Dashboard/scanner posture lines reference known event days |
| **`MacroEventDetector`** (hawkish/dovish headline keywords) | ✅ Used in news/AI assistant paths; **not** wired into live composite layer scores |
| Pre-FOMC directional prediction | ❌ Not implemented — no model of expected vs actual policy move |
| Per-symbol FOMC beta / event sensitivity | ❌ Deferred |
| Hard entry gates before Fed decisions | ❌ Not implemented — event risk is a **score dampener**, not a veto |
| Contextual layer weight boosts around events | ❌ **P1 backlog** (`P1-MACRO` in **`BACKLOG.md`**) |

**Product posture:** STOCVEST surfaces macro event risk as **data and score friction**, not as a trade call. Planned P1 work adds contextual boosts, layer-card polarity consistency, and optional user feedback — not a directional "Fed play" engine.

## Future enhancements (non-blocking)

These are **intentional backlog themes**, not corrections to current behavior:

- **Canonical explanation library:** map common composite outcomes (e.g. high conflict + macro risk-off) to **standard** educator-facing sentences so UI and AI prompts do not drift in tone.
- **“What would need to change” hints:** short, rule-based hints keyed off **which layers dominated a soft veto** (extends informal copy already in places).
- **Regime-segmented “typical” baselines:** later, radar / “vs typical” baselines could be **conditional on regime** to deepen trust without adding noise on every tick.
