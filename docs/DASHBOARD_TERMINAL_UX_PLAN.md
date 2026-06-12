# Dashboard — terminal-grade UX & performance master plan

**Status:** Tier **1.C Phases 0–5 shipped** (2026-05-15). **Live `/dashboard` is now the Trading Room redesign (B63, 2026-06-05) — see §9.** Phases 0–5 below describe the **data-loading orchestration + IA + SLOs** that still underpin the dashboard; the Trading Room reuses that machinery (`fetchDashboardFirstSegment`, deferred scanner hydrate) behind a new three-zone presentation. See §5 + §8 + §9 + [`PERFORMANCE.md`](./PERFORMANCE.md) §1 for SLOs.

**Theme:** Keep **current site color tokens** (dark theme, existing `design-system` / `DashboardCard` patterns). External mockups are **IA and interaction reference only**, not pixel specs.

**Companion docs:** [`PERFORMANCE.md`](./PERFORMANCE.md) (cross-cutting perf invariants), [`BACKLOG.md`](./BACKLOG.md) (D11 performance lane), [`OPPORTUNITY_DESK_AND_DASHBOARD_RADAR.md`](./OPPORTUNITY_DESK_AND_DASHBOARD_RADAR.md) (D13 full-market discovery + dashboard radar), [`README.md`](./README.md) (doc index).

**Scanner quiet day (B49, 2026-05-19):** On `/dashboard/scanner` when nothing qualifies, section roles are fixed — **Near Ready** = opportunity, **Market conditions** = explanation (regime ✓ + volume blocker), **Scan outcome** = conclusion, **Gap Intelligence** = edge case (de-emphasized when empty), **Setups** = desk confirmation (secondary chrome). Full “what would change” footer only when the cause is not obvious (`shouldShowQuietWhatWouldChangeSection` in `frontend/lib/scanner-quiet-copy.ts`); otherwise a one-line **Focus** / scan-outcome watch hint. Implementation: `ScannerQuietDesk`, `scanner-quiet-copy.ts`, `scanner-quiet-desk.ts`.

---

## 1. Product bar (Bloomberg / TradeDesk *behavior*, not clone)

| Expectation | STOCVEST target |
|-------------|-----------------|
| Time to first useful paint | Shell + tape + regime strip **without** waiting for full scanner + gap-intelligence chain. |
| Bounded tail | No single user-facing wait dominated by **58s-class** server waterfalls; each **tier** has a budget and a fallback. |
| Predictable refresh | Stale-while-revalidate where safe; tiered cadence for discovery vs setups (align with gap-intel `cadence_seconds` over time). |
| Density without chaos | **Clickability hierarchy** (below): deep vs medium vs light vs non-clickable — avoids “everything is a button.” |

---

## 2. Clickability hierarchy (functional spec)

| Level | Interaction | Examples |
|-------|-------------|----------|
| **1 — Deep** | Primary navigation: open full evidence / Signals for symbol+mode. | Setup cards, ribbon chips (already deep-link with hover prefetch). |
| **2 — Medium** | Inline expand / drawer; **no** route change. | Discovery “gap leaders” list; sector flow drill-down. |
| **3 — Light** | Tooltip / small popover; **info icon** for posture copy. | “Why is swing Active?”; SPY/QQQ 5d spark hint. |
| **4 — Not clickable** | Read-only summary. | Universe count strip; macro/regime summary dots when text is already visible. |

**Invariant:** Assistant / chatbot context must mirror **only** what the user can see for that tier (see §7).

---

## 3. SLOs (draft — tune after Phase 0 metrics)

| Milestone | Target (warm / typical network) | Notes |
|-----------|----------------------------------|--------|
| First contentful dashboard | **< 2s P75** | Shell + market tape from fast path. |
| Scanner + desks usable | **< 8s P75** | May show skeleton + partial data first after Tier 1.C streaming. |
| Hard ceiling (degraded) | **< 15s** | Partial JSON + explicit “still loading” or cached snapshot — never silent 30s blank. |

Cold Lambda / Polygon spikes are **measured**, then **cached** or **moved off** the blocking path — not accepted as permanent UX.

---

## 4. Architecture — data tiers

