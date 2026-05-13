# STOCVEST — Performance plan & architecture target

**Use with [`CONTEXT.md`](./CONTEXT.md) (current state, ops, test baselines), [`BACKLOG.md`](./BACKLOG.md) (planned work), and [`IMPLEMENTED.md`](./IMPLEMENTED.md) (shipped work archive).**

This file is the **single source of truth** for the long-term performance & responsiveness story of STOCVEST. Any PR that touches latency, payload size, prefetching, caching, streaming SSR, edge caching, or push transport must reference (and update) this doc.

**Last updated:** 2026-05-13 — Tier 1.A shipped: dashboard `<Link>` prefetch storm killed (ribbon chips, day-desk top-signal rows, day / swing scanner footers), removing 5–10 parallel SSR prefetches of `/dashboard/signals` per dashboard mount. Direct cause of the 16.78s "Content Download" the user observed on `/dashboard` (DevTools Network screenshot, 2026-05-13). Same change does not affect navigation behaviour: clicking a chip still routes normally, just without the speculative prefetch fire-and-drain pattern.

---

## 0. Why this file exists

STOCVEST is a real-time trading-decision UI. Latency is product. A 16-second dashboard load isn't a "perf nit" — it erodes trust in the engine. The data we ship is correct; the way we **serve and render** it has not kept pace with the feature work. This doc captures the **layered architecture** every serious financial UI converges on, the **order we should build it in**, and the **invariants** every PR must respect so we don't regress.

This is **not** a generic perf checklist. The items here are picked specifically for our stack:

- Next.js 14.2 App Router (RSC, streaming SSR, `<Link>` prefetch)
- AWS API Gateway HTTP API + Lambda + DynamoDB + Cognito JWT
- Frontend hosted via Next.js node server behind ALB / CloudFront (verify on each environment — see §5)

---

## 1. The five-layer target architecture

Top-to-bottom, the layered model every serious trading UI converges on. We are at the top of the ladder today (no layers in place). Each layer is **independently shippable** and additive — none of them require ripping out earlier work.

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
**Today:** `/dashboard/signals/page.tsx` does `await Promise.all([fetchPdtStatus(), fetchMarketOverview(), fetchScannerOverview()])` and then `await fetchEarningsCalendar(...)` before rendering **anything**. The browser sees a blank screen until the slowest dependency resolves.

**Target:** Render the page **shell** in <100ms. Each panel (market header, scanner panel, top setup, earnings) lives behind its own `<Suspense fallback={<Skeleton />}>` and streams in independently. A slow earnings call no longer blocks the chart.

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

## 2. Sequencing — concrete and dated

The order is chosen to **compound** — each layer makes the next one cheaper or unnecessary.

| When | What | Why this order |
|---|---|---|
| **Done — 2026-05-13** | **Tier 1.A** (this PR): kill the dashboard `<Link>` prefetch storm — ribbon chips, day-desk top-signal rows, day / swing scanner footers all carry `prefetch={false}`. | Surgical, ~2h, no infra change. Captures 70–90% of dashboard time-to-quiet without touching any data path. |
| **Next 1–2 weeks** | **Tier 1.B** (separate PR): wrap `/dashboard/signals/page.tsx` heavy fetches in `<Suspense>` boundaries; split `SignalsPageClient` into 3–4 island components that each take only their slice of data. Pre-req: small refactor of the props contract so each island can render independently. | Pure refactor, no new infra. Makes every future page feel fast by default. Captures the remaining 5–10% of dashboard load and unblocks the same pattern on `/dashboard/scanner` and `/dashboard/performance`. |
| **Following week** | **Layer 4** (SWR / TanStack Query): pick one, wire it for `/v1/signals/composite/{mode}` + `/v1/scanner/overview` + `/v1/market/overview`. Hover-only prefetch on the dashboard. | Locks in the snappiness from layer 3. Avoids the prefetch problem ever returning. |
| **Following 2 weeks** | **Layer 2** (thin API projections): add `?view=summary` to the high-traffic list endpoints (scanner, signals, watchlist). Update the ribbon, chips, and table rows to consume the slim variant. | Easier to do **after** the frontend is well-factored because by then we know exactly which fields each surface actually needs. |
| **Following month** | **Layer 1** (CloudFront edge cache): cache VIX, regime, breadth, sector heatmap, macro context with 10–30s TTL. | Ops-level work — needs distribution config + cache-key discipline. Big cost win once we have meaningful traffic. |
| **Quarter 2 (post-B5 launch)** | **Layer 5** (WebSocket push): live regime + active-signal deltas. | Only after the product has retained users who lean on it during market hours. Polling is fine and 10× cheaper until then. |

