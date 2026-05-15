import { fetchDashboardEarningsSlice } from "@/lib/dashboard/dashboard-page-data";
import { DashboardEarningsHydrate } from "@/components/dashboard/dashboard-earnings-hydrate";

/** RSC: earnings calendar — streams after market + daily slice (Tier 1.C). */
export async function DashboardEarningsDeferredFetch({ symbols }: { symbols: string[] }) {
  const { upcoming, recent } = await fetchDashboardEarningsSlice(symbols);
  return <DashboardEarningsHydrate upcoming={upcoming} recent={recent} />;
}
