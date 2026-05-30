import { describe, expect, test } from "vitest";
import {
  formatRegimeGateQualifier,
  isWatchlistRadarDeskGated,
  resolveWatchlistRadarAttentionLine
} from "@/lib/dashboard/watchlist-radar-attention";

const deskOpen = { regimeLabel: "Bullish", systemSuppressed: false, sessionMode: "live" as const };
const deskBearish = { regimeLabel: "Bearish", systemSuppressed: false, sessionMode: "live" as const };
const deskSuppressed = { regimeLabel: "Neutral", systemSuppressed: true, sessionMode: "live" as const };
const deskClosed = { regimeLabel: "Bullish", systemSuppressed: true, sessionMode: "closed" as const };

describe("watchlist-radar-attention", () => {
  test("formatRegimeGateQualifier skips neutral", () => {
    expect(formatRegimeGateQualifier("Neutral")).toBeNull();
    expect(formatRegimeGateQualifier("Bearish")).toBe("bearish regime");
  });

  test("isWatchlistRadarDeskGated when suppressed or bearish", () => {
    expect(isWatchlistRadarDeskGated(deskOpen)).toBe(false);
    expect(isWatchlistRadarDeskGated(deskBearish)).toBe(true);
    expect(isWatchlistRadarDeskGated(deskSuppressed)).toBe(true);
  });

  test("6/6 neutral + session closed → balanced session closed", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: { bias: "neutral", layers_aligned: 6, layers_total: 6, progress_band: "actionable" },
      alignmentTier: "actionable",
      blockers: [],
      desk: deskClosed
    });
    expect(line).toBe("Balanced — session closed");
  });

  test("6/6 actionable + session closed → session closed (not desk gated regime)", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: {
        bias: "long",
        progress_band: "actionable",
        layers_aligned: 6,
        layers_total: 6,
        state: "actionable"
      },
      alignmentTier: "actionable",
      blockers: [],
      desk: deskClosed
    });
    expect(line).toBe("Strong setup — session closed");
    expect(line).not.toMatch(/desk gated/i);
  });

  test("6/6 actionable + bearish desk → desk gated (not near actionable)", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: {
        bias: "long",
        progress_band: "actionable",
        layers_aligned: 6,
        layers_total: 6,
        state: "actionable"
      },
      alignmentTier: "actionable",
      blockers: [],
      desk: deskBearish
    });
    expect(line).toBe("Strong setup — desk gated (bearish regime)");
    expect(line).not.toMatch(/near actionable/i);
  });

  test("6/6 actionable + open desk → open on Signals", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: {
        bias: "long",
        progress_band: "actionable",
        layers_aligned: 6,
        layers_total: 6,
        state: "actionable"
      },
      alignmentTier: "actionable",
      blockers: [],
      desk: deskOpen
    });
    expect(line).toBe("Strong on your list — open on Signals");
  });

  test("near_ready + bearish desk → near ready desk gated", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: { progress_band: "near_ready", layers_aligned: 4, layers_total: 6, state: "developing" },
      alignmentTier: "near_ready",
      blockers: [],
      desk: deskBearish
    });
    expect(line).toBe("Near ready — desk gated (bearish regime)");
  });

  test("near_ready + open desk → near actionable on your list", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: { progress_band: "near_ready", layers_aligned: 4, layers_total: 6 },
      alignmentTier: "near_ready",
      blockers: [],
      desk: deskOpen
    });
    expect(line).toBe("Near actionable on your list");
  });

  test("actionable band + suppressed desk without regime qualifier", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: { bias: "long", progress_band: "actionable", layers_aligned: 6, layers_total: 6 },
      alignmentTier: "actionable",
      blockers: [],
      desk: deskSuppressed
    });
    expect(line).toBe("Strong setup — desk gated");
  });

  test("actionable + macro blocker only on open desk", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: { bias: "long", progress_band: "actionable", layers_aligned: 6, layers_total: 6 },
      alignmentTier: "actionable",
      blockers: ["Macro"],
      desk: deskOpen
    });
    expect(line).toBe("Strong setup — macro gate on Signals");
  });

  test("actionable + R/R blocker on open desk", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: { bias: "long", progress_band: "actionable", layers_aligned: 6, layers_total: 6 },
      alignmentTier: "actionable",
      blockers: ["Risk/Reward"],
      desk: deskOpen
    });
    expect(line).toBe("Strong setup — Risk/Reward on Signals");
  });
});
