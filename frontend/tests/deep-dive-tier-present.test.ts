import { describe, expect, test } from "vitest";
import {
  DEFAULT_DEEP_DIVE_EVIDENCE_TAB,
  DEEP_DIVE_CONTEXT_COLLAPSED_DEFAULT,
  DEEP_DIVE_EVIDENCE_TABS,
  DEEP_DIVE_EVIDENCE_TAB_LABELS,
  isDeepDiveEvidenceTab
} from "@/lib/dashboard/trading-room/deep-dive-tier-present";

describe("deep-dive-tier-present (ADR-003 UX-D4)", () => {
  test("default evidence tab is Setup", () => {
    expect(DEFAULT_DEEP_DIVE_EVIDENCE_TAB).toBe("setup");
  });

  test("evidence tabs match ADR contract order", () => {
    expect(DEEP_DIVE_EVIDENCE_TABS).toEqual(["setup", "layers", "chart", "context"]);
    expect(DEEP_DIVE_EVIDENCE_TAB_LABELS.setup).toBe("Setup");
    expect(DEEP_DIVE_EVIDENCE_TAB_LABELS.context).toBe("Context");
  });

  test("context secondary panels collapsed by default", () => {
    expect(DEEP_DIVE_CONTEXT_COLLAPSED_DEFAULT).toBe(true);
  });

  test("isDeepDiveEvidenceTab guards tab ids", () => {
    expect(isDeepDiveEvidenceTab("layers")).toBe(true);
    expect(isDeepDiveEvidenceTab("evolution")).toBe(false);
  });
});
