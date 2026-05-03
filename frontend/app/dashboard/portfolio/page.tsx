import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { PortfolioOrderPrefill } from "@/components/order-entry-panel";
import { PortfolioPageClient } from "@/components/portfolio-page-client";
import { fetchAllBrokerOverviews } from "@/lib/api/brokers";
import { fetchPortfolioOverview } from "@/lib/api/portfolio";
import { fetchEarningsCalendar } from "@/lib/api/earnings";
import { getServerSession } from "@/lib/auth/session";

function pickQuery(
  sp: Record<string, string | string[] | undefined> | undefined,
  key: string
): string | undefined {
  if (!sp) return undefined;
  const v = sp[key];
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x : undefined;
}

function parseOrderFromSignal(
  sp: Record<string, string | string[] | undefined> | undefined
): PortfolioOrderPrefill | null {
  const sym = pickQuery(sp, "symbol")?.trim().toUpperCase();
  if (!sym) return null;
  const sideRaw = pickQuery(sp, "side");
  const side = sideRaw?.toLowerCase() === "sell" ? "sell" : "buy";
  const strengthRaw = pickQuery(sp, "signal_strength");
  const confluenceRaw = pickQuery(sp, "confluence_score");
  const strength = strengthRaw != null && strengthRaw !== "" ? Number(strengthRaw) : undefined;
  const confluence = confluenceRaw != null && confluenceRaw !== "" ? Number(confluenceRaw) : undefined;
  return {
    symbol: sym,
    side,
    signal_id: pickQuery(sp, "signal_id"),
    signal_strength: typeof strength === "number" && Number.isFinite(strength) ? strength : undefined,
    confluence_score: typeof confluence === "number" && Number.isFinite(confluence) ? confluence : undefined,
    pattern: pickQuery(sp, "pattern"),
    signal_direction: pickQuery(sp, "signal_direction")
  };
}

export default async function DashboardPortfolioPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const orderFromSignal = parseOrderFromSignal(searchParams);
  const brokerOverviews = await fetchAllBrokerOverviews();
  const overview = await fetchPortfolioOverview(brokerOverviews);
  const symbols = Array.from(
    new Set(
      brokerOverviews.flatMap((b) =>
        Object.values(b.positionsByAccount).flatMap((rows) => rows.map((r) => r.symbol))
      )
    )
  );
  const earnings = await fetchEarningsCalendar(symbols, 2);
  const earningsBySymbol = Object.fromEntries([...earnings.upcoming, ...earnings.recent].map((e) => [e.symbol.toUpperCase(), e]));
  return (
    <AppShell session={session}>
      <PortfolioPageClient
        brokerOverviews={brokerOverviews}
        overview={overview}
        earningsBySymbol={earningsBySymbol}
        orderFromSignal={orderFromSignal}
      />
    </AppShell>
  );
}
