import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing-page";
import { SiteJsonLd } from "@/components/seo/site-json-ld";
import {
  FALLBACK_SIGNALS,
  fetchLandingPerformanceSummary,
  fetchLandingSignals
} from "@/lib/api/landing-signals";
import { getFoundingMemberCount } from "@/lib/api/founding-members";
import { getServerSession } from "@/lib/auth/session";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";

export const metadata = buildPageMetadata({
  path: "/",
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  titleAbsolute: true,
  description:
    "Six-layer swing and day trading signals with transparent reasoning — technical, news, macro, sector, geopolitical, and market internals. Know why a setup qualifies or stays suppressed."
});

export default async function HomePage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }
  const [apiSignals, performanceSummary, foundingMemberCount] = await Promise.all([
    fetchLandingSignals(),
    fetchLandingPerformanceSummary(),
    getFoundingMemberCount()
  ]);
  const usedApiFallback = apiSignals.length === 0;
  const explorerSignals = usedApiFallback ? FALLBACK_SIGNALS : apiSignals;
  return (
    <>
      <SiteJsonLd />
      <LandingPage
      explorerSignals={explorerSignals}
      activitySignals={apiSignals}
      usedApiFallback={usedApiFallback}
      performanceSummary={performanceSummary}
      foundingMemberCount={foundingMemberCount}
    />
    </>
  );
}
