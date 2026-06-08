import { describe, expect, test } from "vitest";
import {
  briefNoSetupLabel,
  briefSessionSubtitle,
  isPreparationPhase,
  resolveBriefSessionPhase
} from "@/lib/dashboard/trading-room/brief-session-copy";

// Fixed reference points (UTC → ET):
const SAT_AFTERNOON = new Date("2026-06-06T18:00:00Z"); // Sat 2:00 PM ET
const MON_PREMARKET = new Date("2026-06-08T12:00:00Z"); // Mon 8:00 AM ET
const MON_AFTERHOURS = new Date("2026-06-08T21:00:00Z"); // Mon 5:00 PM ET
const MON_REGULAR = new Date("2026-06-08T15:00:00Z"); // Mon 11:00 AM ET

describe("resolveBriefSessionPhase", () => {
  test("server-confirmed open wins regardless of clock", () => {
    expect(resolveBriefSessionPhase(true, SAT_AFTERNOON)).toBe("open");
  });

  test("weekend → weekend", () => {
    expect(resolveBriefSessionPhase(false, SAT_AFTERNOON)).toBe("weekend");
  });

  test("weekday before the open → premarket", () => {
    expect(resolveBriefSessionPhase(false, MON_PREMARKET)).toBe("premarket");
  });

  test("weekday after the close → afterhours", () => {
    expect(resolveBriefSessionPhase(false, MON_AFTERHOURS)).toBe("afterhours");
  });

  test("unknown status during regular hours falls back to open", () => {
    expect(resolveBriefSessionPhase(null, MON_REGULAR)).toBe("open");
  });
});

describe("briefSessionSubtitle", () => {
  test("each phase reads naturally", () => {
    expect(briefSessionSubtitle("open")).toMatch(/right now/i);
    expect(briefSessionSubtitle("premarket")).toMatch(/at open/i);
    expect(briefSessionSubtitle("weekend")).toMatch(/week ended/i);
    expect(briefSessionSubtitle("afterhours")).toMatch(/last session/i);
  });
});

describe("briefNoSetupLabel", () => {
  test("weekend points at Monday's reopen", () => {
    expect(briefNoSetupLabel("weekend", SAT_AFTERNOON)).toBe("Markets reopen Monday 9:30 AM ET");
  });

  test("after-hours points at the next session", () => {
    expect(briefNoSetupLabel("afterhours", MON_AFTERHOURS)).toMatch(/^Next session opens /);
  });

  test("open phase talks about conditions, not timing", () => {
    expect(briefNoSetupLabel("open", MON_REGULAR)).toBe("No setups match current conditions");
  });
});

describe("isPreparationPhase", () => {
  test("weekend / after-hours / closed are prep surfaces; open / premarket are not", () => {
    expect(isPreparationPhase("weekend")).toBe(true);
    expect(isPreparationPhase("afterhours")).toBe(true);
    expect(isPreparationPhase("closed")).toBe(true);
    expect(isPreparationPhase("open")).toBe(false);
    expect(isPreparationPhase("premarket")).toBe(false);
  });
});
