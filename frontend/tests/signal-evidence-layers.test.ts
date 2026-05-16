import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { ThemeProvider } from "@/lib/theme-provider";
import { UserProfileProvider } from "@/lib/user-profile-context";
import { buildEvidenceFromSetup, deriveEvidenceInsightFallback } from "@/lib/signal-evidence";
import type { IntradaySetupPayload } from "@/lib/api/scanner";

const baseSetup: IntradaySetupPayload = {
  symbol: "NVDA",
  direction: "long",
  score: 0.7,
  triggers: [],
  timestamp_iso: new Date().toISOString()
};

function renderCard(evidence: ReturnType<typeof buildEvidenceFromSetup>): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      null,
      createElement(
        UserProfileProvider,
        { value: { profile: null, loaded: true } },
        createElement(SignalEvidenceCard, { evidence })
      )
    )
  );
}

describe("composite layer UI surfaces Benzinga + geo baseline", () => {
  test("wim_summary rendered when present", () => {
    const ev = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const newsLayer = ev.layers.find((l) => l.key === "news");
    Object.assign(newsLayer!, {
      wim_summary: "NVDA moving on data center demand"
    });
    const html = renderCard({ ...ev, insight: ev.insight ?? deriveEvidenceInsightFallback(ev) });
    expect(html).toContain("NVDA moving on data center demand");
    expect(html).toContain("Benzinga editorial");
  });

  test("earnings beat chip text", () => {
    const ev = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const newsLayer = ev.layers.find((l) => l.key === "news");
    Object.assign(newsLayer!, {
      earnings_result: { beat: true, eps_surprise_pct: 12.3, period: "Q1" }
    });
    const html = renderCard({ ...ev, insight: ev.insight ?? deriveEvidenceInsightFallback(ev) });
    expect(html).toContain("Beat");
    expect(html).toContain("12.3%");
  });

  test("earnings miss chip text", () => {
    const ev = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const newsLayer = ev.layers.find((l) => l.key === "news");
    Object.assign(newsLayer!, {
      earnings_result: { beat: false, eps_surprise_pct: -4.1, period: "Q1" }
    });
    const html = renderCard({ ...ev, insight: ev.insight ?? deriveEvidenceInsightFallback(ev) });
    expect(html).toContain("Missed");
  });

  test("analyst upgrade chip", () => {
    const ev = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const newsLayer = ev.layers.find((l) => l.key === "news");
    Object.assign(newsLayer!, {
      latest_rating: {
        action: "Upgrade",
        rating: "Overweight",
        firm: "Morgan Stanley",
        date: "2026-05-01"
      }
    });
    const html = renderCard({ ...ev, insight: ev.insight ?? deriveEvidenceInsightFallback(ev) });
    expect(html).toContain("Morgan Stanley");
    expect(html).toContain("Upgrade");
  });

  test("geo baseline panel when no live events", () => {
    const ev = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const geoLayer = ev.layers.find((l) => l.key === "geopolitical");
    geoLayer!.geo = {
      impactSectorKey: "semiconductors",
      impactSectorLabel: "Semiconductors",
      stockExposureScore: null,
      exposureBand: "low",
      exposureSummary: null,
      activeEvents: [],
      eventDetails: [],
      geoBaselineScore: 30,
      geoBaselineSummary: "Semiconductor sector baseline copy for structural read.",
      geoHasLiveEvents: false,
      geoPrimaryTheme: "us_china_trade_tension"
    };
    const html = renderCard({ ...ev, insight: ev.insight ?? deriveEvidenceInsightFallback(ev) });
    expect(html).toContain("Structural exposure");
    expect(html).toContain("Semiconductor sector baseline copy");
    expect(html).toContain("us china trade tension");
  });

  test("geo baseline high band renders", () => {
    const ev = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const geoLayer = ev.layers.find((l) => l.key === "geopolitical");
    geoLayer!.geo = {
      impactSectorKey: "semiconductors",
      impactSectorLabel: "Semiconductors",
      stockExposureScore: null,
      exposureBand: "high",
      exposureSummary: "",
      activeEvents: [],
      eventDetails: [],
      geoBaselineScore: 70,
      geoBaselineSummary: "High thematic load.",
      geoHasLiveEvents: false,
      geoPrimaryTheme: null
    };
    const html = renderCard({ ...ev, insight: ev.insight ?? deriveEvidenceInsightFallback(ev) });
    expect(html).toMatch(/high/i);
    expect(html).toContain("High thematic load.");
  });

  test("news stale empty state wording", () => {
    const ev = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const newsLayer = ev.layers.find((l) => l.key === "news");
    Object.assign(newsLayer!, {
      news_data_state: "stale",
      articles_count: 0,
      freshnessLabel: "Updated 8h ago"
    });
    const html = renderCard({ ...ev, insight: ev.insight ?? deriveEvidenceInsightFallback(ev) });
    expect(html).toContain("No active catalyst");
    expect(html).not.toContain("Unavailable");
  });
});
