# Setup analytics (B46)

**Philosophy:** State evolution and system behavior — not win rate, accuracy marketing, or trade performance.

## Surfaces

| Surface | Route | Data source |
|---------|-------|-------------|
| **Product KPI** (platform signal accuracy) | `/performance` · admin Desk backtesting | `SignalHistory` PUBLIC + `product_kpi.py` cohort — **not** setup-outcomes |
| Setup Evolution (per symbol) | `/dashboard/signals?tab=evolution`, Trading Room **Deep Dive → Evolution**, hub | `WatchlistMaturationTransition` via `GET /v1/watchlists/symbols/{symbol}/setup-evolution` (+ **`analytics`** block, B68) |
| Setup Evolution (hub) | `/dashboard/setup-evolution` | Same API per selected watchlist symbol |
| Setup Outcomes | `/dashboard/setup-outcomes` | `GET /v1/analytics/setup-outcomes` (v1: transition pairs on default watchlist) |
| System behavior | Outcomes page (user) + admin | `GET /v1/admin/system-behavior` (admin, cached) |
| D2 stratified accuracy (admin) | `/dashboard/admin/historical-validation` | `SignalHistory` via existing `GET /v1/signals/historical-validation/*` (full stratification, internal) |

See also [`MEASUREMENT_SURFACES.md`](./MEASUREMENT_SURFACES.md) for how Product KPI differs from setup outcomes.

## Mode separation

Swing and day are isolated everywhere (B27). APIs require `mode=swing|day`.

## Deploy

1. **DynamoDB:** `WatchlistMaturationTransition` GSI **`ModeTimelineIndex`** (`gsi1pk`, `gsi1sk`) — `infra/dynamodb.tf`.
2. **API Gateway:** `GET /v1/analytics/setup-outcomes`, `GET /v1/admin/system-behavior` — `infra/apigateway_6e.tf`.
3. **`terraform fmt`** + **`terraform apply`** in `infra/` (GSI creation may take several minutes on existing tables).

**Status:** Application + infra applied **2026-05-17** (`terraform apply` in `infra/` — GSI + API Gateway routes).

New transitions persist **`price_at_event`** from composite **`last_trade_price`** for setup-continuation pairing.

## Retired UI (Phase 1)

- Signals **Past signal states** tab (`SignalHistory` table UI)
- `/dashboard/signal-validation` → redirect to setup outcomes
- `/dashboard/performance` → redirect to setup outcomes

`SignalHistory` storage and `record_signal()` remain for D2, weight proposer, and resolution jobs until Phase 6.

## Phase 6 — SignalHistory retirement (prep done; table retained)

Full migration checklist: [`SIGNAL_HISTORY_RETIREMENT.md`](./SIGNAL_HISTORY_RETIREMENT.md).

Do **not** drop the table or stop `record_signal()` until every dependent below has a migration path.

| Dependent | Path |
|-----------|------|
| D2 stratified UI | **Done:** `/dashboard/admin/historical-validation` (admin-only); user route redirects to setup outcomes |
| Weight proposer (`weight_proposer.py`) | Still reads historical rows; keep until optimizer reads transitions or a slim export |
| Resolution job (`signal_resolution.py`) | Still writes outcomes to `SignalHistory` |
| `GET /v1/signals/me/history` | Legacy API; retire with table or gate admin-only |
| `GET /v1/signals/performance/summary` | Used by public `/performance`; separate from setup-outcomes |
| Assistant chat historical block | Uses `HistoricalValidationService` + `SignalHistory` |
| Ledger monitor | Uses recorded signals |

**GSI backfill:** Existing `WatchlistMaturationTransition` rows lack `gsi1pk`/`gsi1sk` until re-logged; platform mode timeline counts only new transitions after deploy.

## Continuation (v1)

From consecutive maturation transitions on the same symbol/mode:

- **Alignment held:** next session `layers_aligned` ≥ event session
- **Full continuation (v2):** alignment held + price moved with bias (needs price on transitions)

## Plan gating

Free: last 14 transition rows per symbol; paid: 90 days / full timeline.

## Evolution tab UX (B68, 2026-06-10)

The Evolution tab answers three questions in order (Signals desk, Trading Room Deep Dive, setup-evolution hub):

1. **Where is this setup now?** — Horizontal **state journey** (Potential / Near / Actionable / Cooling from display tiers), dwell time between transitions, score at each node (current segment shows live score).
2. **Is it getting stronger or weaker?** — **Score sparkline** (0–100 composite, not alignment %), actionable threshold line at **72**, state-colored dots; **inflection row** (peak alignment, biggest jump, streak in current state, momentum over last 3 sessions); **forward projection** (linear extrapolation only — labeled not a forecast).
3. **Why is it behaving this way?** — **Layer stability** (■ confirmed / ▨ missing per session, band hints); **daily score timeline** grouped by week (green/red/amber dots for score change / state change).

**Data:** `analytics` on setup-evolution API; new transitions persist **`signal_score`** from composite when available. Legacy transitions without stored score use a deterministic proxy in `resolve_signal_score()`.

**Out of scope (by design):**

- Hypothetical P&amp;L or “if you entered at $X” copy (non-RIA positioning).
- Aggregate pattern win-rate on the per-symbol tab (counsel review first).
- Comparable setups from ledger (deferred until signal volume supports it).

**Frontend:** `frontend/components/signals/setup-evolution-panel.tsx`, `frontend/lib/setup-evolution-analytics.ts`, types in `frontend/lib/api/setup-evolution.ts`.

**Tests:** `tests/analytics/test_evolution_stats.py`, `tests/api/test_watchlists_setup_evolution.py`, `frontend/tests/setup-evolution-*.test.ts`.