| Tier | Contents | Suggested delivery |
|------|-----------|-------------------|
| **0** | Auth, plan, `dayTradingSurfaces`, scanner mode | Existing RSC; keep minimal. |
| **1** | Indices + VIX + sparklines + regime inputs | Fast path; consider edge cache later (`PERFORMANCE.md` Layer 1). |
| **2** | Gap discovery summary + gap list (or cached snapshot) | Must not block Tier 1; optional `GET /v1/dashboard/summary` later. |
| **3** | Swing/day setups, desks, ribbon | Stream after Tier 1 or merge from same aggregate endpoint. |

**Bottleneck (historical):** Previously `DashboardPageContent` awaited one `Promise.all` that bundled market, earnings, daily, and the full **scanner** chain. **As of 2026-05-15** the first RSC segment is **market + daily bars** only; **earnings** and **scanner** each **stream** (nested `Suspense`). Further wins: backend aggregate API, edge cache (`PERFORMANCE.md` Layer 1).

---

## 5. Phased delivery (engineering order)

### Phase 0 — **Shipped (this pass): measurement**

- Server-side **per-phase timing** for dashboard fetches when `STOCVEST_DASHBOARD_TIMING=1` **or** `NODE_ENV=development`.
- Implementation: `frontend/lib/dashboard/load-timing.ts` + `dashboard-page-content.tsx`.

### Phase 1 — **Shipped (2026-05-14 / 2026-05-15):** dashboard **scanner + earnings** deferred streams

- **RSC:** `dashboard-page-content.tsx` awaits **user/me** then **`fetchDashboardMarketDailySlice`** (market + daily bars only).
- **Nested `Suspense`:** **`deferredEarningsSlot`** → `DashboardEarningsDeferredFetch` (earnings calendar); **`deferredScannerSlot`** → `DashboardScannerDeferredFetch` (scanner core). Each hydrates via **`DashboardEarningsHydrate`** / **`DashboardScannerHydrate`** into **`DashboardEarningsProvider`** / **`ScannerOverviewProvider`**.
- **Helpers:** `lib/dashboard/dashboard-page-data.ts` centralizes timeouts/fallbacks for market, earnings, and scanner slices.
- **Lock-in tests:** `frontend/tests/dashboard-scanner-deferred-hydrate.test.tsx`, `frontend/tests/dashboard-earnings-deferred-hydrate.test.tsx`, `frontend/tests/dashboard-tier1c-dual-deferred-hydrate.test.tsx` (both slots + ribbon + calendar).
- **Tier 1.C complete** (Phases 0–5). Optional follow-ups: hero vs desks visual islands; production P75 numbers in `PERFORMANCE.md` §1.

### Phase 2 — **Shipped (2026-05-15):** backend aggregate `GET /v1/dashboard/summary`

- **`stocvest/api/services/dashboard_summary.py`** — one Polygon session; parallel **status + snapshots + 5m sparklines + daily closes + earnings**.
- **Route:** `GET /v1/dashboard/summary` on `market_data` Lambda (`lambda_dispatch.py`, `infra/apigateway_6e.tf`). Query: `earnings_symbols`, `earnings_days`, `sparkline_limit`, `daily_limit`.
- **Frontend:** `fetchDashboardSummary` + `fetchDashboardFirstSegment` (`lib/api/dashboard-summary.ts`, `lib/dashboard/dashboard-page-data.ts`) — replaces separate market/daily/earnings calls when the API is up; **legacy parallel fallback** if aggregate returns null/timeout. Earnings calendar is back in the **first RSC segment** (no `deferredEarningsSlot` on the happy path); **scanner** still deferred.
- **Tests:** `tests/api/handlers/test_market_data.py::test_dashboard_summary_handler_returns_aggregate_payload`, `frontend/tests/dashboard-summary-api.test.ts`.

### Phase 3 — **Shipped (2026-05-15):** IA / click hierarchy (partial)

- **`frontend/lib/dashboard/click-hierarchy.ts`** — `DashboardInteractionLevel` (`none` | `light` | `medium` | `deep`) + `data-interaction-level` via `interactionLevelProps()`.
- **New surfaces** (after ribbon, before desk grid in `dashboard-redesign.tsx`; gated on `scannerDataSettled` so empty `EMPTY_SCANNER_OVERVIEW` does not flash placeholders):
  - **`DashboardUniverseStrip`** — Level 4 read-only swing/gap universe counts.
  - **`DashboardDiscoveryRow`** — Level 2 `<details>` gap leaders; Level 1 deep link to Scanner footer only.
  - **`DashboardDeskPostureSummary`** — compact swing/day posture cards with Level 3 info tips.
