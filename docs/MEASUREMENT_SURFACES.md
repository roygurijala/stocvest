# Measurement surfaces — what each number means

STOCVEST uses **three** outcome layers. They must not be blended into one headline.

## Summary

| Surface | Route | Audience | Question answered | Data source |
|---------|-------|----------|-------------------|-------------|
| **Product KPI** | `/performance` (public) · admin **Desk backtesting** | Everyone (public % gated) · operators | Did **qualified actionable** platform signals resolve in the right direction? | `SignalHistory` PUBLIC mirror, cohort filter in `product_kpi.py` |
| **Setup outcomes** | `/dashboard/setup-outcomes` | Logged-in user | How did **watchlist setups** evolve session-to-session (alignment, state)? | `WatchlistMaturationTransition` via `GET /v1/analytics/setup-outcomes` |
| **D2 stratified validation** | `/dashboard/admin/historical-validation` | Admin only | Full stratification for tuning (decision, regime, pattern, capture kind, …) | `SignalHistory` via `HistoricalValidationService` (not Product KPI filtered) |

## Product KPI cohort (canonical)

Mechanical definition — single source: `stocvest/signals/product_kpi.py`:

- `capture_kind = qualified`
- `decision_state_entry = actionable`
- `ledger_qualified = true`
- Accuracy: `correct / (correct + incorrect)`; neutrals excluded
- Public headline % hidden until **≥ 50** resolved non-neutral (per engine on cards when n ≥ 5 for Wilson only)

**Not** the same as setup outcomes: Product KPI is emitted **signal** direction vs later price; setup outcomes are **layer alignment** across maturation sessions on the user's watchlist.

## Mode separation

Swing and Day are never combined into one accuracy headline (assistant + UI contract).

## Redirects

- `/dashboard/performance` → `/dashboard/setup-outcomes` (user watchlist behavior home)
- `/dashboard/signal-validation` → `/dashboard/setup-outcomes`
- Product KPI marketing accuracy stays on **`/performance`** (logged-out and logged-in)

## Ops

Product KPI % rises with time and maturation (`outcome_1d`), not with shadow rows or internal D2 buckets.
