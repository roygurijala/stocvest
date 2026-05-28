# Opportunity Desk & Dashboard Radar — master plan

**Status:** Planning + **Batch 1 in progress** (2026-05-26)  
**Owners:** Product + platform  
**Companion docs:** [`DASHBOARD_TERMINAL_UX_PLAN.md`](./DASHBOARD_TERMINAL_UX_PLAN.md) (perf / IA), [`PERFORMANCE.md`](./PERFORMANCE.md) (SLOs), [`BACKLOG.md`](./BACKLOG.md) (**D13**), [`API_CONTRACTS.md`](./API_CONTRACTS.md) (routes when added)

This document captures **everything discussed** in the Opportunity Desk / full-market funnel / dynamic dashboard thread: the problem, the target architecture, refresh and lifecycle rules, dashboard UX, phased delivery, and acceptance criteria. Implement in **small batches**; do not skip acceptance checks between phases.

---

## 1. Executive summary

**Goal:** Surface names like **MU** at the right time (full-market scan) while keeping **expensive intelligence** (news, macro, sector narrative, composite, R/R gates) on a **small survivor set** — the same model Finviz / Trade Ideas / Bloomberg use.

**Second goal:** Make `/dashboard` a **morning command center** — market sentiment, ranked discovery, and watchlist attention — instead of a static status console.

**Constraint:** Intelligence on ~8,500 symbols is not affordable; **cheap math on the broad market → expensive steps on 50–150 survivors → show 15 on dashboard** is the contract.

---

## 2. Problems today (verified in code)

| Issue | Current behavior | User impact |
|-------|------------------|-------------|
| **Scanner universe cap** | `maxUniverseSymbols: 50` in dashboard scanner tuning; `capScannerUniverse()` in `frontend/lib/api/scanner-load.ts` | Pattern setups and heavy loads only on desk + gap + watchlist (capped); **10 watchlist slots reserved** so default-list symbols are never dropped when desk/gap fill the cap |
| **Gap display cap** | `_GAP_INTEL_TOP_N = 20` in `stocvest/api/handlers/scanner.py` | Movers outside top 20 by \|gap\| never appear in gap intelligence |
| **Dashboard scanner frozen** | `DashboardScannerDeferredFetch` runs once per navigation; `DashboardScannerHydrate` has no polling | MU rips at 11:00 — dashboard still shows 10:00 load |
| **No Discovery top 15** | Opportunity cards are counts (`buildOpportunityCards`), not ranked symbols | “Discovery” is implied, not shown |
| **Scheduled scan universe** | `merge_scheduled_scan_symbol_universe` cap **40** (`scanner_scheduled_pipeline.py`) | Background jobs do not scan full market |
| **Edge vs scanner split** | `useDashboardPayload` polls **60s** (market pulse only); `useLiveSignals` is **no-op** | Regime can update; gaps/setups do not |
| **Gap warmer scope** | `GAP_INTEL_TICK_SYMBOLS = SPY,QQQ,IWM` every 2 min | Does not warm random intraday movers |

**What already works (reuse, do not rewrite):**

- `PolygonClient.get_us_stocks_market_snapshots()` — paginated US equities feed
- `dynamic_gap_candidates_from_snapshots_with_stats()` — liquidity + \|gap\| rank (`day_trading_scanner.py`)
- `POST /v1/scanner/gap-intelligence` — full feed when snapshots empty (with timeout fallback to bounded watchlist)
- `market_pulse_refresher` — **every 1 min** 9:30–16:00 ET → Redis (`DashboardKeys.MARKET_PULSE`)
- Maturation refresh schedules (watchlist tiers) — EventBridge in `infra/eventbridge_scheduler_6g.tf`
- Swing composite + execution/R/R presentation (Signals desk)

---

## 3. Target architecture — five-step funnel

Same pattern as Finviz / Trade Ideas: **cheap broad scan → narrow → expensive intelligence on survivors**.

