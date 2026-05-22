import { describe, expect, test } from "vitest";
import {
  buildMarketingAssistantContext,
  marketingPageFromPathname
} from "@/lib/assistant/marketing-context";
import { buildContextualQuickPrompts } from "@/lib/assistant/quick-prompts";

describe("marketing assistant context", () => {
  test("maps homepage pathname", () => {
    expect(marketingPageFromPathname("/")).toBe("home");
    expect(buildMarketingAssistantContext("home")).toEqual({
      page: "marketing/home",
      session_mode: "public"
    });
  });

  test("marketing quick prompts include pricing", () => {
    const prompts = buildContextualQuickPrompts(
      { page: "marketing/home", session_mode: "public" },
      false
    );
    expect(prompts.some((p) => /pricing/i.test(p))).toBe(true);
  });
});
