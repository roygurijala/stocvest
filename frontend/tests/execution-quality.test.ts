import { describe, expect, it } from "vitest";
import {
  executionQualitySummaryLine,
  parseExecutionQuality
} from "@/lib/signal-evidence/execution-quality";

describe("parseExecutionQuality", () => {
  it("parses composite execution_quality block", () => {
    const eq = parseExecutionQuality({
      execution_quality: {
        band: "moderate",
        stop_atr_ratio: 1.4,
        level_path: {
          has_reference_stop: true,
          has_reference_target: true,
          structure_complete: true
        },
        volume_ratio: 0.6,
        volume_band: "moderate",
        risk_reward: 1.8,
        session_window: { in_day_ledger_window: true },
        setup_tags: ["vwap:available"],
        disclaimer: "info only"
      }
    });
    expect(eq?.band).toBe("moderate");
    expect(eq?.stop_atr_ratio).toBe(1.4);
    expect(eq?.setup_tags).toContain("vwap:available");
  });

  it("returns null when block missing", () => {
    expect(parseExecutionQuality({})).toBeNull();
  });
});

describe("executionQualitySummaryLine", () => {
  it("formats a readable summary", () => {
    const line = executionQualitySummaryLine({
      band: "strong",
      stop_atr_ratio: 1.1,
      level_path: {
        has_reference_stop: true,
        has_reference_target: true,
        structure_complete: true
      },
      volume_ratio: 1.0,
      volume_band: "strong",
      risk_reward: 2.1,
      session_window: { in_day_ledger_window: true },
      setup_tags: [],
      disclaimer: ""
    });
    expect(line).toContain("Strong execution context");
    expect(line).toContain("stop 1.1× ATR");
  });
});