---

## 3. Invariants (every perf PR must respect)

These are non-negotiable. Any PR that violates one of these must be rejected even if it improves a metric.

1. **No `<Link prefetch={true}>` to a heavy SSR page from a high-card-count container** (ribbon, table, scanner grid). Heavy SSR pages are: `/dashboard/signals`, `/dashboard/scanner`, `/dashboard/performance`, `/dashboard/signal-validation`, `/dashboard/journal`, `/dashboard/portfolio`. Top-bar nav and other 1-of-N targets may use the Next default — they're fine.

2. **No mixing user-identified data into a cache key that is also used for unauthenticated paths.** Edge-cached endpoints (Layer 1) are user-agnostic or they don't get cached.

3. **No fan-out from a single page to N parallel heavy fetches.** Use `Promise.all` for parallelism, but the *count* of parallel heavy backend calls per page render must stay ≤ 4. The data load belongs in one place; everything else reads from that or streams in via Suspense.

4. **No new "Get all" endpoint that returns the full payload when a list view only needs a row's worth of fields.** If you find yourself shipping > 500 bytes/row for a ribbon or table, you owe a `?view=summary` projection.

5. **Chatbot context publishing must not break under streaming SSR.** The assistant's `usePublishAssistantContext` payload is part of the safety perimeter. If a page is refactored into islands, the chatbot context publisher MUST receive the full, settled payload — not an island-level slice. Tests in `dashboard-hero-strip.test.tsx` and `dashboard-redesign-phase-b-c.test.tsx` lock this in.

6. **Mode Separation must survive any refactor.** Day-side surfaces only consume day-side data; swing-side only consumes swing-side data. The streaming-island refactor (Tier 1.B) is the easiest place to accidentally cross-pollinate — lock-in tests in `dashboard-two-desk.test.tsx` and the desk-vocabulary anti-leak tests guard this.

7. **Mobile-first.** Every perf change must hold up on a mid-tier mobile device on a 4G connection. The hero strip, ribbon, and desks were designed to degrade gracefully (vertical stack, larger tap targets, no horizontal scroll outside the ribbon). New components inherit the same constraint.

---

## 4. Tier 1.A — what shipped today (2026-05-13)

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

## 5. Measurement & verification

We don't ship perf changes blind. Every Tier-N PR must include:

1. **Network panel screenshot before / after** showing the request count and the longest "Content Download" time on the page being optimized.
2. **A note on Tier 1.A's residual** — once Tier 1.A is in, the dominant remaining cost is the in-page data load itself. That's what Tier 1.B (streaming Suspense islands) attacks.
3. **A confirmation that gzip/brotli compression is on** for the path being optimized:
   - Next.js Node server: ON by default for `Content-Encoding: gzip` on responses ≥ 1KB. Vercel and most reverse proxies also brotli.
   - API Gateway HTTP API: compression is opt-in via the integration; check `infra/apigateway_6e.tf` and verify `aws apigatewayv2 get-api --api-id <id>` reports a non-zero `MinimumCompressionSize` if you've set one. Today our API Gateway is **not** configured for response compression; raw JSON goes over the wire. **Backlog row in `BACKLOG.md` covers turning this on.**

---

## 6. Cross-references

- **Backlog rows for Tier 1.B → Tier 5:** `BACKLOG.md` (D11 perf row).
- **Shipped work archive:** `IMPLEMENTED.md` (Tier 1.A will move here once the doc settles).
- **Architectural context:** `CONTEXT.md` §1 (current state) and §3 (near-term ops).
- **Assistant safety perimeter (chatbot context publishing must survive streaming refactor):** `ASSISTANT_SYSTEM_PROMPT` + the published-context tests in `dashboard-hero-strip.test.tsx`.
- **Mode Separation invariant:** `dashboard-two-desk.test.tsx` + the vocabulary anti-leak tests.
