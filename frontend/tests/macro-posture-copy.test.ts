import { describe, expect, it } from "vitest";

import { macroPreEventPosture } from "@/lib/signal-evidence/macro-posture-copy";
import type { EvidenceLayer } from "@/lib/signal-evidence";

function macroLayer(overrides: Partial<EvidenceLayer>): EvidenceLayer {
  return {
    key: "macro",
    icon: "",
    name: "Macro",
    status: "Neutral",
    weightPercent: 10,
    explanation: "",
    keyPoints: [],
    contributionScore: null,
    freshnessLabel: "",
    ...overrides
  } as EvidenceLayer;
}

function event(name: string, hoursUntil: number, extra: Record<string, unknown> = {}) {
  return {
    event_id: `${name}-${hoursUntil}`,
    name,
    category: "monetary",
    status: "upcoming",
    importance: 3,
    hours_until: hoursUntil,
    warning: null,
    scheduled_time: "2026-09-15T18:00:00Z",
    ...extra
  };
}

describe("macroPreEventPosture (P1-MACRO safe slice)", () => {
  it("returns a non-directional heads-up for a nearby major event", () => {
    const posture = macroPreEventPosture(
      macroLayer({ upcoming_events: [event("FOMC Rate Decision", 20)] })
    );
    expect(posture).not.toBeNull();
    expect(posture).toContain("FOMC Rate Decision");
    expect(posture).toContain("in ~20h");
    expect(posture?.toLowerCase()).toContain("not a directional call");
  });

  it("prefers the nearest MAJOR event over a generic one", () => {
    const posture = macroPreEventPosture(
      macroLayer({
        upcoming_events: [event("Some Regional Survey", 5), event("CPI Report", 30)]
      })
    );
    expect(posture).toContain("CPI Report");
  });

  it("uses a generic near-term event only when macro risk is elevated", () => {
    const layerLow = macroLayer({
      macro_risk_level: "low",
      upcoming_events: [event("Regional Fed Survey", 6)]
    });
    expect(macroPreEventPosture(layerLow)).toBeNull();

    const layerElevated = macroLayer({
      macro_risk_level: "elevated",
      upcoming_events: [event("Regional Fed Survey", 6)]
    });
    expect(macroPreEventPosture(layerElevated)).toContain("Regional Fed Survey");
  });

  it("labels imminent events and returns null when nothing is near-term", () => {
    expect(macroPreEventPosture(macroLayer({ upcoming_events: [event("CPI Report", 0.5)] }))).toContain(
      "imminent"
    );
    expect(macroPreEventPosture(macroLayer({ upcoming_events: [] }))).toBeNull();
    // Too far out (beyond 8-day horizon).
    expect(macroPreEventPosture(macroLayer({ upcoming_events: [event("FOMC", 24 * 30)] }))).toBeNull();
  });

  it("returns null for non-macro layers", () => {
    expect(macroPreEventPosture(macroLayer({ key: "technical", upcoming_events: [event("FOMC", 10)] }))).toBeNull();
  });
});
