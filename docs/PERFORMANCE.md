# STOCVEST — Performance plan & architecture target

**Use with [`CONTEXT.md`](./CONTEXT.md) (current state, ops, test baselines), [`BACKLOG.md`](./BACKLOG.md) (planned work), [`IMPLEMENTED.md`](./IMPLEMENTED.md) (shipped work archive), and [`DASHBOARD_TERMINAL_UX_PLAN.md`](./DASHBOARD_TERMINAL_UX_PLAN.md) (dashboard IA + terminal-grade SLOs + click hierarchy).**

This file is the **single source of truth** for the long-term performance & responsiveness story of STOCVEST. Any PR that touches latency, payload size, prefetching, caching, streaming SSR, edge caching, or push transport must reference (and update) this doc.

**Last updated:** 2026-05-15 — **Tier 1.C Phase 0–5** shipped (timing, deferred scanner, **`GET /v1/dashboard/summary`**, dashboard IA, assistant `dashboard_context` v1, load/chaos lock-ins + SLO table below). Tier 1.A, Tier 1.B, and Layer 4 slices unchanged. **Optional next:** hero vs desks visual islands — see [`DASHBOARD_TERMINAL_UX_PLAN.md`](./DASHBOARD_TERMINAL_UX_PLAN.md). Tier 1.A killed the dashboard `<Link>` prefetch storm (ribbon chips, day-desk top-signal rows, day / swing scanner footers all carry `prefetch={false}`), removing 5–10 parallel SSR prefetches of `/dashboard/signals` per dashboard mount — the direct cause of the 16.78s "Content Download" the user observed on `/dashboard` (DevTools Network screenshot, 2026-05-13). Tier 1.B split `/dashboard/signals/page.tsx` into a fast shell + async data island wrapped in `<Suspense fallback={<SignalsPageShell />}>` (plus the matching `loading.tsx` for inter-route transitions) so the user sees the page chrome + skeleton within ~200ms of clicking a ribbon chip instead of staring at a blank screen while four backend reads serialise. Layer 4 added **SWR** (chosen over TanStack Query — smaller, simpler, Vercel-native) with conservative app-wide defaults (`revalidateOnFocus: false`, `dedupingInterval: 30s`, `errorRetryCount: 1`, `keepPreviousData: true`, never-retry on 401), wrapped the highest-traffic symbol-keyed read (`useSymbolSnapshot`) so symbol-switching is now stale-while-revalidate instead of a fresh round-trip every time, and wired **intent-driven hover-prefetch** onto every heavy-target dashboard `<Link>` (ribbon chips, ribbon empty-state CTA, day-desk rows, day-desk footer, swing-desk footer) — preserving the Tier 1.A no-mount-prefetch invariant while warming the route the moment the user's cursor / focus / pointer-down arrives. Together these changes turn the worst-case dashboard → signals navigation from a 16-second freeze into a sub-second perceived load with the live content streaming in as it resolves, and make repeat symbol views inside the signals page feel instant.

---

## 0. Why this file exists

STOCVEST is a real-time trading-decision UI. Latency is product. A 16-second dashboard load isn't a "perf nit" — it erodes trust in the engine. The data we ship is correct; the way we **serve and render** it has not kept pace with the feature work. This doc captures the **layered architecture** every serious financial UI converges on, the **order we should build it in**, and the **invariants** every PR must respect so we don't regress.

This is **not** a generic perf checklist. The items here are picked specifically for our stack:

- Next.js 14.2 App Router (RSC, streaming SSR, `<Link>` prefetch)
- AWS API Gateway HTTP API + Lambda + DynamoDB + Cognito JWT
- Frontend hosted via Next.js node server behind ALB / CloudFront (verify on each environment — see §5)

---

## 1. Dashboard terminal SLOs (Tier 1.C Phase 5)

**Code:** `frontend/lib/dashboard/dashboard-slo.ts` (targets + helpers), `dashboard-fetch-resilience.ts` (`timeoutFallback`), fetch budgets in `dashboard-page-data.ts`. **Lock-in:** `tests/dashboard-load-chaos.test.ts`, `tests/dashboard-degraded-shell.test.tsx`.

### Product targets (draft — tune with production `[dashboard-load]` samples)

| Milestone | Target (warm, P75) | How we measure |
|-----------|---------------------|----------------|
| First contentful dashboard | **< 2s** | `dashboard_summary` phase duration when aggregate API is deployed; first RSC segment returns tape + weekly rows. |
| Scanner + desks usable | **< 8s** | `scanner_core` phase + client hydrate; ribbon chips / desk rows populated. |
| Hard ceiling (degraded) | **< 15s** | End-to-end until partial UI + explicit error copy — never a silent 30s+ blank. |

### Measured baselines (2026-05-15)

| Environment | First segment (`dashboard_summary`) | Scanner (`scanner_core`) | Notes |
|-------------|-------------------------------------|--------------------------|--------|
| **Local dev** (Vitest chaos suite) | Fallback path verified at **58s** server timeout budget | Same **58s** budget → `"Scanner timed out."` fallback | Not a latency benchmark — proves soft-failure wiring. |
| **Production** | *Pending* — collect after `terraform apply` for `/v1/dashboard/summary` | *Pending* | Enable timing via **`/dashboard/admin/dashboard-timing`** (Redis + admin group) or `STOCVEST_DASHBOARD_TIMING=1` on the Next server; grep `[dashboard-load]`. |

**How to collect**

1. **Enable timing** — in order of precedence: `STOCVEST_DASHBOARD_TIMING=0` forces **off**; `=1` forces **on**; otherwise **`/dashboard/admin/dashboard-timing`** can set a Redis-backed **On / Off / Default** when Upstash is configured; if unset, **development** is on and **production** is off. (`load-timing.ts`.)
2. **Generate traffic:** sign in and load `/dashboard` at least **5×** during US market hours (cold + warm mixes are fine).
3. **Export logs** from your host (Vercel *Logs*, CloudWatch for Lambda-only paths, or local terminal stdout).
4. **Parse and summarize:**

