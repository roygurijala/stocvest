import { describe, expect, test } from "vitest";
import {
  expectedFrequencyForDesk,
  onboardingMaturationExpectationBullets,
  setupEvolutionEmptyWarmingBody,
  watchlistEvaluationHeader
} from "@/lib/maturation-expected-frequency";

describe("maturation-expected-frequency", () => {
  test("watchlist header mentions session refresh and on-demand evaluation", () => {
    const h = watchlistEvaluationHeader();
    expect(h).toContain("Dashboard");
    expect(h).toContain("Watchlists");
    expect(h).toContain("Refresh");
  });

  test("swing and day on-demand lines differ", () => {
    const swing = expectedFrequencyForDesk("swing").onDemand;
    const day = expectedFrequencyForDesk("day").onDemand;
    expect(swing).toContain("swing");
    expect(day).toContain("regular session");
    expect(swing).not.toBe(day);
  });

  test("progression expectation avoids trade promises", () => {
    const bullets = onboardingMaturationExpectationBullets();
    const blob = bullets.join(" ").toLowerCase();
    expect(blob).toContain("near ready");
    expect(blob).not.toMatch(/guaranteed|will signal|buy|sell/);
  });

  test("empty warming body sets multi-session expectation", () => {
    expect(setupEvolutionEmptyWarmingBody()).toMatch(/Developing/i);
  });
});