| Step | Operation | Typical count | Cost | Implementation home |
|------|-----------|---------------|------|---------------------|
| **1** | US equities snapshot batch | ~8,000 | 1 paginated Polygon feed | Existing `get_us_stocks_market_snapshots` |
| **2** | Price + volume + prior-day ADV gates | ~300–800 eligible | Arithmetic | `dynamic_gap_candidates_*` filters (shared with gap intel) |
| **3** | Rank movers (gap + optional rel-volume tie-break) | Top **150** | Arithmetic | **`opportunity_desk.funnel`** (Batch 1) |
| **4** | Sector momentum (ETF session %) | Refine to **50–80** | Cheap | Sector daily cache worker (existing); wire in Phase C |
| **5** | Full swing/day composite + news | Top **40–80** in, **15** displayed | Expensive | `swing_composite_engine` / `real_composite_engine` |

**Moat stays in Step 5.** Steps 1–4 find candidates; Step 5 explains **why** and **why not trade** (alignment, R/R, extension).

### 3.1 Default limits (configurable)

Defined in `stocvest/api/services/opportunity_desk/funnel.py` as `OpportunityDeskFunnelConfig`:

| Constant | Default | Role |
|----------|---------|------|
| `movers_radar_limit` | 50 | Tier B — math-only ribbon / “more movers” |
| `survivor_limit` | 150 | Max symbols before composite (Step 3 out) |
| `discovery_display_limit` | 15 | Dashboard Discovery block |
| `gap_intel_display_limit` | 20 | Parity with current gap desk |
| `min_abs_gap_percent` | 2.0 | Same as gap intelligence |
| `min_day_volume` | 500_000 | Same as gap intelligence |
| `min_trade_price` | 5.0 | Same as gap intelligence |
| `min_prev_day_volume` | 1_000_000 | Same as gap scanner |

---

## 4. Refresh model — three tiers

Dashboard liveness must be **tiered**, not one refresh rate.

| Tier | Contents | Server cadence | Client cadence | Notes |
|------|-----------|----------------|----------------|-------|
| **A — Pulse** | SPY/QQQ/VIX, regime, sentiment headline | 1 min RTH (`market_pulse_refresher`) | 60s SWR (`useDashboardPayload`) | **Shipped** |
| **B — Movers radar** | Top 50 from snapshot math only | Every **15 min** RTH (new scheduler) | 15 min or manual | No composite; cheap |
| **C — Discovery desk** | Top 15 with composite + narrative | Pre-open **8:00 ET**, **10:00**, **12:00**, **14:00** ET + manual | Read cache; “Updated 8:02 AM” | Dynamo/Redis `PlatformDeskSnapshot` |

**Manual:** “Refresh desk” button, **5 min** cooldown per user, runs Tier B then C for survivors delta only.

**Invariant:** Never run Step 5 on dashboard page load for all users — always read cache.

### 4.1 Lifecycle (symbol state machine)

Prevents silent disappearance when a name fades (e.g. MU after +16% day).

| State | Condition | UI |
|-------|-----------|------|
| `new` | In current top 15, not in previous snapshot | “New since last scan” chip |
| `active` | In current top 15 | Full discovery row |
| `cooling` | Dropped from top 15 but was in top 15 within **24h** | “Recently hot” rail: “−6% from session high · dropped out” |
| `watchlist_override` | User tracks symbol | Always in Watchlist radar regardless of top 15 |

**Diff helper:** `diff_desk_snapshots(previous, current)` in `opportunity_desk.funnel` (Batch 1).

---

## 5. Dashboard UX — three pillars

Replace monotonous “system state + three equal cards” with:

### 5.1 Pillar 1 — Market sentiment (hero)

- One headline: *Risk-on · Breadth improving · VIX −4%*
- SPY / QQQ / VIX session %
- Leading + lagging sector chips (from existing sector rotation)
- One desk posture line (swing/day)
- **Demote** large system-state banner to expandable detail

**Data:** Tier A + existing `buildMarketContextSnapshot`.

### 5.2 Pillar 2 — Discovery (ranked rows)