```bash
# From repo root (Node 22+ with --experimental-strip-types)
node --experimental-strip-types scripts/parse_dashboard_load_timing.ts path/to/logs.txt

# Or pipe
vercel logs <deployment-url> 2>&1 | node --experimental-strip-types scripts/parse_dashboard_load_timing.ts
```

PowerShell:

```powershell
Get-Content path\to\logs.txt | node --experimental-strip-types scripts/parse_dashboard_load_timing.ts
```

The script prints per-phase **min / p50 / p75 / p95 / max**, milestone proxies vs the 2s / 8s / 15s targets (`PASS`/`FAIL`), and a short markdown snippet to paste into the table below. Implementation: `frontend/lib/dashboard/parse-load-timing-logs.ts`; lock-in: `frontend/tests/parse-dashboard-load-timing.test.ts`; sample fixture: `frontend/tests/fixtures/dashboard-load-sample.log`.

**Admin UI:** **`/dashboard/admin/dashboard-timing`** (requires `signal-analytics-admin`): **Instrumentation** card sets Redis key `stocvest:admin:dashboard_timing_toggle` (`On` / `Off` / `Default`) when **`STOCVEST_DASHBOARD_TIMING` is not set** in Vercel env and Upstash **`UPSTASH_REDIS_*`** is configured. The report panel uses samples from list **`stocvest:admin:dashboard_load_timing`** (last 500 phase rows) while timing is **effectively** on.

### Server fetch budgets (defensive ceilings)

| Phase | Timeout (ms) | Fallback behavior |
|-------|-------------|-------------------|
| `dashboard_summary` / `market_overview` | 58_000 | Empty tape + `error: "Market data timed out."`; legacy parallel slice if summary null. |
| `daily_bar_closes` | 14_000 | Empty closes → neutral weekly/sector rows. |
| `earnings_calendar` | 5_000 | Empty calendar + `notice: "Earnings feed timed out."` (deferred leg only on legacy path). |
| `scanner_core` | 58_000 | `EMPTY_SCANNER_OVERVIEW` + `error: "Scanner timed out."` |

Per-fetch timeouts are **upper bounds** for hung upstreams; Tier 1.C streaming means users see the hero / shell before `scanner_core` resolves. The **15s product ceiling** applies to perceived end-to-end readiness, not each individual `timeoutFallback` ms value.

---

## 2. The five-layer target architecture

Top-to-bottom, the layered model every serious trading UI converges on. **Progress (2026-05-15):** Tier 1.A + Tier 1.B (signals shell), Layer 4 (SWR slices), and **Layer 3 `/dashboard` streaming (Tier 1.C Phase 0–1)** — first segment **market + daily**; **earnings** + **scanner** in nested `Suspense` — are **shipped**; see §2. **Still open:** Layer 3 **full per-panel** islanding on `/dashboard` (Tier 1.C Phase 2+), Layer 2 summary projections, Layer 1 edge cache, Layer 5 WebSocket. Each layer remains **independently shippable**.

### Layer 1 — Edge cache for user-agnostic market context (CloudFront / Vercel Edge)
**What it caches:** Market regime, VIX, breadth, sector heatmap, macro calendar — anything that is **identical for every logged-in user**.

**Why:** A 1.7s round-trip to Lambda becomes ~30ms at the edge. Offloads ~80% of read traffic. Cuts our Lambda bill significantly once we have meaningful concurrency.

**Cache key discipline:** Never include user identifiers in cache keys for these endpoints. The endpoint either is user-agnostic (cache it hard) or it isn't (don't cache it at all). Mixing is how you ship Bob's data to Alice.

**Lock-in:** Low. Pure ops config. Easy to swap providers.

### Layer 2 — Thin API projections (summary vs detail)
**The mistake to undo:** Shipping the full composite signal payload (all layers + evidence + history) just to draw a 32px ribbon chip.

**The discipline to add:** Every list endpoint exposes two projections, backed by the same compute, just narrower marshalling:

| Projection | Used by | Size target |
|---|---|---|
| `?view=summary` | ribbons, chips, table rows, scanner cards | < 500 bytes/row |
| `?view=detail` | signal detail page, evidence modal | full payload |

Typical impact: 80–95% reduction on list-endpoint bytes-over-wire. Bigger than gzip.

**Lock-in:** Medium. It's a contract change but additive (existing `detail` clients keep working; new `summary` callers opt in).

### Layer 3 — Streaming SSR with island Suspense (Next.js App Router)
**Today:** `/dashboard/signals/page.tsx` does `await Promise.all([fetchPdtStatus(), fetchMarketOverview(), fetchScannerOverview()])` and then `await fetchEarningsCalendar(...)` before rendering **anything**. The browser sees a blank screen until the slowest dependency resolves. **`/dashboard`** (`dashboard-page-content.tsx`) **now** streams **earnings** and **scanner** each inside nested `<Suspense>` after **`fetchDashboardMarketDailySlice`** (market + daily bars); hero / Shared Context / tape can paint before the earnings calendar and gap-intelligence + setups finish.

**Target:** Render the page **shell** in <100ms. Each panel (market header, scanner panel, top setup, earnings) lives behind its own `<Suspense fallback={<Skeleton />}>` and streams in independently. **`/dashboard`:** **market + daily** in the first RSC segment; **earnings** and **scanner** each in nested `Suspense` (Tier 1.C Phase 1+). Further splits (e.g. hero vs desks only) are Tier 1.C Phase 2+.

