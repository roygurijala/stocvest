# ADR-003 — Trading Room density reduction + sleek terminal UX

**Status:** Accepted — **UX-D0 + UX-D1 + UX-D2 + UX-D3 + UX-D4 + UX-D5 done (2026-09-04)**  
**Date:** 2026-09-04  
**Authors:** Product + engineering (user design review; Trading Room live since B63)  
**Supersedes / relates:** ADR-002 **UX-2** (market swing setups table on dashboard brief — **retired by UX-D1**); ADR-002 **UX-3** (single-scroll deep dive — **refined by UX-D4**); [`DASHBOARD_TERMINAL_UX_PLAN.md`](../DASHBOARD_TERMINAL_UX_PLAN.md) §9 (Trading Room IA); **does not** change six-layer math, geometry gates, or immutable API contracts unless a phase explicitly says so.

## Context

After B63 (Trading Room) and ADR-002 (personal swing-first shell), user feedback converged on **information overload**, not color:

1. **Deep Dive feels too long** — verdict, plain-English brief, risk stack, market context, bias rationale, timeframe, causal narrative, track plan, geometry honesty, layers, chart, evolution stacked at equal visual weight (ADR-002 UX-3 merged tabs into one scroll; density remains high).

2. **Home / Market Brief feels crowded** — bento tiles for narrative, indices, sectors, movers, headlines, swing table, watchlist-at-close, week ahead, outcomes, etc. compete for attention in one viewport.

3. **Too many symbols, low actionability** — the same tickers appear in desk feed (left), swing setups table (center), sector drill-down, movers, and watchlist rail (right). Default feed filters show **all states** (actionable + near + potential + cooling) and session **movers** labeled “not an entry,” which reads like a firehose of false opportunities.

4. **Color scheme is good** — charcoal/graphite dark base, blue accent (`#2e8bff`), green/red for P/L only, indigo/teal lane rails. User wants to **keep tokens**; “modern” means **space, hierarchy, progressive disclosure**, not a rebrand.

5. **Desk feed vs watchlist** — left column is the primary **ranked opportunity queue** into Deep Dive; right rail is **user-monitored universe**. Both stay, but with stricter defaults and less duplication.

6. **Heat maps** — user asked whether sector-stock and watchlist heat grids would help. Finviz-style full-market treemaps are out of scope on `/dashboard`; **compact contextual heat** (11 sector ETFs; watchlist grid toggle) fits the terminal bar.

## Decision

Ship a **density-reduction program** one phase at a time (same discipline as ADR-001/002):

| Lane | Goal |
|------|------|
| **DEDUP** | One primary symbol surface per relationship (actionable queue vs personal universe vs market context) |
| **DEFAULTS** | Actionable-first feeds; secondary lists behind expand/toggle |
| **HIERARCHY** | Decision summary above evidence; collapse or tab secondary panels |
| **CHROME** | Quieter borders/labels; keep existing `design-system` colors |
| **HEAT** | Optional compact heat views for sector context + watchlist — not additive symbol firehoses |

**North star:**

> Open `/dashboard` and know **what matters today in one glance** — regime, 0–5 actionable setups, your watchlist alerts — without scrolling past duplicate tables or “monitoring” names that will never clear geometry.

**Symbol ownership (invariant after ADR-003):**

| Relationship | Primary home | Max default visible |
|--------------|--------------|---------------------|
| Engine-qualified, tradable-ish | Desk feed (left), **Actionable + Near** filter | ~3–8 cards |
| User-monitored | Watchlist rail (right), collapsed or heat mode | User-defined; attention-tier sort |
| Market context | Market Brief — indices, sector ETFs, 1–2 movers | No long ranked tables |
| Full-market discovery | `/dashboard/scanner` | Unlimited |

**Color / brand:** **No palette change.** Accent blue only on interactive elements; reduce decorative glow and duplicate micro-labels.

## Consequences

