import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { FundamentalBackdropPanel } from "@/components/signal-evidence/fundamental-backdrop";
import { ThemeProvider } from "@/lib/theme-provider";
import type { SignalEvidenceFundamentalContext } from "@/lib/signal-evidence";

const sample: SignalEvidenceFundamentalContext = {
  backdrop: "positive",
  earnings_trend: "beating",
  guidance_direction: "raised",
  analyst_direction: "upgrading",
  revenue_trend: "unknown",
  summary_line: "Fundamentals positive — beating earnings, guidance raised. Signal data only.",
  data_quality: "high",
  quarters_beating: 3,
  quarters_missing: 1,
  recent_upgrades: 2,
  recent_downgrades: 0,
  sector_display_name: "Retail",
  sector_etf: "XRT"
};

function wrap(ui: React.ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("FundamentalBackdropPanel", () => {
  test("returns null for day mode", () => {
    const { container } = wrap(
      <FundamentalBackdropPanel context={sample} isPaid mode="day" />
    );
    expect(container.firstChild).toBeNull();
  });

  test("shows upgrade gate for free users on swing", () => {
    wrap(<FundamentalBackdropPanel context={sample} isPaid={false} mode="swing" />);
    expect(screen.getByTestId("fundamental-backdrop-upgrade")).toBeTruthy();
    expect(screen.getByText(/Fundamental backdrop/i)).toBeTruthy();
  });

  test("shows backdrop for paid swing users", () => {
    wrap(<FundamentalBackdropPanel context={sample} isPaid mode="swing" />);
    expect(screen.getByTestId("fundamental-backdrop-panel")).toBeTruthy();
    expect(screen.getByText(/not scored/i)).toBeTruthy();
    expect(screen.getByText(/XRT/)).toBeTruthy();
  });
});
