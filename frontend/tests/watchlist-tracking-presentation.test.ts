import { describe, expect, it } from "vitest";
import {
  compareSymbolsByPresentationPriority,
  maturationAlertPassesTracking,
  parseMaturationModeFromAlertBody,
  presentationMaturationState,
  shouldShowDeskRow,
  tracksDesk
} from "@/lib/watchlist-tracking-presentation";

describe("watchlist-tracking-presentation", () => {
  it("picks best state only among tracked desks", () => {
    const tracking = { NVDA: { swing: false, day: true } };
    const swing = { NVDA: { state: "actionable" } };
    const day = { NVDA: { state: "developing" } };
    expect(presentationMaturationState("NVDA", tracking, swing.NVDA, day.NVDA, true)).toBe("developing");
  });

  it("deprioritizes untracked swing when sorting", () => {
    const tracking = {
      AAA: { swing: true, day: false },
      BBB: { swing: false, day: true }
    };
    const swing = {
      AAA: { state: "developing" },
      BBB: { state: "actionable" }
    };
    const day = {
      AAA: { state: "not_aligned" },
      BBB: { state: "developing" }
    };
    const sorted = ["AAA", "BBB"].sort((a, b) =>
      compareSymbolsByPresentationPriority(a, b, tracking, swing, day, true)
    );
    expect(sorted[0]).toBe("AAA");
  });

  it("filters maturation alerts by desk tracking", () => {
    const tracking = { TSLA: { swing: true, day: false } };
    expect(maturationAlertPassesTracking("TSLA", "day", tracking, true)).toBe(false);
    expect(maturationAlertPassesTracking("TSLA", "swing", tracking, true)).toBe(true);
  });

  it("parses mode from alert body json", () => {
    expect(parseMaturationModeFromAlertBody('{"mode":"day"}')).toBe("day");
  });

  it("hides desk rows when tracking off", () => {
    const t = { swing: true, day: false };
    expect(shouldShowDeskRow(t, "day", "swing", true)).toBe(false);
    expect(shouldShowDeskRow(t, "day", "day", true)).toBe(false);
    expect(tracksDesk(t, "day")).toBe(false);
  });
});
