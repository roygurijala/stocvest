import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SignalsPageClient } from "@/components/signals-page-client";
import { SignalsPageShell } from "@/components/signals-page-shell";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { fetchDefaultWatchlistSnapshot } from "@/lib/api/watchlists";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { subscriptionAllowsDayTradingSurfaces } from "@/lib/subscription-access";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";
import {
  normalizeSignalsPrefillTicker,
  resolveSignalsUrlSymbol
} from "@/lib/signals-url-prefill";

/**
 * `/dashboard/signals` — server component.
 *
 * Tier 1.B (see `docs/PERFORMANCE.md` §1 layer 3 + §4 + §5).
 *
 * Pre-Tier-1.B this file `await`-ed
 * `Promise.all([fetchPdtStatus, fetchMarketOverview, fetchScannerOverview])`
 * and THEN `await fetchEarningsCalendar(symbols, …)` before
 * returning ANY JSX. Net effect: the browser saw nothing — no nav,
 * no chrome, no skeleton — until the slowest dependency resolved.
 * With the Tier 1.A `<Link prefetch={false}>` change, the cost of
 * **getting** to this page dropped dramatically, but the page's
 * own load-time floor still felt like a freeze when a user clicked
 * a ribbon chip.
 *
 * Tier 1.B splits the page into two server components:
 *
 *   1. **`DashboardSignalsPage`** (this default export) — does only
 *      the cheap work: auth + URL-param parsing + redirect-on-no-
 *      session. Renders the `AppShell` chrome immediately and a
 *      `<Suspense fallback={<SignalsPageShell />}>` boundary that
 *      holds the slot for the data-bound region. This part of the
 *      tree streams to the browser inside the first response
 *      flush, so the user sees the sidebar, top nav, and a
 *      familiar-shaped skeleton in < 200ms.
 *
 *   2. **`<SignalsPageData />`** — an async server child that owns
 *      the four heavy fetches plus the optional `signal_id ->
 *      symbol` resolution. While its promise is pending React
 *      keeps the Suspense fallback on screen; once it resolves the
 *      DOM swaps the skeleton for the live `<SignalsPageClient />`
 *      with all data populated.
 *
 * Why nest the async child inside the page instead of in
 * `<Suspense>` at the layout level: the page owns the URL-param
 * contract and the auth check. Pushing those into a layout would
 * mean every dashboard route re-parses signals-specific params.
 * The auth check is also bound to a redirect that must execute
 * BEFORE any rendering happens — putting it inside Suspense would
 * make the redirect race the fallback render. Keep auth + URL
 * parsing in the outer shell, push everything else inside the
 * boundary.
 *
 * Pairing file: `app/dashboard/signals/loading.tsx` re-renders the
 * same `<SignalsPageShell />` during the inter-route transition
 * (e.g. when a user clicks a ribbon chip on `/dashboard`) so the
 * navigation feels instant rather than freezing on the previous
 * page.
 */

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Resolve ticker from user's evaluated signal (`?signal_id=` deep-links). */
async function symbolFromUserSignalRecord(signalId: string): Promise<string | null> {
  const id = encodeURIComponent(signalId.trim());
  if (!id) return null;
  const res = await stocvestAuthedFetch(`/v1/signals/me/records/${id}`, { method: "GET" });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { symbol?: unknown } | null;
  if (!body || typeof body !== "object") return null;
  const sym = body.symbol;
  return typeof sym === "string" ? normalizeSignalsPrefillTicker(sym) : null;
}

