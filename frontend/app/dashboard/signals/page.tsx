import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SignalsPageClient } from "@/components/signals-page-client";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { fetchEarningsCalendar } from "@/lib/api/earnings";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

const CONTEXTUAL_SIGNALS_REFS = new Set(["scanner", "watchlist", "validation", "journal"]);

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function normalizePrefillTicker(sym: string): string | null {
  const u = sym.trim().toUpperCase();
  if (!u) return null;
  if (/^[A-Z]{1,6}$/.test(u)) return u;
  if (/^[A-Z]{1,5}\.[A-Z]$/.test(u)) return u;
  return null;
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
  return typeof sym === "string" ? normalizePrefillTicker(sym) : null;
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
  const refRaw = (firstParam(searchParams.ref) ?? "").trim().toLowerCase();
  const symRaw = (firstParam(searchParams.symbol) ?? "").trim().toUpperCase();
  let urlSymbol =
    symRaw && CONTEXTUAL_SIGNALS_REFS.has(refRaw) ? normalizePrefillTicker(symRaw) : null;

  const signalIdRaw = (firstParam(searchParams.signal_id) ?? "").trim();
  if (!urlSymbol && signalIdRaw) {
    urlSymbol = await symbolFromUserSignalRecord(signalIdRaw);
  }

  // Mode Separation safety perimeter (assistant_prompts.py): the Signals page
  // operates in exactly one mode at a time, and `trading_mode=swing|day` in the
  // URL must be the authoritative source. Deep links from scanner / validation
  // / watchlist propagate this so the user lands in the engine they came from,
  // not whatever was last in localStorage. Invalid/missing values fall through
  // to the client's existing localStorage default of "swing".
  const tradingModeRaw = (firstParam(searchParams.trading_mode) ?? "").trim().toLowerCase();
  const initialTradingMode: "day" | "swing" | null =
    tradingModeRaw === "day" || tradingModeRaw === "swing" ? tradingModeRaw : null;

  const [pdtStatus, marketOverview, scannerOverview] = await Promise.all([
    fetchPdtStatus().catch(() => null),
    fetchMarketOverview(undefined, { sparklineBarLimit: 12 }),
    fetchScannerOverview(null, [], { loadTuning: { parallelDefaultWatchlist: true } })
  ]);
  const symbols = Array.from(new Set(scannerOverview.setups.map((s) => s.symbol)));
  const earnings = await fetchEarningsCalendar(symbols, 3);
  const earningsBySymbol = Object.fromEntries([...earnings.upcoming, ...earnings.recent].map((e) => [e.symbol.toUpperCase(), e]));

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <SignalsPageClient
        marketOverview={marketOverview}
        scannerOverview={scannerOverview}
        earningsBySymbol={earningsBySymbol}
        signalsPrefill={{
          urlSymbol,
          signalIdForResolve: signalIdRaw && !urlSymbol ? signalIdRaw : null,
          hadSignalIdQuery: Boolean(signalIdRaw),
          initialTradingMode
        }}
      />
    </AppShell>
  );
}