- **5–8 rows** above fold, max **15** with “View all →”
- Columns: symbol, why here (gap / sector / catalyst), desk, CTA → Signals
- Footer: *Scanned {eligible} symbols pre-open · Top 15 by setup quality*
- Execution hint when blocked: *Strong setup · R/R blocks entry*

**Data:** Tier C cache (`PlatformDeskSnapshot`); v0 = gap top 20 + scanner setups until cache ships.

### 5.2b Pillar 2b — Quiet leaders (under the surface) ✅ **Shipped 2026-05-27**

- **Swing dashboard only** — separate from Hot in market (velocity-ranked movers)
- **5–8 rows** of names with **|session gap| &lt; 2%**, excluded from top **50** movers radar, **price &gt; SMA50 & SMA200**, **RSI 55–70**, **bullish** swing technical score **≥ 58**, then bounded swing composite
- UI: **`DashboardQuietLeadersFeed`**; Scanner section **`#scanner-quiet-leaders`**
- Backend: **`stocvest/api/services/opportunity_desk/quiet_leaders.py`** on full **`opportunity_desk`** batch; cache field **`quiet_leaders`** on swing desk envelope
- Quiet-leader symbols merge into scanner universe (up to **15**) via **`symbolsFromDeskSlice`**

### 5.3 Pillar 3 — Watchlist radar

- **3–6 rows** only when attention triggers fire:
  - Maturation → actionable / near_ready
  - \|session %\| above threshold
  - Earnings today/tomorrow
  - Maturation band changed since last visit
- **Independent of top 15** — user symbols always evaluated

**Data:** maturation-summary + snapshot % for watchlist symbols only (small N).

### 5.4 Below the fold

- Market context expand (weekly indices, macro)
- Earnings highlights (not full calendar)
- Optional: “Since you were here” strip (last visit timestamp in localStorage + server diff)

### 5.5 Copy tone

Calm urgency — no hype. Dynamic page title: *Tuesday · Risk-on open*.

---

## 6. Product surfaces (separation of concerns)

| Surface | Role | Universe |
|---------|------|----------|
| **Dashboard** | Orient + act | Discovery 15 + watchlist radar + sentiment |
| **Scanner** | Pattern desk (ORB, gap, etc.) | Watchlist (**10 reserved**) ∪ gap ∪ desk discovery/movers/quiet leaders (cap **50** for bars) |
| **Signals** | Full composite + execution | Single symbol deep dive |
| **Gap intelligence desk** | Gap + catalyst narrative | Top 20 (align with funnel or subset of Tier B) |

**Do not** duplicate the full scanner table on the dashboard.

---

## 7. Phased implementation plan

Each phase has **acceptance criteria** and **tests**. Do not start phase N+1 until phase N tests pass in CI.

### Phase 0 — Documentation & constants ✅ **Shipped 2026-05-26**

- [x] This master doc
- [x] **D13** in `BACKLOG.md` + `README.md` index + cross-link in `DASHBOARD_TERMINAL_UX_PLAN.md`
- [x] `stocvest/api/services/opportunity_desk/funnel.py` + `tests/api/services/test_opportunity_desk_funnel.py` (4 tests)
- [x] `frontend/lib/dashboard/desk-refresh-tiers.ts` + `frontend/tests/desk-refresh-tiers.test.ts` (4 tests)

### Phase 1 — Backend cache & read API ✅ **Shipped 2026-05-26**

**Scope (implemented):**

- Upstash Redis envelopes via `write_dashboard_cache` — keys `stocvest:dashboard:opportunity_desk_{swing|day}`
- `stocvest/api/services/opportunity_desk/batch.py` — full US snapshot funnel + bounded composite (12 swing / 8 day)
- `GET /v1/desk/today` — `stocvest/api/handlers/desk.py` on `market_data` Lambda
- BFF `GET /api/stocvest/desk/today`
- EventBridge: `opportunity_desk` @ 8:00 + 10:00/12:00/14:00 ET; `opportunity_desk_movers` every 15m 9:00–15:45 ET
- **`terraform apply`** required for API route + schedules

