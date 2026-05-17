# Fundamentals as context — NOT a signal layer

**Status:** Phases A–D shipped (FMP optional when `FMP_API_KEY` or `fmp_api_key` in `stocvest/external-api-keys` is set).

**Last updated:** 2026-05-16

---

## Governing principle

Fundamentals **inform the story**; they do **not** become a seventh composite layer, do **not** change alignment X/7, and do **not** alter composite score or verdict in v1.

| Surface | Fundamentals |
|---------|----------------|
| Day composite (`/composite/real`) | **Never** |
| Swing composite (`/composite/swing`) | Earnings horizon only (Phase A) |
| Evidence card (swing) | Earnings banner (≤7 days) + fundamental backdrop panel (paid) |

---

## What already exists (do not duplicate)

| Capability | Location |
|------------|----------|
| Setup evolution / maturation log | **B45** — `WatchlistMaturationTransition`, `GET /v1/watchlists/symbols/{symbol}/setup-evolution` |
| News-layer Benzinga extras | `latest_rating`, `latest_guidance`, `earnings_result` via `news_analyzer` + `BenzingaMultiResult` |
| Dashboard earnings strip | `GET /v1/dashboard/summary` + `dashboard_summary._fetch_earnings` |
| Historical earnings results | `BenzingaClient.get_earnings_results` (past 90d only) |

**Phase D** extends the B45 transition table with `fundamental_backdrop` and `earnings_days_away` — it does **not** add `GET /v1/signals/{symbol}/evolution`.

---

## Plan gating (Phase B+)

Use existing entitlement helpers — **not** a `beta_tester` plan slug:

- `has_full_access` / `beta_access_active` patterns in `watchlist_maturation_gates.py`
- Same gates as AI explanations and full swing limits

---

## Phase A — Earnings calendar context (shipped)

### API fields (top-level on swing composite JSON only)

| Field | Type | Notes |
|-------|------|--------|
| `upcoming_earnings_date` | `YYYY-MM-DD` | Next report within 30d |
| `earnings_days_away` | int | Calendar days from UTC today |
| `earnings_risk` | `imminent` \| `elevated` \| `watch` \| `normal` | Display tier |
| `earnings_report_time` | `before_market` \| `after_market` \| `during_market` \| `unknown` | From Polygon when available |
| `earnings_chip` | string \| omitted | Short label when risk ≠ normal |

### Risk tiers

| `earnings_days_away` | `earnings_risk` | Chip |
|----------------------|-----------------|------|
| 0–1 | `imminent` | ⚠️ Earnings tomorrow — high volatility risk |
| 2–3 | `elevated` | ⚠️ Earnings in N days |
| 4–7 | `watch` | Earnings in N days |
| 8–30 | `normal` | (no chip; no evidence banner) |

### Data resolution

Module: `stocvest/data/earnings_calendar.py`

1. **Benzinga** — `BenzingaClient.get_upcoming_earnings_calendar` (forward `dateFrom`/`dateTo`)
2. **Polygon** — `PolygonClient.get_earnings_calendar` (existing partner endpoint)
3. Optional FMP later (Phase C)

- 24h in-process cache per symbol
- Never raises into the composite engine

### Explicit non-goals (Phase A)

- No macro layer score penalties for earnings
- No change to `real_composite_engine.py`
- No alignment denominator change

---

## Phase B — Fundamental backdrop (shipped)

### API field

`fundamental_context` on swing composite JSON (`null` for free users; object for `has_full_access`).

| Subfield | Values |
|----------|--------|
| `backdrop` | `positive` \| `neutral` \| `mixed` \| `weak` |
| `earnings_trend` | `beating` \| `missing` \| `inline` \| `unknown` |
| `guidance_direction` | `raised` \| `lowered` \| `maintained` \| `unknown` |
| `analyst_direction` | `upgrading` \| `downgrading` \| `stable` \| `unknown` |
| `revenue_trend` | `growing` \| `flat` \| `declining` \| `unknown` (FMP when configured) |
| `summary_line` | One-sentence card copy ending with “Signal data only.” |
| `data_quality` | `high` \| `medium` \| `low` |
| `quarters_beating` / `quarters_missing` | ints |
| `recent_upgrades` / `recent_downgrades` | ints (90d ratings) |
| `sector_display_name` / `sector_etf` | From swing sector resolution (e.g. AMZN → Retail / **XRT**) |

Module: `stocvest/signals/fundamental_context.py` — reuses `BenzingaMultiResult` from the swing engine (no extra fetch).

UI: `frontend/components/signal-evidence/fundamental-backdrop.tsx` — gated with `has_ai_explanations` / `useHasAIExplanations()` (same as AI explanations).

---

## Phase C — Optional FMP (shipped)

Module: `stocvest/data/fmp_client.py`

- **`get_revenue_trend(symbol)`** — quarterly income statement YoY; feeds `fundamental_context.revenue_trend`
- **`get_upcoming_earnings_date(symbol)`** — third fallback in `earnings_calendar.resolve_upcoming_earnings_horizon` after Benzinga + Polygon
- Config: `FMP_API_KEY` env or `fmp_api_key` in Secrets Manager `stocvest/external-api-keys`
- Redis cache 24h per symbol; never raises; without a key all FMP paths return `unknown` / `None`

---

## Phase D — B45 extension (shipped)

`WatchlistMaturationTransition` rows now persist optional `fundamental_backdrop` and `earnings_days_away` (swing only) from the composite body at log time. Exposed on `GET /v1/watchlists/symbols/{symbol}/setup-evolution` via `to_api_dict()`.

---

## Tests

| Area | File |
|------|------|
| Resolver + classification | `tests/data/test_earnings_calendar.py` |
| Swing composite wiring | `tests/api/test_swing_composite.py::test_swing_response_includes_earnings_horizon_fields` |
| Frontend enrichment | `frontend/tests/signal-evidence.test.ts` (applySwingCompositeEnrichment earnings cases) |