- **Existing surfaces:** hero strip wrapper + active-signal ribbon chips tagged (`light` / `deep`).
- **Lock-in:** `frontend/tests/dashboard-phase3-ia.test.tsx` (6 tests).
- **Still open:** full Level 1–4 matrix on every desk card/surface; keyboard focus-order audit.

### Phase 4 — **Shipped (2026-05-15):** Assistant schema

- **`frontend/lib/dashboard/dashboard-assistant-context.ts`** — `buildDashboardAssistantPageContext()` emits flat dual-desk fields plus nested **`dashboard_context` v1** (`regime`, `discovery`, `universe`, desk postures, `top_setups`, `macro_events`).
- **`discovery_expanded`:** when the discovery `<details>` is open, `gap_leaders_detail[]` is attached (same gap rows as on screen, capped at 10).
- **Backend:** `serialize_page_context` in `stocvest/signals/assistant_prompts.py` whitelists v1 keys (`dashboard_context_version`, `discovery_*`, `universe_*`, `gap_leader_*`, `macro_event_*`).
- **Lock-in:** `frontend/tests/dashboard-assistant-context.test.ts`, `tests/signals/test_assistant_prompts.py::test_serialize_page_context_emits_dashboard_context_v1`, updated `dashboard-hero-strip` chatbot contract.

### Phase 5 — **Shipped (2026-05-15):** load / chaos hardening + SLO table

- **`frontend/lib/dashboard/dashboard-slo.ts`** — product targets (2s / 8s / 15s), fetch budgets, `[dashboard-load]` phase labels.
- **`frontend/lib/dashboard/dashboard-fetch-resilience.ts`** — shared `timeoutFallback` (extracted from `dashboard-page-data.ts`).
- **Lock-in:** `frontend/tests/dashboard-load-chaos.test.ts` (timeout + summary/scanner/earnings chaos), `frontend/tests/dashboard-degraded-shell.test.tsx` (hero + ribbon + universe error copy), `frontend/tests/dashboard-tier1c-dual-deferred-hydrate.test.tsx`.
- **SLOs published:** [`PERFORMANCE.md`](./PERFORMANCE.md) §1 — draft targets + measurement recipe; production P75 rows marked *pending* until `[dashboard-load]` samples are collected post-deploy.

---

## 6. Rearchitect “everything”?

**No full greenfield.** Replace the **loading orchestration** and optionally add **one aggregate API**; **evolve** `dashboard-redesign.tsx` by extraction, not rewrite, unless profiling proves the client tree is the bottleneck.

---

## 7. Chatbot structure

- **Stable keys** aligned to UI sections: `regime`, `discovery`, `universe`, `swing_desk_posture`, `day_desk_posture`, `top_setups`, `macro_events`.
- **No invented symbols:** lists must come from the same arrays rendered on screen.
- **Section-scoped expansion:** when user opens Level 2 discovery, attach `gap_leaders_detail` for that turn only (token budget).

---

## 8. Related code (living map)

| Area | Location |
|------|-----------|
| Dashboard RSC load | `frontend/components/dashboard-page-content.tsx`, `frontend/lib/dashboard/dashboard-page-data.ts`, `frontend/lib/api/dashboard-summary.ts` |
| Summary aggregate API | `stocvest/api/services/dashboard_summary.py`, `stocvest/api/handlers/market_data.py` (`dashboard_summary_handler`) |
| Earnings deferred RSC | `frontend/components/dashboard/dashboard-earnings-deferred-fetch.tsx`, `dashboard-earnings-suspense-fallback.tsx` |
| Scanner deferred RSC | `frontend/components/dashboard/dashboard-scanner-deferred-fetch.tsx` |
| Earnings context + hydrate | `frontend/components/dashboard/dashboard-earnings-context.tsx`, `dashboard-earnings-hydrate.tsx` |
| Scanner context + hydrate | `frontend/components/dashboard/scanner-overview-context.tsx`, `dashboard-scanner-hydrate.tsx` |
| Client dashboard | `frontend/components/dashboard-redesign.tsx` |
| Click hierarchy | `frontend/lib/dashboard/click-hierarchy.ts` |
| Dashboard assistant context | `frontend/lib/dashboard/dashboard-assistant-context.ts` |
| SLO targets + fetch budgets | `frontend/lib/dashboard/dashboard-slo.ts`, `dashboard-fetch-resilience.ts` |
| Phase 3 IA surfaces | `frontend/components/dashboard/dashboard-universe-strip.tsx`, `dashboard-discovery-row.tsx`, `dashboard-desk-posture-summary.tsx` |
| Scanner fan-in | `frontend/lib/api/scanner-load.ts` |
| Perf invariants | `docs/PERFORMANCE.md` §3 |

