# SignalHistory retirement plan (B46 Phase 6)

**Status:** Prep complete (2026-05-17); **table drop not started.** Do **not** drop DynamoDB or stop `record_signal()` until steps 6–7 below.

Core B46 user surfaces use **`WatchlistMaturationTransition`** — see [`SETUP_ANALYTICS_SPEC.md`](./SETUP_ANALYTICS_SPEC.md).

## Completed (prep)

| Step | Status |
|------|--------|
| Freeze user UX (setup evolution / outcomes) | **Done** (B46 `3eab90f`) |
| Remove dead validation page client | **Done** |
| Deprecate `GET /v1/signals/me/history` in contracts + HTTP headers | **Done** |
| Public `/performance` decision | **Keep on SignalHistory** for directional-accuracy mirror until product replaces it |

## Dependents (must migrate or explicitly keep)

| System | Current use | Target |
|--------|-------------|--------|
| D2 stratified UI | `SignalHistory` | **Done** — `/dashboard/admin/historical-validation` only |
| User dashboard | validation / performance marketing | **Done** — `/dashboard/setup-outcomes`, `/dashboard/setup-evolution` |
| `record_signal()` + resolution job | Writes 1h/1d outcomes to `SignalHistory` | **Keep** (D1 + public mirror) |
| `GET /v1/signals/me/history` | Legacy ledger API | **Deprecated** — successor `GET /v1/analytics/setup-outcomes` |
| `GET /v1/signals/performance/summary` | Public `/performance` | **Keep** on SignalHistory (documented) |
| Weight proposer | Reads resolved rows | **Keep** short-term |
| Assistant chat | `HistoricalValidationService` | **Keep** (overall+by_mode only for users) |
| Ledger monitor | Recorded signal exits | **Keep** short-term |

## Remaining order

1. ~~Inventory~~ — see **Code inventory** below.
2. ~~Freeze UX~~ — done.
3. ~~Deprecate me/history~~ — done.
4. **Weight proposer** — optional transition-based export (future).
5. **Public performance** — optional observational block from transitions (future); until then SignalHistory stays.
6. **Stop writes** — after (4)(5) decided.
7. **Drop table** — Terraform + delete recorder paths.

## GSI backfill (ModeTimelineIndex)

Existing rows before GSI deploy lack `gsi1pk`/`gsi1sk`. Platform admin metrics only count post-deploy transitions. **Default: skip backfill**; new evaluations populate the index.

## Code inventory (2026-05-17)

**Backend write/read (keep until step 7):**

- `stocvest/api/services/signal_recorder.py` — `record_signal`, `resolve_signals`, `get_user_signal_history_page`
- `stocvest/api/handlers/signal_resolution.py` — scheduled D1 resolution
- `stocvest/api/handlers/signals.py` — `user_signal_history_handler` (deprecated), historical validation handlers
- `stocvest/api/services/historical_validation_service.py` — D2 aggregation
- `stocvest/api/services/weight_proposer.py` — optimization reads
- `stocvest/api/services/ledger_position_monitor.py` — ledger exits
- `stocvest/api/services/signal_validation_eligibility.py` — entry gates
- `stocvest/api/handlers/weight_rotation_monitor.py` — post-rotation accuracy

**Frontend (no user ledger UI):**

- BFF `app/api/stocvest/signals/me/history/route.ts` — legacy; no dashboard page consumes it after B46
- `lib/api/public-signals.ts` — `fetchUserSignalHistoryPage` (tests + unused aggregation helpers)

**Infra:** `infra/dynamodb.tf` — `SignalHistory` table; `infra/apigateway_6e.tf` — routes.

## Verification checklist

- [x] User routes redirect to setup-outcomes
- [x] Admin D2 at `/dashboard/admin/historical-validation`
- [x] `GET /v1/signals/me/history` returns `Deprecation` header
- [ ] Full `pytest tests/ -q` after each Phase 6 code change
- [ ] Full Vitest after each Phase 6 code change
- [ ] Weight proposer / resolution EventBridge still run while table kept
