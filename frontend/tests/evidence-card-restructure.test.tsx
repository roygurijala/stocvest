import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { buildEvidenceFromSetup } from "@/lib/signal-evidence";
import { ThemeProvider } from "@/lib/theme-provider";
import { UserProfileProvider } from "@/lib/api/user";

const baseSetup = {
  symbol: "TSLA",
  direction: "short",
  confidence: 42,
  timestamp_iso: new Date().toISOString(),
  layers: {
    technical: 72,
    news: 48,
    macro: 50,
    sector: 45,
    geopolitical: 50,
    internals: 68
  }
} as const;

describe("Evidence card B44 restructure", () => {
  test("omits trade readiness grid and layer alignment section", () => {
    const evidence = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const html = renderToStaticMarkup(
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
    expect(html).toContain("evidence-card-header");
    expect(html).toContain("Layer read (by verdict)");
    expect(html).not.toContain("Layer contribution (directional pressure)");
    expect(html).not.toContain("weight ");
    expect(html).not.toContain("TRADE READINESS");
    expect(html).not.toContain("LAYER ALIGNMENT");
    expect(html).not.toContain("Signal Strength Breakdown");
    expect(html).not.toContain("Signal Data Only");
    expect(html).not.toContain("AI Signal Analysis");
    expect(html).toContain("Layer synthesis (informational)");
  });
});