---

## 9. Trading Room redesign — live `/dashboard` (B63, 2026-06-05)

The dashboard's **presentation** was rebuilt as a focused "Trading Room" decision surface. The Tier 1.C **data tiers, streaming, SLOs, and IA principles** (§1–§8) are unchanged and still apply — the Trading Room reuses `fetchDashboardFirstSegment` (now also returns `sectorRotation` 1d/5d) plus the deferred `DashboardScannerClientFetch` hydrate; only the rendered UI changed.

**Live wiring:** `app/dashboard/page.tsx` → `TradingRoomPreviewContent` (`frontend/components/dashboard/trading-room/trading-room-preview-content.tsx`) → `DashboardTradingRoom`. The same surface is also served at `/dashboard/preview`.

**Three zones** (`dashboard-trading-room.tsx`):

1. **Session header** — market regime + a plain-English read of what it implies, market-status pill, SPY / QQQ / IWM / **VIX** (value + change, window-labeled `today` / `prior session`), desk counts (`actionable · near · potential`), a **global `SymbolSearch`** typeahead, and an "Updated …" freshness stamp.
2. **Signal feed** — ranked, capped, lane-aware compact cards (Day / Swing) built by the **pure** `lib/dashboard/trading-room/feed-model.ts` from Opportunity-Desk discovery + scanner setups. Filter bar = `[All · Day · Swing] · [Actionable · Near · Potential] · [Long · Short · Both]`. When the desk is genuinely quiet (no qualified setups) the feed renders **`QuietFeed`** — **Session activity** (today's bigger movers) + **Building structure** (quiet leaders / near-ready, via `resolveBuildingStructureRows`) — instead of empty space. A per-feed `SymbolSearch` lets the user look up any ticker (even one not on the desk).
3. **Center panel** — defaults to the **Market Brief** (`market-brief.tsx`: first-name greeting, AI narrative from `GET /v1/market/brief`, indices + VIX, **1-day + 5-day** sector chips, notable movers, headlines, signal summary, "What to watch", and a right-aligned "Market pulse" refresh time) and swaps to the **Deep Dive** (`deep-dive.tsx`: verdict header, plain-English brief, **Setup / Layers / Evolution** segmented tabs, analyst ratings) when a card/symbol is selected. **Layers** tab layer drawers (B66) expose curated headlines, analyst actions, and technical evidence via `layer-drawer-present.ts`. **Evolution** tab (B68) uses score-based analytics from setup-evolution **`analytics`** — see **`SETUP_ANALYTICS_SPEC.md`**. The **Watchlist rail** (`watchlist-rail.tsx`) is the collapsible third column.

**Selection memory (updated B67, 2026-06-10):** module-scoped `session-selection.ts` restores the last selected signal on **SPA return** within the same trading day. **First open each America/New_York calendar day** and **logout → login** reset to **Market Brief** (`isFirstVisitOfTradingDay`, `clearTradingRoomClientSession`, post-login fresh flag). **Session expiry re-auth** does **not** clear trading-room session — user returns to the same deep-dive via `?next=`. Hard refresh still opens Brief.

**Backend additions:** persisted **`first_name`** on `UserProfile` (`GET`/`PATCH /v1/users/me`) for the greeting, and the AI market narrative **`GET /v1/market/brief`** (`stocvest/api/services/market_brief.py`, Claude Haiku, warm-container in-process cache) with same-origin BFF proxies `app/api/stocvest/market/{brief,news}/route.ts`. See **`API_CONTRACTS.md` §4.2 / §4.10** and **`IMPLEMENTED.md` B63**.

**B65 reliability (2026-06-08):** When the server RSC first segment returns empty index snapshots (common on **cold Lambda**), **`useDashboardTape`** client-backfills SPY/QQQ/IWM/VIX and market status without blocking the shell. All Trading Room client fetches route through the BFF (`browserApiFetch` + **`api-path-to-bff.ts`**) — see **`API_CONTRACTS.md` §4.11** and **`IMPLEMENTED.md` B65**.

**Deliberately absent** (per the redesign brief): scrolling data tables, percentage-change columns, sidebar-style navigation inside the surface, and an embedded news ticker — context lives in the Brief and Deep Dive, not in dense grids.
