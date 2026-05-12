import { describe, expect, test } from "vitest";

import {
  cadenceLabel,
  deskLabel,
  outcomeLabel,
  scannerTabLabel,
  tabLabel,
  TAB_LABEL_BOTH,
  TAB_LABEL_DAY,
  TAB_LABEL_SWING,
  SECTION_LABEL_DAY_DESK,
  SECTION_LABEL_SWING_DESK,
  SUBHEADING_DAY_CADENCE,
  SUBHEADING_SWING_CADENCE,
  OUTCOME_LABEL_DAY_SIGNALS,
  OUTCOME_LABEL_SWING_SIGNALS,
  PROSE_DAY_TRADING,
  PROSE_SWING_TRADING
} from "@/lib/mode-terminology";

describe("mode-terminology constants — closed-set lock-in", () => {
  test("test_tab_labels_are_single_word_capitalized", () => {
    // Tab labels MUST be one word — never "Swing Trade" / "Day Trade".
    // A future PR that renames the tab to a two-word form trips this.
    expect(TAB_LABEL_SWING).toBe("Swing");
    expect(TAB_LABEL_DAY).toBe("Day");
    expect(TAB_LABEL_BOTH).toBe("Both");
  });

  test("test_desk_labels_carry_Desk_suffix", () => {
    expect(SECTION_LABEL_SWING_DESK).toBe("Swing Desk");
    expect(SECTION_LABEL_DAY_DESK).toBe("Day Desk");
  });

  test("test_cadence_subheadings_include_canonical_cadence_words", () => {
    expect(SUBHEADING_SWING_CADENCE.toLowerCase()).toContain("multi-day");
    expect(SUBHEADING_DAY_CADENCE.toLowerCase()).toContain("intraday");
  });

  test("test_outcome_labels_use_signals_not_trades", () => {
    // The load-bearing distinction — STOCVEST tracks signals, not
    // trades. A regression that re-introduces "swing trades" / "day
    // trades" as outcome labels trips this.
    expect(OUTCOME_LABEL_SWING_SIGNALS).toBe("swing signals");
    expect(OUTCOME_LABEL_DAY_SIGNALS).toBe("day signals");
    expect(OUTCOME_LABEL_SWING_SIGNALS).not.toContain("trade");
    expect(OUTCOME_LABEL_DAY_SIGNALS).not.toContain("trade");
  });

  test("test_prose_forms_are_lowercase_gerunds", () => {
    expect(PROSE_SWING_TRADING).toBe("swing trading");
    expect(PROSE_DAY_TRADING).toBe("day trading");
  });
});

describe("mode-terminology helpers — total functions", () => {
  test("test_tabLabel_returns_canonical_short_label", () => {
    expect(tabLabel("swing")).toBe(TAB_LABEL_SWING);
    expect(tabLabel("day")).toBe(TAB_LABEL_DAY);
  });

  test("test_scannerTabLabel_handles_three_way_mode", () => {
    expect(scannerTabLabel("swing")).toBe(TAB_LABEL_SWING);
    expect(scannerTabLabel("day")).toBe(TAB_LABEL_DAY);
    expect(scannerTabLabel("both")).toBe(TAB_LABEL_BOTH);
  });

  test("test_deskLabel_returns_canonical_desk_heading", () => {
    expect(deskLabel("swing")).toBe(SECTION_LABEL_SWING_DESK);
    expect(deskLabel("day")).toBe(SECTION_LABEL_DAY_DESK);
  });

  test("test_cadenceLabel_returns_canonical_cadence_subheading", () => {
    expect(cadenceLabel("swing")).toBe(SUBHEADING_SWING_CADENCE);
    expect(cadenceLabel("day")).toBe(SUBHEADING_DAY_CADENCE);
  });

  test("test_outcomeLabel_returns_canonical_signal_outcome_label", () => {
    expect(outcomeLabel("swing")).toBe(OUTCOME_LABEL_SWING_SIGNALS);
    expect(outcomeLabel("day")).toBe(OUTCOME_LABEL_DAY_SIGNALS);
  });
});
