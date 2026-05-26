import { describe, expect, it } from "vitest";
import { accessStateFromMe, needsPhoneVerification, trialCountdownLabel, trialExpired } from "@/lib/trial-access";
import type { UserMePayload } from "@/lib/api/contracts";

describe("trial-access helpers", () => {
  it("needs phone when enforcement on and state phone_required", () => {
    const me: UserMePayload = {
      user_id: "u1",
      trading_mode: "paper",
      onboarding_completed: true,
      legal_acknowledged: true,
      trial_enforcement_enabled: true,
      access_state: "phone_required"
    };
    expect(needsPhoneVerification(me)).toBe(true);
    expect(trialExpired(me)).toBe(false);
  });

  it("shows countdown label during active trial", () => {
    const me: UserMePayload = {
      user_id: "u1",
      trading_mode: "paper",
      onboarding_completed: true,
      legal_acknowledged: true,
      access_state: "trial_active",
      trial_days_remaining: 4
    };
    expect(trialCountdownLabel(me)).toBe("4 days left in trial");
    expect(accessStateFromMe(me)).toBe("trial_active");
  });
});