**Acceptance:**

- [x] `pytest tests/api/test_desk_today.py` + `test_opportunity_desk_batch.py` + funnel tests green
- [x] Scanner routes `opportunity_desk` / `opportunity_desk_movers` in `test_scanner.py`
- [ ] Prod: confirm batch completes &lt; 120s with Polygon full feed (manual after deploy)

### Phase 2 — Dashboard UI pillar 1 + 3 (sentiment + watchlist radar) ✅ **Shipped 2026-05-26**

- [x] `DashboardMarketPulseHero` — regime headline, SPY/QQQ/VIX, sector lead/lag, desk detail fold
- [x] `DashboardWatchlistRadar` — maturation + default watchlist, attention filter (max 6)
- [x] System state banner removed; suppressed callout kept when gated
- [x] Market context in collapsible “More market context”
- [x] Tests: `dashboard-radar-phase2.test.tsx`

### Phase 3 — Dashboard UI pillar 2 (discovery feed) ✅ **Shipped 2026-05-26**

- [x] `DashboardDiscoveryFeed` — `useDeskToday` + gap-intel fallback
- [x] “Recently hot” rail from desk cache
- [x] Per-row Signals deep links; execution hint when composite blocked R/R
- [x] Removed `DashboardOpportunitiesOverview` + `NearReadyEngagementStrip` (duplicated by radar)

### Phase 4 — Client refresh & lifecycle ✅ **Shipped 2026-05-26**

**Scope (implemented):**

- `useDashboardDeskRefresh` — Tier B SWR poll 15 min RTH + `router.refresh()` on poll
- `POST /v1/desk/refresh` + BFF + Discovery **Refresh desk** button (5 min client + server cooldown)
- `since_last_visit` diff strip (`desk-since-last-visit.ts`)

**Acceptance:**

- [x] Tier B poll triggers `router.refresh()` after first desk load (RTH)
- [x] Manual refresh respects 5 min cooldown (localStorage + Upstash)
- [ ] Prod: manual refresh completes within scanner Lambda timeout (manual after deploy)

### Phase 5 — Scanner universe widening ✅ **Shipped 2026-05-26**

**Scope (implemented):**

- `frontend/lib/dashboard/scanner-universe.ts` — watchlist ∪ desk discovery/movers ∪ gap top 30
- Dashboard + scanner client loads: `maxUniverseSymbols: 50`, desk cache merge on load
- Gap intelligence display cap raised to **30** (`_GAP_INTEL_TOP_N`)
- Scheduled scans merge desk movers from Upstash (`scanner_universe.py`)

**Acceptance:**

- [x] Desk movers/discovery symbols prioritized in `capScannerUniverse` before watchlist-only names
- [x] Unit tests: `scanner-universe.test.ts`, `test_opportunity_desk_scanner_universe.py`

### Phase 6 — Assistant & observability ✅ **Shipped 2026-05-26**

**Scope (implemented):**

- `dashboard_context.discovery` — `source`, `scanned_count`, `generated_at`, `recently_hot` (desk cache when available)
- CloudWatch namespace **`OpportunityDesk`**: `BatchDuration`, `SurvivorCount`, `CompositeFailures`, `ScannedSnapshotCount` (tier dimension)
- `stocvest/api/services/opportunity_desk/metrics.py` — published at end of each batch run

### Phase 7 — Quiet leaders + watchlist universe reserve ✅ **Shipped 2026-05-27**

**Scope (implemented):**

- **`quiet_leaders.py`** — low-velocity funnel + technical screen + bounded composite; written on **`opportunity_desk`** full batch (swing cache only)
- **`WATCHLIST_UNIVERSE_RESERVE = 10`** — `capScannerUniverse()` guarantees up to 10 default-watchlist symbols survive the 50-symbol cap (`scanner-load.ts`, `scanner_scheduled_pipeline.py`)
- Dashboard **`DashboardQuietLeadersFeed`**; Scanner **`ScannerQuietLeadersSection`**
- Tests: `test_quiet_leaders.py`, extended `scanner-universe.test.ts`, `test_opportunity_desk_scanner_universe.py`

