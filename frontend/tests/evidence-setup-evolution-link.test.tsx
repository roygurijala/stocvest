import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";

import { EvidenceSetupEvolutionLink } from "@/components/signal-evidence/evidence-setup-evolution-link";
import { ThemeProvider } from "@/lib/theme-provider";

describe("EvidenceSetupEvolutionLink", () => {
  test("links to setup evolution hub with symbol and mode", () => {
    render(
      <ThemeProvider>
        <EvidenceSetupEvolutionLink symbol="nvda" mode="swing" />
      </ThemeProvider>
    );
    const link = screen.getByRole("link", { name: /View setup evolution for NVDA/i });
    expect(link.getAttribute("href")).toContain("/dashboard/setup-evolution");
    expect(link.getAttribute("href")).toContain("symbol=NVDA");
    expect(link.getAttribute("href")).toContain("trading_mode=swing");
    expect(screen.getByText(/not trade performance/i)).toBeTruthy();
  });
});
