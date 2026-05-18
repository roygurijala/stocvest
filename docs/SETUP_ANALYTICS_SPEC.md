# Setup analytics (B46)

**Philosophy:** State evolution and system behavior — not win rate, accuracy marketing, or trade performance.

## Surfaces

| Surface | Route | Data source |
|---------|-------|-------------|
| Setup Evolution (per symbol) | `/dashboard/signals?symbol=` + Past states panel | `WatchlistMaturationTransition` via `GET /v1/watchlists/symbols/{symbol}/setup-evolution` |
| Setup Evolution (hub) | `/dashboard/setup-evolution` | Same API per selected watchlist symbol |
| Setup Outcomes | `/dashboard/setup-outcomes` | `GET /v1/analytics/setup-outcomes` (v1: transition pairs on default watchlist) |
| System behavior | Outcomes page (user) + admin | `GET /v1/admin/system-behavior` (admin, cached) |
| D2 stratified accuracy (admin) | `/dashboard/admin/historical-validation` | `SignalHistory` via existing `GET /v1/signals/historical-validation/*` |

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

## Phase 6 — SignalHistory retirement (not started)

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