export default async function DashboardSignalsPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const refRaw = firstParam(searchParams.ref) ?? "";
  const symRaw = firstParam(searchParams.symbol) ?? "";
  const urlSymbol = resolveSignalsUrlSymbol(symRaw, refRaw);

  const signalIdRaw = (firstParam(searchParams.signal_id) ?? "").trim();

  // Mode Separation safety perimeter (assistant_prompts.py): the
  // Signals page operates in exactly one mode at a time, and
  // `trading_mode=swing|day` in the URL must be the authoritative
  // source. Deep links from scanner / validation / watchlist
  // propagate this so the user lands in the engine they came
  // from, not whatever was last in localStorage. Invalid /
  // missing values fall through to the client's existing
  // localStorage default of "swing".
  const tradingModeRaw = (firstParam(searchParams.trading_mode) ?? "").trim().toLowerCase();
  const initialTradingMode: "day" | "swing" | null =
    tradingModeRaw === "day" || tradingModeRaw === "swing" ? tradingModeRaw : null;

  return (
    <AppShell session={session} isAdmin={isAdmin} mainTopLayout="signals-flush">
      {/*
        Tier 1.B streaming Suspense island. The fallback shell
        (`<SignalsPageShell />`) renders inline as part of the
        first response flush — no data fetches required to paint
        it — so the user sees structure within the AppShell
        immediately. `<SignalsPageData />` is an async server
        component; React holds the fallback on screen until its
        promise resolves, then swaps in the live client tree.

        Note for future maintainers: this Suspense boundary is the
        anchor for any future streaming-island work on this page
        (per PERFORMANCE.md §1 layer 3). If you split
        `<SignalsPageData />` further into multiple parallel
        async children, wrap EACH new child in its own Suspense
        boundary so a slow side-fetch (e.g. earnings) doesn't
        block the rest of the page from streaming in.
      */}
      <Suspense fallback={<SignalsPageShell />}>
        <SignalsPageData
          urlSymbol={urlSymbol}
          signalIdRaw={signalIdRaw}
          initialTradingMode={initialTradingMode}
        />
      </Suspense>
    </AppShell>
  );
}

/**
 * Async server child that owns the heavy data fetching for the
 * signals page. Keep this function focused: every additional
 * `await` here adds latency to the Suspense boundary. New side-
 * data (e.g. macro context, sector rotation) should be lifted
 * into its OWN async child with its OWN Suspense boundary so it
 * doesn't gate the primary scanner/market/earnings render.
 */
async function SignalsPageData({
  urlSymbol,
  signalIdRaw,
  initialTradingMode
}: {
  urlSymbol: string | null;
  signalIdRaw: string;
  initialTradingMode: "day" | "swing" | null;
}) {
  // Resolve `?signal_id=` -> symbol inside the Suspense boundary
  // so the page chrome paints regardless of whether the deep-link
  // requires a database round-trip. Pre-Tier-1.B this lived in
  // the outer page render and contributed to the blank-screen
  // window every time a journal / validation deep-link arrived.
  let resolvedUrlSymbol = urlSymbol;
  if (!resolvedUrlSymbol && signalIdRaw) {
    resolvedUrlSymbol = await symbolFromUserSignalRecord(signalIdRaw);
  }

  // Three independent reads — `Promise.all` keeps them parallel.
  // PDT status is fire-and-forget (catch -> null) because a PDT
  // miss must not block the signals page render. Market overview
  // and scanner overview are required.
  const [pdtStatus, marketOverview, scannerOverview, me, watchlistSnap] = await Promise.all([
    fetchPdtStatus().catch(() => null),
    fetchMarketOverview(undefined, { sparklineBarLimit: 12 }),
    fetchScannerOverview(null, [], { loadTuning: { signalsPageMinimal: true } }),
    fetchDashboardUserMe(),
    fetchDefaultWatchlistSnapshot().catch(() => ({ symbols: [], symbol_tracking: {} }))
  ]);

  const plan = subscriptionPlanFromMe(me);
  const dayTradingSurfaces = subscriptionAllowsDayTradingSurfaces(plan, me?.has_full_access === true);
  const coercedInitialTradingMode =
    !dayTradingSurfaces && initialTradingMode === "day" ? "swing" : initialTradingMode;

  void pdtStatus; // PDT data threads through the AppShell, not the signals page client.

  return (
    <SignalsPageClient
      marketOverview={marketOverview}
      scannerOverview={scannerOverview}
      defaultWatchlistSymbols={watchlistSnap.symbols}
      dayTradingSurfaces={dayTradingSurfaces}
      signalsPrefill={{
        urlSymbol: resolvedUrlSymbol,
        signalIdForResolve: signalIdRaw && !resolvedUrlSymbol ? signalIdRaw : null,
        hadSignalIdQuery: Boolean(signalIdRaw),
        initialTradingMode: coercedInitialTradingMode
      }}
    />
  );
}
