import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import type { UserMePayload } from "@/lib/api/contracts";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { ThemeProvider } from "@/lib/theme-provider";
import { buildEvidenceFromSetup } from "@/lib/signal-evidence";
import { UserProfileProvider } from "@/lib/user-profile-context";

const baseSetup: IntradaySetupPayload = {
  symbol: "AAPL",
  direction: "bullish",
  score: 0.72,
  triggers: ["Test"],
  timestamp_iso: new Date().toISOString()
};

const freeProfile: UserMePayload = {
  user_id: "u1",
  trading_mode: "paper",
  onboarding_completed: true,
  legal_acknowledged: true,
  subscription_plan: "free",
  has_ai_explanations: false
};

const paidProfile: UserMePayload = {
  user_id: "u2",
  trading_mode: "paper",
  onboarding_completed: true,
  legal_acknowledged: true,
  subscription_plan: "swing_pro",
  has_ai_explanations: true
};

function wrap(ui: ReactNode, profile: UserMePayload | null, loaded: boolean) {
  return (
    <ThemeProvider>
      <UserProfileProvider value={{ profile, loaded }}>{ui}</UserProfileProvider>
    </ThemeProvider>
  );
}

describe("AI explanations gate", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: "Deterministic stub.",
          source: "deterministic",
          upgrade_available: true,
          cached: false
        })
      } as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("test_upgrade_prompt_shown_for_free_user", async () => {
    const ev = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    render(wrap(<SignalEvidenceCard evidence={ev} />, freeProfile, true));
    await waitFor(() => {
      expect(screen.getByText(/AI Signal Explanations/)).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /View Plans/ })).toHaveAttribute("href", "/dashboard/settings");
  });

  it("test_ai_explanation_shown_for_paid_user", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        text: "Paid AI sentence one. Paid two. Signal data only.",
        source: "ai",
        upgrade_available: false,
        cached: false
      })
    } as Response);
    const ev = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    render(wrap(<SignalEvidenceCard evidence={ev} />, paidProfile, true));
    await waitFor(() => {
      expect(screen.getByText(/Paid AI sentence one/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/AI Signal Explanations/)).toBeNull();
  });

  it("test_upgrade_prompt_links_to_settings", () => {
    render(
      wrap(
        <UpgradePrompt
          feature="AI Signal Explanations"
          plan="Swing Pro"
          description="Get plain-English explanations tailored to this specific signal."
        />,
        freeProfile,
        true
      )
    );
    expect(screen.getByRole("link", { name: /View Plans/ })).toHaveAttribute("href", "/dashboard/settings");
  });
});