**Why this is the highest-leverage move:** Next.js App Router does all the heavy lifting. The refactor is mechanical — split the page into async server components, wrap each in `<Suspense>`. No infra change, no new library, no contract change.

**Lock-in:** Low. Pure refactor of existing pages.

### Layer 4 — Client-side stale-while-revalidate cache (SWR or TanStack Query)
**The UX promise:** Once a user has seen AAPL's composite signal, navigating back to it is **instant** with stale data while the network silently refreshes. This is why Robinhood / Public / Webull feel snappy on slow mobile networks.

**Pair with selective prefetch:** Only on hover/focus, never on mount of every visible `<Link>` (that's what produced our 16s dashboard). Tier 1.A enforces this.

**Lock-in:** Medium. Picking SWR vs TanStack Query is a one-time decision; both are fine. We will pick when we get to this layer.

### Layer 5 — WebSocket push for live state
**The "feels alive" layer.** Repolling VIX / regime / active signals during market hours is the wrong primitive. The right pattern: a single WebSocket carrying **deltas** (regime changes, new signal fires, market halts, your own signal status). The frontend renders from a local store, the network just corrects.

**This is what makes Bloomberg / IBKR / ThinkOrSwim feel like trading desks** and what makes Yahoo Finance feel like a consumer app.

**Infra:** AWS API Gateway WebSocket → Lambda fan-out → DynamoDB connection table → CloudWatch + alarms on connection-rate spikes.

**Lock-in:** High. Don't ship until layers 1–4 are in. Polling at our current scale is fine and 10× cheaper.

---

## 3. Sequencing — concrete and dated

The order is chosen to **compound** — each layer makes the next one cheaper or unnecessary.

| When | What | Why this order |
|---|---|---|
| **Done — 2026-05-13** | **Tier 1.A**: kill the dashboard `<Link>` prefetch storm — ribbon chips, day-desk top-signal rows, day / swing scanner footers all carry `prefetch={false}`. | Surgical, ~2h, no infra change. Captures 70–90% of dashboard time-to-quiet without touching any data path. |
| **Done — 2026-05-13** | **Tier 1.B**: split `/dashboard/signals/page.tsx` into a fast shell (auth + URL parsing) + async data island wrapped in `<Suspense fallback={<SignalsPageShell />}>`. Added `app/dashboard/signals/loading.tsx` rendering the same shell for inter-route transitions. `SignalsPageClient` itself was **not** refactored — the inner async server component (`SignalsPageData`) owns the four heavy fetches and renders the client tree once they all resolve. | Pure refactor, no new infra. Turns the worst-case freeze into a sub-second shell paint. The Suspense boundary is also the anchor for any future per-section island split (when we want earnings to stream independently of scanner). |
| **Done — 2026-05-13** | **Layer 4 (first slice)**: SWR added (`swr@^2.4.1`), global provider mounted in `app/layout.tsx`, app-wide defaults pinned in `lib/swr/config.ts`. Single SWR-backed hook shipped: `useSymbolSnapshot(symbol)` replaces the imperative `useEffect → fetchSymbolSnapshot` on `signals-page-client.tsx`, so symbol-switching is now stale-while-revalidate (instant render from cache on repeat, silent background refresh). New `useHoverPrefetch(href)` wired onto every Tier-1.A `<Link prefetch={false}>` (ribbon chips, ribbon empty-state CTA, day-desk rows, day-desk footer, swing-desk footer) so the route warms on hover / focus / pointer-down — never on mount. Tier 1.A invariant preserved (asserted by `dashboard-hover-prefetch.test.tsx`). See §4C for the full rationale. | Locks in the snappiness from layers 1.A + 1.B. Avoids the prefetch problem ever returning. |
| **Next** | **Tier 1.B+** (optional follow-up): split `SignalsPageData` into 2–3 parallel async children — e.g. `<MarketOverviewIsland />`, `<ScannerIsland />`, `<EarningsIsland />` — each in its OWN Suspense boundary so they paint independently. Requires refactoring `SignalsPageClient` into matching slice components. Real risk: medium. Skip unless a real user reports the current shell-then-everything-at-once swap feels janky. | The simpler Tier 1.B above captured most of the win. Per-section island split is a follow-up that pays off when individual fetches diverge dramatically in latency (e.g. earnings calendar gets very slow). |
| **Done — 2026-05-13** | **Layer 4 (second slice)**: SWR coverage extended to the dashboard's own data path (`useDashboardPayload` wraps `/api/dashboard?mode=...`; `useMacroContext` wraps `/api/market/macro-context`) and the signals page's composite + news fetches (`useSignalComposite` wraps `POST /api/stocvest/signals/composite/{swing\|real}`; `useSymbolNews` wraps `fetchSymbolNews`). The dashboard live-hint SSE stream (`useLiveSignals`) now invalidates the dashboard cache via `mutate(dashboardPayloadKey(mode))` instead of running a parallel polling closure — `/api/signals/live` itself stays as `EventSource` because it's a push channel, not GET-and-cache. The `useSignalComposite` hook overrides the global `keepPreviousData:true` default to `false` to preserve the user-requested "clear screen between mode pills" UX (lock-ins in `tests/signals-page-mode-clears-screen.test.tsx`). 23 new lock-in tests across `tests/use-signal-composite.test.tsx`, `tests/use-symbol-news.test.tsx`, `tests/use-dashboard-payload.test.tsx`, `tests/use-macro-context.test.tsx`. The mode-clears-screen test got a targeted infra fix: it now wraps each render in a fresh `<SWRConfig provider={() => new Map()} dedupingInterval={0}>` so SWR cache state does NOT leak between tests — the clear-screen rule applies to UNCACHED flips; cached flips are instant (strictly better UX). | Closes the second-slice plan. The frequently-revisited render-state reads on the two heaviest-traffic surfaces (`/dashboard` and `/dashboard/signals`) now share dedupe + stale-while-revalidate semantics. Any future PR adding a fifth `useEffect → fetch` block on these surfaces should prefer a new SWR hook — patterns are now in-tree. |
| **Done — 2026-05-14 / 2026-05-15** | **Tier 1.C — `/dashboard` RSC streaming (Phase 0–2).** **Phase 0:** `load-timing.ts`. **Phase 1:** **scanner** in nested `<Suspense>` + hydrate. **Phase 2:** **`GET /v1/dashboard/summary`** — one Lambda call for tape + daily + earnings (`dashboard_summary.py`); frontend `fetchDashboardFirstSegment` with legacy fallback; earnings on first paint when aggregate succeeds. **Lock-in:** `dashboard-summary-api.test.ts`, deferred-hydrate tests, `test_dashboard_summary_handler_returns_aggregate_payload`. **Deploy note:** run **`terraform apply`** for the new API Gateway route. Plan: [`DASHBOARD_TERMINAL_UX_PLAN.md`](./DASHBOARD_TERMINAL_UX_PLAN.md). | First paint: one Next↔Lambda round-trip for market slice when summary is deployed; scanner still streams. |
| **Following 2 weeks** | **Layer 2** (thin API projections): add `?view=summary` to the high-traffic list endpoints (scanner, signals, watchlist). Update the ribbon, chips, and table rows to consume the slim variant. | Easier to do **after** the frontend is well-factored because by then we know exactly which fields each surface actually needs. |
| **Following month** | **Layer 1** (CloudFront edge cache): cache VIX, regime, breadth, sector heatmap, macro context with 10–30s TTL. | Ops-level work — needs distribution config + cache-key discipline. Big cost win once we have meaningful traffic. |
| **Quarter 2 (post-B5 launch)** | **Layer 5** (WebSocket push): live regime + active-signal deltas. | Only after the product has retained users who lean on it during market hours. Polling is fine and 10× cheaper until then. |

---

## 4. Invariants (every perf PR must respect)

These are non-negotiable. Any PR that violates one of these must be rejected even if it improves a metric.

1. **No `<Link prefetch={true}>` to a heavy SSR page from a high-card-count container** (ribbon, table, scanner setup rows linking to `/dashboard/signals`, validation-ledger symbol links, journal rows linking to `/dashboard/signals`, or similar N-of-N lists). Heavy SSR pages are: `/dashboard/signals`, `/dashboard/scanner`, `/dashboard/setup-outcomes`, `/dashboard/setup-evolution`, `/dashboard/journal`, `/dashboard/portfolio`. (`/dashboard/performance` and `/dashboard/signal-validation` redirect to setup-outcomes.) Top-bar nav and other 1-of-N targets may use the Next default — they're fine.

2. **No mixing user-identified data into a cache key that is also used for unauthenticated paths.** Edge-cached endpoints (Layer 1) are user-agnostic or they don't get cached.

3. **No fan-out from a single page to N parallel heavy fetches.** Use `Promise.all` for parallelism, but the *count* of parallel heavy backend calls per page render must stay ≤ 4. The data load belongs in one place; everything else reads from that or streams in via Suspense.

4. **No new "Get all" endpoint that returns the full payload when a list view only needs a row's worth of fields.** If you find yourself shipping > 500 bytes/row for a ribbon or table, you owe a `?view=summary` projection.

5. **Chatbot context publishing must not break under streaming SSR.** The assistant's `usePublishAssistantContext` payload is part of the safety perimeter. If a page is refactored into islands, the chatbot context publisher MUST receive the full, settled payload — not an island-level slice. Tests in `dashboard-hero-strip.test.tsx` and `dashboard-redesign-phase-b-c.test.tsx` lock this in.

6. **Mode Separation must survive any refactor.** Day-side surfaces only consume day-side data; swing-side only consumes swing-side data. The streaming-island refactor (Tier 1.B) is the easiest place to accidentally cross-pollinate — lock-in tests in `dashboard-two-desk.test.tsx` and the desk-vocabulary anti-leak tests guard this.

7. **Mobile-first.** Every perf change must hold up on a mid-tier mobile device on a 4G connection. The hero strip, ribbon, and desks were designed to degrade gracefully (vertical stack, larger tap targets, no horizontal scroll outside the ribbon). New components inherit the same constraint.

---

## 5. Tier 1.A — what shipped today (2026-05-13)

**Diagnosis:** DevTools Network panel on `/dashboard` showed `/dashboard/signals?symbol=AAPL&ref=dashboard-ribbon...` taking 16.78s end-to-end with **14.61s in Content Download** and only 1.71s in TTFB. That waveform — long content-download / short server-wait — is **not** a slow backend; it's a large RSC payload being **drained slowly** over a connection that is also serving 5–10 other parallel RSC prefetches.

**Root cause:** Every `<Link>` in the dashboard ribbon, day-desk top-signal rows, and desk footers omitted `prefetch={false}`. Next.js 14.2's `<Link>` defaults to `prefetch="auto"` for visible links, which means **every chip and every top-signal row fired an SSR prefetch on mount**. Each prefetch ran the full `app/dashboard/signals/page.tsx` data load (`fetchPdtStatus` + `fetchMarketOverview` + `fetchScannerOverview` + `fetchEarningsCalendar`), all in parallel. With 5 ribbon chips + 2 desk top-signal rows + 2 scanner footers, the dashboard was kicking off ~9 heavy SSR renders in parallel just to warm the prefetch cache for pages nobody had asked for.

**Fix:** `prefetch={false}` on every dashboard `<Link>` that points to a heavy SSR page. Specifically:

- `frontend/components/dashboard-active-signal-ribbon.tsx` — ribbon "View Scanner" CTA + every ribbon chip `<Link>` to `/dashboard/signals?symbol=...`.
- `frontend/components/day-desk-panel.tsx` — every day-row `<Link>` to `/dashboard/signals?symbol=...&trading_mode=day`, plus the desk footer `<Link>` to `/dashboard/scanner?mode=day`.
- `frontend/components/dashboard-redesign.tsx` — swing-desk footer `<Link>` to `/dashboard/scanner?mode=swing`.

**Expected impact:** Dashboard time-to-quiet drops from ~16s on a warm cache to <2s. Network panel should show only the API calls actually needed for the dashboard (`/api/dashboard?mode=swing`, `/api/dashboard?mode=day`, `/api/macro-context`, `/api/live?mode=day`) — no speculative RSC fetches to `/dashboard/signals`.

**What did NOT change:**
- Navigation behaviour. Clicking a chip still routes normally. The router cache still works once a target has been visited.
- The `fetchSignalComposite` API path. The signals page itself is unchanged; we only stopped speculatively prefetching it from the dashboard.
- Any `<Link>` outside the dashboard. The sidebar, top bar, and per-page nav links still use Next's default prefetch behaviour — they're 1-of-N targets, not N-of-N like the ribbon.

**Lock-in tests:**
- `frontend/tests/dashboard-prefetch.test.tsx` — asserts ribbon chips, day-desk signal rows, scanner footers all render `data-prefetch="false"` (Next.js's `<Link prefetch={false}>` surfaces this attribute in the DOM).
- Existing dashboard tests in `dashboard-redesign-phase-b-c.test.tsx`, `dashboard-swing-only.test.tsx`, `dashboard-scanner-mode-links.test.tsx`, and `dashboard-two-desk.test.tsx` continue to pass — the change is pure attribute, no semantics change.

---

## 5B. Tier 1.B — what shipped today (2026-05-13)

**Problem this layer attacks:** Once Tier 1.A killed the dashboard prefetch storm, the next bottleneck became the signals page's **own** load. `/dashboard/signals/page.tsx` server-side awaited four backend calls before rendering anything — `Promise.all([fetchPdtStatus, fetchMarketOverview, fetchScannerOverview])` then `await fetchEarningsCalendar(symbols, …)` sequentially. When a user clicked a ribbon chip, the browser saw the previous page's UI frozen until the slowest dependency resolved on the new page. That's a multi-second "did my click register?" UX even when each fetch is healthy.

**Fix:** Split the page into two server components:

1. **`DashboardSignalsPage`** (outer, fast) — does only the cheap work: `getDashboardAuthContext()` + URL-param parsing (`symbol`, `signal_id`, `trading_mode`) + redirect-on-no-session. Renders `<AppShell>` chrome immediately and a `<Suspense fallback={<SignalsPageShell />}>` boundary that holds the slot for the data-bound region. This part streams to the browser inside the first response flush.

2. **`SignalsPageData`** (inner, slow) — async server component that owns the four heavy fetches plus the optional `signal_id → symbol` resolution (`symbolFromUserSignalRecord`). While its promise is pending, React keeps the Suspense fallback on screen; once it resolves, the DOM swaps in `<SignalsPageClient />` with all data populated.

**Pairing file:** `app/dashboard/signals/loading.tsx` re-renders the same `<SignalsPageShell />` during the **inter-route** transition (e.g. when a user clicks a ribbon chip on `/dashboard`). Without that file, Next.js falls back to the previous page's UI during the transition, which is the worst-case for a slow target. Both files render the identical shell so the visual experience matches across both load windows (route transition → page-render Suspense → live swap).

**Why the inner component is `SignalsPageData` not 3–4 islands per section:** The simpler version captured most of the win and carries far less risk. `SignalsPageClient` is a single client component consuming `marketOverview` + `scannerOverview` + `earningsBySymbol` as one prop bundle. Splitting it into 3–4 client slices is a real refactor (medium risk, multi-day work) that pays off only when individual fetches diverge dramatically in latency. Today they all complete in roughly the same window, so the inner Suspense boundary swaps everything at once after the slowest fetch resolves. If a future user reports the swap feels janky, the Suspense boundary inside `SignalsPageData` is the anchor point: replace it with N parallel `<Suspense>` siblings, each rendering its own slice of the live data. PERFORMANCE.md §2 row "Next" tracks this as **Tier 1.B+**.

**Shell design (`components/signals-page-shell.tsx`):**

- **Server component.** No `"use client"`, no React hooks, no data fetches. Required so it can render in both the Suspense fallback path and the `loading.tsx` path before any client state exists.
- **DOM mirrors the live page.** `signals-grid` two-column breakpoints (`grid-cols-1` on mobile, `lg:grid-cols-[1.35fr_1fr]` on desktop) match the live `signals-page-client.tsx` layout so the swap from skeleton → live content lands in the same slots — no layout jump.
- **Two mode-tab placeholders** mirror the live `swing | day` pair but render neutral — the live page resolves the mode from `?trading_mode=` on hydration, and pre-committing here would flash the wrong active state.
- **Six layer-row placeholders** mirror the 6-layer Signal Breakdown card (the leftmost / tallest live element).
- **Three right-column context cards** named `news`, `earnings`, `after-hours` — same vertical stack as the live page.
- **`role="status"` + `aria-live="polite"`** with sr-only "Loading signal data…" so AT users hear that the navigation succeeded.
- **Reuses `stocvest-skeleton` keyframes** from `globals.css` (the existing shimmer used elsewhere for skeleton loaders). Honours `prefers-reduced-motion` via the existing media query.

**Expected impact:** Click a ribbon chip on `/dashboard` → see the AppShell + signals page shell within ~200ms (one server roundtrip to render the shell tree) instead of staying on the previous page's UI for 1–4 seconds. Once the data island resolves, the live content swaps in — no visual jump because the shell mirrors the layout.

**What did NOT change:**
- `SignalsPageClient` itself. Same props, same hooks, same chatbot context publishing, same Mode Separation perimeter.
- The data-fetching contract. `fetchPdtStatus` / `fetchMarketOverview` / `fetchScannerOverview` / `fetchEarningsCalendar` are called identically, just from inside the inner async server component.
- The auth perimeter. `getDashboardAuthContext()` + redirect-on-no-session still happen in the outer page function BEFORE any Suspense boundary, so an unauthenticated request never paints the shell.
- The signal-id deep-link resolution. `symbolFromUserSignalRecord` now lives inside `SignalsPageData` (so it doesn't block the shell), but the contract — "if `?signal_id=` is present and `?symbol=` is not, resolve via the user's evaluated signal record" — is preserved.

**Lock-in tests** (`frontend/tests/signals-page-streaming.test.tsx`, 12 tests):
- `SignalsPageShell` renders without throwing, exposes `data-shell-loading="true"`, has two mode-tab placeholders, mirrors the live `signals-grid` breakpoints, renders six layer-row placeholders + three named context cards (`news` / `earnings` / `after-hours`), and announces the loading state via `role="status"` + `aria-live="polite"`.
- `app/dashboard/signals/loading.tsx` default-export renders the same shell.
- **Source-level invariants on `page.tsx`** (the hard contract): imports `Suspense` from `react`, imports `SignalsPageShell`, contains the literal JSX `<Suspense fallback={<SignalsPageShell />}>`, and — critically — the four fetcher calls (`fetchMarketOverview`, `fetchScannerOverview`, `fetchEarningsCalendar`, `fetchPdtStatus`) appear in `SignalsPageData` and **not** in the outer `DashboardSignalsPage`. Verified by stripping block + line comments from the source then positionally splitting at the inner-function anchor. **The negative half is the important one**: a future refactor that moves any fetcher back to the outer function fails this test loud with a pointer at `docs/PERFORMANCE.md §4B`.

---

## 5C. Layer 4 (first slice) — what shipped today (2026-05-13)

**Problem this layer attacks:** Tier 1.A and 1.B made the **first** dashboard → signals navigation fast. Layer 4 makes **subsequent** navigations to the same data feel instant. Before this slice, switching from AAPL → NVDA → AAPL on the signals page meant three round trips, not two; the second AAPL view was an identical network call to the first because we had no client-side cache. Layer 4 fixes that with stale-while-revalidate caching, AND it adds the missing piece of the Tier 1.A story: links shouldn't prefetch on mount (Tier 1.A), but they SHOULD prefetch on **intent** (hover / focus / pointer-down).

**Library choice — SWR over TanStack Query:** Decided on **SWR**. Reasoning:

| Dimension | SWR | TanStack Query |
|---|---|---|
| Bundle size (gzipped) | ~5 KB | ~13 KB |
| API surface | tight (`useSWR`, `SWRConfig`, `mutate`) | broad (queries, mutations, optimistic, infinite, suspense) |
| Author | Vercel (same as Next.js) | TanStack |
| Layer 4 use case fit | Exact | Overkill |
| Future fit | Add later if needed | Could swap in if we add complex mutations / optimistic UX |

Our Layer 4 use case is pure GET-and-cache. We have no mutations, no optimistic updates, no infinite-scroll queries today. Picking SWR keeps the bundle small now; if we ever ship a feature that needs TanStack Query's heavier surface (e.g. complex paginated lists with optimistic insert), we can introduce it then for THAT surface without ripping out SWR for the rest. The two libraries co-exist fine.

**Global defaults (`lib/swr/config.ts`, locked in by `tests/swr-config.test.ts`):**

| Option | Value | Why |
|---|---|---|
| `revalidateOnFocus` | `false` | Our data isn't tick-by-tick. Refetching on every alt-tab burns API budget without adding signal. |
| `revalidateOnReconnect` | `true` | After a wifi blip ends, refetching cached views once is cheap and prevents acting on stale data. |
| `dedupingInterval` | `30_000` ms | 30s is the sweet spot — rapid clicks across the ribbon don't fan out to N calls for the same symbol; per-hook overrides for surfaces that need fresher reads. |
| `errorRetryCount` | `1` | Server-side our Lambdas are mostly stateless; a 5xx is usually a code issue, not a flake. Retrying 3+ times (SWR default) just makes the user wait longer. |
| `keepPreviousData` | `true` | Switching symbols keeps showing the previous symbol's snapshot until the new one resolves — no blank flash. Caller is responsible for not painting STALE data as if it were fresh. |
| `shouldRetryOnError` | predicate | Never retry on 401 (would re-fire `surfaceAuthErrorIfAny` and re-surface the session-expired banner — the exact UX bug fixed in the session-expiry PR). Retry on 5xx, 429, network errors. |

**Files added (all under `lib/swr/` + `lib/hooks/`):**

- **`lib/swr/config.ts`** — `STOCVEST_SWR_DEFAULTS` + `STOCVEST_SWR_CACHE_NS` ("stocvest:"). Pure module, no React. Importable from tests without React runtime.
- **`lib/swr/fetcher.ts`** — `swrFetcher` + `SwrFetcherError`. JSON fetcher that throws typed errors on non-2xx, includes credentials, fires `surfaceAuthErrorIfAny` on 401. The fetcher passed via `SWRConfig` for BFF endpoints I might add later; today's hooks wrap the existing `lib/api/*` fetchers (see next bullet).
- **`lib/swr/provider.tsx`** — `StocvestSwrProvider`, a `"use client"` wrapper around `<SWRConfig>` that pulls in defaults + fetcher. Mounted once in `app/layout.tsx` above every page.
- **`lib/hooks/use-symbol-snapshot.ts`** — `useSymbolSnapshot(symbol)`. Wraps the existing `fetchSymbolSnapshot` imperative call (which itself reads a non-HttpOnly WS token from `document.cookie` and adds a Bearer header — keeping that auth plumbing in one place was the reason to wrap rather than have SWR call the URL directly). Cache key: `["stocvest:symbol-snapshot", upperCaseSymbol]`. Empty / whitespace symbol → SWR skips (returns `{ snapshot: null }`). Preserves the upstream ticker-mismatch guard from the original effect.
- **`lib/hooks/use-hover-prefetch.ts`** — `useHoverPrefetch(href, options?)`. Returns `{ onMouseEnter, onFocus, onPointerDown }` handlers. Each handler calls `router.prefetch(href)` once per hook instance (re-hovering does NOT re-fire). Optional `router` override for tests; optional `enabled: false` to disable without changing call-site shape. Errors from `router.prefetch` are swallowed (best-effort).

**Files refactored:**

- **`app/layout.tsx`** — wrapped the app body in `<StocvestSwrProvider>` between `<ThemeProvider>` and the assistant/disclaimer tree.
- **`components/signals-page-client.tsx`** — dropped the `symbolSnapshot` useState + the `useEffect → fetchSymbolSnapshot` block. Replaced with `useSymbolSnapshot(symbolForSwr)` where `symbolForSwr` is `""` whenever the market overview already carries the snapshot for the current symbol (preserving the original short-circuit). The legacy import of `fetchSymbolSnapshot` stays — it's still used by the evidence-modal one-shot fetch.
- **`components/dashboard-active-signal-ribbon.tsx`** — extracted `<RibbonChip>` sub-component (so each chip can call `useHoverPrefetch(href)` inside without violating the Rules of Hooks across a `.map`). Both the chips AND the empty-state "Open scanner" CTA carry `data-prefetch="false"` (Tier 1.A) AND `data-hover-prefetch="true"` (Layer 4).
- **`components/day-desk-panel.tsx`** — added hover-prefetch to both the per-row "Open Day Signals →" links (inside `<DayTopSignalRow>`) and the desk footer "View day scanner →" link.
- **`components/dashboard-redesign.tsx`** — added hover-prefetch to the swing-desk footer "View swing scanner →" link and to the next-actions **Signals →** hub link (`/dashboard/signals`, no query).
- **`components/scanner-page-client.tsx`**, **`components/signal-validation-page-client.tsx`**, **`components/journal-page-client.tsx`** — N-of-N `<Link prefetch={false}>` targets to `/dashboard/signals` carry **`data-hover-prefetch="true"`** + per-row/per-setup **`useHoverPrefetch(href)`** (scanner **Open Signals**, validation ledger symbols, journal signal cells) so intent warms the route without mount prefetch.
- **`vitest.setup.ts`** — added a **default** `next/navigation` mock so every test that renders a dashboard subtree containing `useHoverPrefetch` works without needing its own `vi.mock(...)`. Tests that want richer router behaviour (assertions on `router.push(...)`, etc.) still declare their own `vi.mock("next/navigation", …)` at the top of the file — those declarations are hoisted by vitest and override this default. Six existing tests already follow that pattern; they continue to work unchanged.

**The Tier 1.A ↔ Layer 4 contract — both must hold simultaneously:**

Every heavy-target dashboard `<Link>` now carries BOTH attributes:

```html
<a href="/dashboard/signals?..." data-prefetch="false" data-hover-prefetch="true">
```

- `data-prefetch="false"` — Tier 1.A invariant. No speculative SSR prefetch on mount. Asserted by `dashboard-prefetch.test.tsx`.
- `data-hover-prefetch="true"` — Layer 4 marker. Route warms on intent only. Asserted by the NEW `dashboard-hover-prefetch.test.tsx`.

A future refactor that drops EITHER attribute breaks one of the two test suites. The pair lock prevents the silent "they both look the same — let me clean up by removing one" regression.

**Expected impact:**

- **Symbol re-views on the signals page**: instant render from cache on the second / third / N-th visit to the same ticker, with a silent background refresh after the 30s dedupe window. Network panel shows one `fetchSymbolSnapshot` for the first AAPL view, zero for the next view inside 30s.
- **Dashboard chip clicks**: the moment the user hovers a ribbon chip / focuses a day-desk row / points-down on a footer link, the target route starts fetching its RSC payload. By click-time (typically 150–400ms after hover) the payload is in flight or in cache, so the navigation feels significantly snappier without re-introducing the 16-second prefetch storm.

**What did NOT change:**

- Auth perimeter. The SWR fetcher uses `credentials: "include"` (HttpOnly session cookies) and never touches the Cognito JWT directly. `fetchSymbolSnapshot` still does its own non-HttpOnly WS-token-cookie read for the Bearer header.
- Mode Separation invariant. SWR cache keys are symbol-keyed; the snapshot is mode-agnostic. The trading-mode toggle continues to clear `compositeResult` etc. independently of the SWR cache.
- Chatbot context publishing. `usePublishAssistantContext` was untouched. The published payload still settles when the live data resolves.
- Click navigation behaviour. `router.prefetch` is a hint, not a redirect; clicking a link still routes normally even if prefetch failed.

**Lock-in tests** (`frontend/tests/`):

- `swr-config.test.ts` (10 tests) — every default value is pinned individually with a comment explaining why. The `shouldRetryOnError` predicate is tested against 401, 5xx, 4xx-non-401, and non-status errors.
- `swr-fetcher.test.ts` (7 tests) — 2xx parses JSON, non-2xx throws `SwrFetcherError` with status + body, 401 fires `surfaceAuthErrorIfAny`, 200 does not, 500 does not (only 401 triggers the banner), credentials + accept header always sent.
- `use-symbol-snapshot.test.tsx` (6 tests) — empty + whitespace symbol → no fetch; happy path returns snapshot; case + whitespace normalisation; ticker-mismatch guard returns `null` not stale data; dedupe window: two hooks for the same symbol → fetcher called exactly once.
- `use-hover-prefetch.test.tsx` (6 tests) — fires on first `onMouseEnter`, never re-fires; `onFocus` and `onPointerDown` are equivalent triggers; `null` / empty / undefined `href` are no-ops; `enabled: false` is a no-op; `router.prefetch` throwing is swallowed.
- `dashboard-hover-prefetch.test.tsx` (5 tests) — ribbon chip, ribbon empty-state CTA, day-desk per-row, day-desk footer, swing-desk footer ALL carry BOTH `data-prefetch="false"` AND `data-hover-prefetch="true"`. **This is the critical invariant for the Tier 1.A ↔ Layer 4 contract** — any future PR that drops either marker fails this test with a pointer at this doc.

**Second slice — shipped 2026-05-13:**

- `useSignalComposite(symbol, mode, { enabled })` — wraps the POST to `/api/stocvest/signals/composite/{swing|real}` with the `{ symbol }` body. Cache key `["stocvest:signal-composite", upperCaseSymbol, mode]` includes the mode so Mode Separation invariant #5 survives the cache layer. Overrides global `keepPreviousData:true` to `false` so the "clear screen between mode pills" UX (a prior user request) survives the cache layer — a fresh cache-key transition returns `composite:null` synchronously instead of carrying the previous mode's data on screen. The signals page's mode-toggle `updateTradingMode` callback no longer needs to imperatively `setCompositeResult(null)` / `setRadarData(null)`; the cache key change does that for us.
- `useSymbolNews(symbol, { limit, mode, enabled })` — wraps the existing `fetchSymbolNews`. Cache key `["stocvest:symbol-news", upperCaseSymbol, limit, mode]`. Errors collapse to `articles:[]` so the after-hours panel never shows a dangling spinner. Keeps the global `keepPreviousData:true` default. Used on the signals page's after-hours panel (gated on `showAfterHoursPanel`); the user-initiated download-evidence handler keeps the inline `fetchSymbolNews` call (single-shot, not a render-state read).
- `useDashboardPayload(mode, { refreshIntervalMs })` — wraps `fetchDashboardData`. Cache key `["stocvest:dashboard-payload", mode]`. Exposes `dashboardPayloadKey(mode)` so the live-hint SSE handler can `mutate(dashboardPayloadKey(mode))` instead of running a parallel polling closure. `refreshIntervalMs:60_000` matches the pre-Layer-4 `setInterval` cadence; SWR's `refreshInterval` pauses automatically when the tab is hidden.
- `useMacroContext()` — wraps `fetchMacroContext`. Cache key `["stocvest:macro-context"]` (no user-id segment — endpoint is user-agnostic; respects invariant #2). Replaces the one-shot mount-time `useEffect → fetchMacroContext()` in `dashboard-redesign.tsx`.
- Note on `/api/signals/live`: this is an SSE EventSource (push channel, not GET-and-cache) — `useLiveSignals` is unchanged. The "convert /api/live to SWR" line in the original D11 backlog row referred to the polling re-fetch that the SSE hint triggers; that now flows through `mutate(dashboardPayloadKey(mode))`.
- Lock-in tests: `tests/use-signal-composite.test.tsx` (7), `tests/use-symbol-news.test.tsx` (6), `tests/use-dashboard-payload.test.tsx` (5), `tests/use-macro-context.test.tsx` (5) — **23 new tests, all passing**. Existing tests on the refactored surface (signals-page-mode-clears-screen, signals-page-streaming, dashboard-cache, dashboard-prefetch, dashboard-hover-prefetch, use-symbol-snapshot) all green. The mode-clears-screen test got a targeted infra fix: each render now wraps in a fresh `<SWRConfig provider={() => new Map()} dedupingInterval={0}>` so SWR cache state does NOT leak between tests — the clear-screen rule applies to UNCACHED flips; a cached flip is instant (strictly better UX) and the test would otherwise oscillate based on prior-test side effects.

---

## 6. Measurement & verification

We don't ship perf changes blind. Every Tier-N PR must include:

1. **Network panel screenshot before / after** showing the request count and the longest "Content Download" time on the page being optimized.
2. **A note on Tier 1.A's residual** — once Tier 1.A is in, the dominant remaining cost is the in-page data load itself. That's what Tier 1.B (streaming Suspense islands) attacks.
3. **A confirmation that gzip/brotli compression is on** for the path being optimized:
   - Next.js Node server: ON by default for `Content-Encoding: gzip` on responses ≥ 1KB. Vercel and most reverse proxies also brotli.
   - API Gateway HTTP API: compression is opt-in via the integration; check `infra/apigateway_6e.tf` and verify `aws apigatewayv2 get-api --api-id <id>` reports a non-zero `MinimumCompressionSize` if you've set one. Today our API Gateway is **not** configured for response compression; raw JSON goes over the wire. **Backlog row in `BACKLOG.md` covers turning this on.**

---

## 7. Cross-references

- **Backlog rows for Tier 1.B → Tier 5:** `BACKLOG.md` (D11 perf row).
- **Shipped work archive:** `IMPLEMENTED.md` (Tier 1.A will move here once the doc settles).
- **Architectural context:** `CONTEXT.md` §1 (current state) and §3 (near-term ops).
- **Assistant safety perimeter (chatbot context publishing must survive streaming refactor):** `ASSISTANT_SYSTEM_PROMPT` + the published-context tests in `dashboard-hero-strip.test.tsx`.
- **Mode Separation invariant:** `dashboard-two-desk.test.tsx` + the vocabulary anti-leak tests.