- **Positive:** Calmer dashboard; fewer contradictory symbol lists; Deep Dive reads as “decision → evidence”; aligns with terminal-grade UX plan click hierarchy (Level 1 deep = feed cards; Level 2 = sector expand; Level 4 = read-only regime).
- **Negative:** ADR-002 UX-2 swing table removed from brief — users must use desk feed or Scanner for ranked swing lists; assistant context must drop `market_swing_table` keys when UI removes them.
- **Neutral:** Desk feed column **stays** (refined, not removed); Scanner page unchanged; signal engine and desk batch pipelines unchanged until filter/cap logic phases.

---

## Implementation phases (strict order)

Each phase ships with **tests**, **BACKLOG row update**, and user **“go ahead”** before the next phase starts unless noted as bundled doc-only.

| Phase | ID | Scope | Status |
|-------|-----|--------|--------|
| 0 | **UX-D0** | **This ADR** + BACKLOG section + cross-links in `DASHBOARD_TERMINAL_UX_PLAN.md` | **DONE 2026-09-04** |
| 1 | **UX-D1** | **Remove Market Brief swing setups table** — delete `MarketSwingSetupsTable` tile from `market-brief.tsx`; keep weekend **top swing hero** (single card); swing discovery remains on Scanner + desk feed Swing lane | **DONE 2026-09-04** |
| 2 | **UX-D2** | **Desk feed actionable-first** — default filters `state: actionable_near` (Actionable desk); demote **movers** to QuietFeed-only (not default Swing/Day lanes); lower `potential` cap; session header counts reflect setup cards (actionable + near) | **DONE 2026-09-04** |
| 3 | **UX-D3** | **Market Brief scan mode** — above-the-fold: greeting, regime one-liner, index row, sector row, top headline; defer movers table, week ahead, outcomes recap, watchlist-at-close behind “Expand brief” | **DONE 2026-09-04** |
| 4 | **UX-D4** | **Deep Dive tiers** — sticky glance header (symbol, verdict, price, confidence, lane); **Decision** block (plain summary + entry/stop/target strip); **Evidence** in tabs or accordions: Setup \| Layers \| Chart \| Context (collapse Evolution/Causal by default); supersedes ADR-002 UX-3 “full scroll” as default | **DONE 2026-09-04** |
| 5 | **UX-D5** | **Card chrome pass** — app-wide trading room: fewer 1px boxes, rely on surface steps; one hero element per panel; typography ladder (2–3 sizes); motion 150–240ms on expand (`animationDurations`) | **DONE 2026-09-04** |
| 6 | **UX-D6** | **Sector heat grid** — compact ETF + optional top-holdings grid (day % color); replaces long sector name list as default; tap cell → existing sector panel / Deep Dive; max ~11 ETFs + 8 names on drill-down | Pending |
| 7 | **UX-D7** | **Watchlist rail** — collapsed by default on desktop; **List ↔ Heat** toggle; heat shows session % + actionable/near badge only; full cards on expand | Pending |
| 8 | **UX-D8** | **Assistant + IA alignment** — `buildDashboardAssistantPageContext` mirrors visible tier only; update click-hierarchy levels on new heat/expand surfaces; Vitest contract tests | Pending |

**Recommended PR slicing:** one PR per phase (UX-D1 smallest; UX-D4 largest).

---

## Phase contracts

### UX-D0 contract

- ADR file at `docs/adr/ADR-003-trading-room-density-and-sleek-ux.md`.
- BACKLOG section **ADR-003** with phase table.
- Note in ADR-002 UX-2 row: **superseded by ADR-003 UX-D1** (table removed from brief, not deleted from codebase until Scanner still uses presenters).

### UX-D1 contract

- **Remove** the bento tile `"Swing setups from market scan"` / `MarketSwingSetupsTable` from `market-brief.tsx`.
- **Keep:** `MarketSwingSetupsTable` component + `personal-ranked-home-present.ts` for Scanner or future surfaces; weekend `topSwingCard` prep tile; desk feed Swing lane; `onViewTopSetup` when `topCard` exists.
- **Remove** props wiring only where brief no longer needs ranked table (`swingSetups`, `nearQualification` on brief if unused).
- Tests: update any `market-brief` / personal-ranked-home tests that assert table in brief; add regression that table testid absent on brief.