**Acceptance:**

- [x] Watchlist symbols on default list are always evaluated for pattern setups when present in merged universe
- [x] Quiet leaders do not duplicate Hot in market rows (gap &lt; 2%, not in top movers)
- [ ] Prod: full desk batch populates `quiet_leaders` after deploy (manual)

---

## 8. Business logic review (why this order)

1. **Funnel before UI** — Avoid showing a “top 15” that is still watchlist-biased; cache must exist first.
2. **Tier B before Tier C intraday** — Movers list updates cheaply; composite 4×/day is enough for swing-oriented discovery; day traders get Tier B + Scanner.
3. **Watchlist radar independent of top 15** — Users must never feel “I have to add it to see it on my dashboard.”
4. **Recently hot rail** — Solves “fell out of top 15” without keeping stale composite on the main list.
5. **R/R and extension stay in Signals** — Discovery may show a strong story with “execution blocked”; never imply trade permission on dashboard.

---

## 9. Dependencies & risks

| Risk | Mitigation |
|------|------------|
| Polygon 403 on full snapshot | Fallback to `LIQUID_SYMBOLS_FALLBACK`; surface “limited universe” in UI |
| API Gateway 30s timeout | Batch only in scheduled Lambda (120s), never on dashboard GET |
| Cost of Step 5 | Hard cap survivors; concurrency limit; skip unchanged symbols |
| Stale dashboard | Tier B polling + `generated_at` + manual refresh |
| Legal copy | Discovery rows are observational; link to Signals for full disclaimer |

---

## 10. Testing strategy

| Layer | Tests |
|-------|--------|
| Funnel math | `tests/api/services/test_opportunity_desk_funnel.py` |
| Quiet leaders | `tests/api/services/test_quiet_leaders.py` |
| Batch worker | `tests/api/services/test_opportunity_desk_batch.py` (Phase 1) |
| API contract | `tests/api/test_desk_today.py` (Phase 1) |
| Dashboard present | `frontend/tests/dashboard-discovery-feed.test.ts` (Phase 3) |
| Refresh tiers | `frontend/tests/desk-refresh-tiers.test.ts` (Phase 0) |
| Chaos / timeout | Extend `dashboard-load-chaos.test.ts` for desk fallback |

---

## 11. Files touched (rolling)

| Batch | Files |
|-------|--------|
| 0 | `docs/OPPORTUNITY_DESK_AND_DASHBOARD_RADAR.md`, `docs/BACKLOG.md`, `docs/README.md`, `stocvest/api/services/opportunity_desk/funnel.py`, `tests/api/services/test_opportunity_desk_funnel.py`, `frontend/lib/dashboard/desk-refresh-tiers.ts`, `frontend/tests/desk-refresh-tiers.test.ts` |
| 1 | `opportunity_desk/batch.py`, `snapshot_load.py`, `discovery_row.py`, `handlers/desk.py`, `tests/api/test_desk_today.py`, `tests/api/services/test_opportunity_desk_batch.py`, `infra/apigateway_6e.tf`, `infra/eventbridge_scheduler_6g.tf`, `frontend/app/api/stocvest/desk/today/route.ts`, `docs/API_CONTRACTS.md` §4.2.1 |

---

## 12. Conversation reference (decisions log)

- **Finviz model:** Pre-compute OHLCV math on full universe; SQL/filter on numbers; no AI on all symbols.
- **STOCVEST moat:** Intelligence only on survivors; explain why **not** to trade (MU +16% with poor R/R).
- **Scanner vs Discovery:** Scanner = patterns on bounded universe; Discovery = ranked opportunities from batch.
- **Dashboard refresh:** Not one rate — pulse 60s, movers 15m, discovery batch 3–4×/day + manual.
- **Outside top 15:** Tier B ribbon + recently hot + watchlist radar + page refresh.

---

*Update this doc when each phase ships; move completed phase details to `IMPLEMENTED.md` with ID **D13**.*
