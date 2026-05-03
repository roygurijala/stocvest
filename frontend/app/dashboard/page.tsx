import { Suspense } from "react";
import { redirect } from "next/navigation";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner";
import { DEFAULT_EARNINGS_SYMBOLS, fetchEarningsCalendar } from "@/lib/api/earnings";
import { getServerSession } from "@/lib/auth/session";
import { DashboardShell } from "@/components/dashboard-shell";
import { MorningBriefFromCore } from "@/components/morning-brief-from-core";

function MorningBriefSkeleton() {
  return (
    <article
      style={{
        border: "1px solid rgba(148,163,184,0.25)",
        borderRadius: 16,
        padding: 24,
        minHeight: 56,
        maxWidth: 900,
        background: "rgba(148,163,184,0.06)"
      }}
    >
      <style>{`@keyframes stocvest-skeleton { 0% { background-position: 0% 0; } 100% { background-position: 200% 0; } }`}</style>
      <div
        style={{
          height: 14,
          width: "42%",
          borderRadius: 6,
          background: "linear-gradient(90deg, rgba(148,163,184,0.12), rgba(148,163,184,0.22), rgba(148,163,184,0.12))",
          backgroundSize: "200% 100%",
          animation: "stocvest-skeleton 1.2s ease-in-out infinite"
        }}
      />
    </article>
  );
}

export default async function DashboardPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const [marketOverview, pdtStatus] = await Promise.all([
    fetchMarketOverview(),
    fetchPdtStatus().catch(() => null)
  ]);
  const [scannerCore, earnings] = await Promise.all([
    loadScannerDataWithoutBrief(pdtStatus),
    fetchEarningsCalendar(DEFAULT_EARNINGS_SYMBOLS, 7)
  ]);
  const scannerOverview = {
    gapIntelligence: scannerCore.gapIntelligence,
    setups: scannerCore.setups,
    morningBrief: undefined,
    error: scannerCore.error
  };
  const morningBriefSlot =
    !scannerCore.error ? (
      <Suspense fallback={<MorningBriefSkeleton />}>
        <MorningBriefFromCore core={scannerCore} pdtStatus={pdtStatus} />
      </Suspense>
    ) : null;

  return (
    <DashboardShell
      session={session}
      marketOverview={marketOverview}
      pdtStatus={pdtStatus}
      scannerOverview={scannerOverview}
      earningsEvents={earnings.upcoming}
      morningBriefSlot={morningBriefSlot}
    />
  );
}