### UX-D2 contract

- `DEFAULT_FEED_FILTERS.state` → `"actionable"` (or new composite default: actionable + near with UI label “Actionable desk”).
- Feed filter bar copy: “Showing actionable setups” vs total in desk.
- `cardFromMover` / mover ingestion: only when `deskEmpty && quietMode` (existing QuietFeed path), not mixed into default capped list.
- `FEED_STATE_CAPS.potential` → **2** (from 6); cooling hidden unless filter expanded.
- Session header desk counts (`actionable · near · potential`) use **unfiltered** desk totals or **actionable-only** — document choice in phase PR (prefer actionable + near for header to match user mental model).
- Tests: `feed-model.test.ts` for new defaults and mover exclusion.

### UX-D3 contract

- New brief mode flag or `<details>` “More market context” wrapping: movers, week ahead, outcomes, watchlist-at-close.
- Default viewport target: **≤ 1 screen** on 1440×900 without scroll for scan mode.
- No API changes.

### UX-D4 contract

- Sticky header survives scroll within center column.
- Plain summary + geometry strip visible without scrolling.
- Layers / Evolution / Chart / long context behind tabs or collapsed sections; user preference not persisted v1.
- Reuse existing panel components; no new composite API.
- Tests: deep-dive-present + component tests for tab default.

### UX-D5 contract

- Touch only `frontend/components/dashboard/trading-room/*` and shared `design-system` spacing tokens if needed.
- No change to P/L colors or lane accent hex values.

### UX-D6 contract

- Sector heat: 11 dashboard sector ETFs (`SECTOR_ROTATION_META`) minimum; holdings grid optional when ETF Global entitled (reuse sector panel fetch).
- Click hierarchy: heat cell = Level 2 (inline) or Level 1 (symbol → Deep Dive) — match `click-hierarchy.ts`.
- Performance: snapshot batch only; no new blocking RSC path.

### UX-D7 contract

- Rail default `open={false}` on desktop (mobile unchanged).
- Heat mode: equal or attention-weighted grid; max symbols = watchlist cap.
- List mode = current card UI.

### UX-D8 contract

- Assistant must not list symbols removed from UI (e.g. swing table rows).
- `discovery_expanded` / feed filter state reflected when user expands brief or changes feed filter.

---

## What we explicitly do **not** do

- Rebrand colors or light theme
- Remove Scanner swing setups column
- Remove desk feed column (only refine)
- Show full-market 500+ stock heat treemap on dashboard home
- Weaken geometry / execution-actionable gates to inflate actionable counts
- Change composite scoring to make more names “look actionable”

---

## Success metrics (personal validation)

| Metric | Target |
|--------|--------|
| Default desk feed visible cards | ≤ 8 combined (both lanes) on typical day |
| Duplicate symbol surfaces for same ticker | ≤ 2 (feed + watchlist OR feed + sector drill-down) |
| Time to first actionable click | User can reach Deep Dive from feed without scrolling past table |
| User-reported “too much content” | Qualitative — revisit after UX-D4 |

---

## References

- ADR-002 — [`ADR-002-personal-swing-first-product-ops.md`](./ADR-002-personal-swing-first-product-ops.md) (UX-2 superseded)
- Trading Room — [`DASHBOARD_TERMINAL_UX_PLAN.md`](../DASHBOARD_TERMINAL_UX_PLAN.md) §9
- Feed model — `frontend/lib/dashboard/trading-room/feed-model.ts`
- Market Brief — `frontend/components/dashboard/trading-room/market-brief.tsx`
- Deep Dive — `frontend/components/dashboard/trading-room/deep-dive.tsx`
- Design tokens — `frontend/lib/design-system.ts`
- Validation loop — [`VALIDATION_LOOP.md`](../VALIDATION_LOOP.md) (update when UX-D1 removes table from daily workflow)
