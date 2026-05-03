import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing-page";
import {
  FALLBACK_SIGNALS,
  fetchLandingPerformanceSummary,
  fetchLandingSignals
} from "@/lib/api/landing-signals";
import { getServerSession } from "@/lib/auth/session";

export default async function HomePage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }
  const [apiSignals, performanceSummary] = await Promise.all([
    fetchLandingSignals(),
    fetchLandingPerformanceSummary()
  ]);
  const usedApiFallback = apiSignals.length === 0;
  const explorerSignals = usedApiFallback ? FALLBACK_SIGNALS : apiSignals;
  return (
    <LandingPage
      explorerSignals={explorerSignals}
      activitySignals={apiSignals}
      usedApiFallback={usedApiFallback}
      performanceSummary={performanceSummary}
    />
  );
}
