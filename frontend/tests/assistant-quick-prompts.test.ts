import { describe, expect, test } from "vitest";
import {
  buildContextualEmptyState,
  buildContextualQuickPrompts
} from "@/lib/assistant/quick-prompts";
import type { AssistantPageContext } from "@/lib/assistant/types";

describe("buildContextualQuickPrompts", () => {
  test("monitor state includes symbol and risk/reward when low", () => {
    const ctx: AssistantPageContext = {
      page: "signals/layers",
      symbol: "intc",
      decision_state: "monitor",
      risk_reward: 1.4,
      decision_rationale: { category: "risk_reward", label: "Why hold:", text: "R/R below threshold." }
    };
    const prompts = buildContextualQuickPrompts(ctx, true);
    expect(prompts.some((p) => p.includes("INTC"))).toBe(true);
    expect(prompts.some((p) => /risk\/reward/i.test(p))).toBe(true);
  });

  test("dashboard page suggests desk posture questions", () => {
    const prompts = buildContextualQuickPrompts(
      {
        page: "dashboard",
        swing_desk_posture: "suppressed",
        day_desk_posture: "active"
      },
      true
    );
    expect(prompts.some((p) => /Swing desk/i.test(p))).toBe(true);
  });

  test("scanner page references top setup symbol", () => {
    const ctx: AssistantPageContext = {
      page: "dashboard/scanner",
      top_setups: [{ symbol: "nvda", direction: "long", strength_bucket: "strong", confluence: true, orb_expired: false }]
    };
    const prompts = buildContextualQuickPrompts(ctx, true);
    expect(prompts[0]).toContain("NVDA");
  });
});

describe("buildContextualEmptyState", () => {
  test("contextual empty state surfaces decision rationale", () => {
    const copy = buildContextualEmptyState(
      {
        page: "signals/layers",
        symbol: "INTC",
        trading_mode: "swing",
        decision_state: "monitor",
        decision_rationale: {
          category: "confirmation",
          label: "Why hold:",
          text: "Layers are mixed — waiting for stronger agreement."
        }
      },
      true
    );
    expect(copy.title).toContain("INTC");
    expect(copy.title).toContain("Monitor");
    expect(copy.subtitle).toContain("mixed");
  });
});
