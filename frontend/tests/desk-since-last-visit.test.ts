import { describe, expect, test, beforeEach } from "vitest";

import {
  diffDeskSinceLastVisit,
  loadDeskLastVisit,
  saveDeskLastVisit,
  sinceLastVisitSummary
} from "@/lib/dashboard/desk-since-last-visit";

describe("desk since last visit", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("diffs added and removed symbols", () => {
    saveDeskLastVisit(["MU", "NVDA"], new Date("2026-05-25T12:00:00Z"));
    const prev = loadDeskLastVisit();
    const { added, removed } = diffDeskSinceLastVisit(["MU", "AMD"], prev);
    expect(added).toEqual(["AMD"]);
    expect(removed).toEqual(["NVDA"]);
    expect(sinceLastVisitSummary(added, removed)).toBe("AMD in discovery · NVDA dropped");
  });

  test("returns null summary when no changes", () => {
    expect(sinceLastVisitSummary([], [])).toBeNull();
  });
});
