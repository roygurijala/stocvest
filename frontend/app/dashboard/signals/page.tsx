import { redirect } from "next/navigation";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { legacySignalsRedirectHref } from "@/lib/nav/dashboard-trading-room-deeplink";
import {
  normalizeSignalsPrefillTicker,
  resolveSignalsUrlSymbol
} from "@/lib/signals-url-prefill";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

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

/**
 * Legacy `/dashboard/signals` — permanently redirects to Trading Room deep-dive.
 */
export default async function DashboardSignalsRedirectPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { session } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }

  const refRaw = firstParam(searchParams.ref) ?? "";
  const symRaw = firstParam(searchParams.symbol) ?? "";
  const tradingMode = firstParam(searchParams.trading_mode) ?? "";
  const signalIdRaw = (firstParam(searchParams.signal_id) ?? "").trim();

  let symbol = resolveSignalsUrlSymbol(symRaw, refRaw) ?? normalizeSignalsPrefillTicker(symRaw);
  if (!symbol && signalIdRaw) {
    symbol = await symbolFromUserSignalRecord(signalIdRaw);
  }

  redirect(
    legacySignalsRedirectHref({
      symbol,
      trading_mode: tradingMode,
      ref: refRaw
    })
  );
}
