import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LandingPage } from "@/components/landing-page";
import { ThemeProvider } from "@/lib/theme-provider";
import type { LandingSignal } from "@/lib/api/landing-signals";
import type { PerformanceSummary } from "@/lib/api/public-signals";

const baseSignals: LandingSignal[] = [
  {
    symbol: "NVDA",
    direction: "bullish",
    signal_strength: 84,
    pattern: "swing_daily",
    generated_at: new Date().toISOString(),
    layer_scores: { technical: 91, news: 78, macro: 68, sector: 87, geopolitical: 32, internals: 88 },
    outcome_1h: "correct",
    price_at_signal: 112.4,
    price_1h_after: 113.9,
    ai_summary: "x",
    disclaimer: "Signal data for informational purposes only. Not investment advice."
  }
];

const summary: PerformanceSummary = {
  total_signals_tracked: 0,
  signals_evaluated: 0,
  correct_direction_count: 0,
  incorrect_direction_count: 0,
  neutral_direction_count: 0,
  directional_accuracy_percent: 0,
  launch_date: "2026-05-01",
  date_range_days: 1
};

function view() {
  return render(
    <ThemeProvider>
      <LandingPage
        explorerSignals={baseSignals}
        activitySignals={baseSignals}
        usedApiFallback={true}
        performanceSummary={summary}
        foundingMemberCount={5}
      />
    </ThemeProvider>
  );
}

test("test_hero_no_broker_execution_claim", () => {
  view();
  expect(screen.queryByText(/Multi-broker execution/i)).toBeNull();
  expect(screen.queryByText(/Multi-broker/i)).toBeNull();
});

test("test_pricing_no_backtesting_claim", () => {
  view();
  expect(screen.queryByText(/Backtesting/i)).toBeNull();
});

test("test_pricing_no_broker_claim", () => {
  view();
  const pricing = screen.getByText(/Simple pricing\. Both modes included\./i).closest("section");
  expect(pricing?.textContent?.toLowerCase()).not.toContain("broker");
});

test("test_pricing_early_member_rates_shown", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_PAID_CHECKOUT", "true");
  try {
    view();
    expect(screen.getByText(/Early member pricing/i)).toBeInTheDocument();
    expect(screen.getByText("$49/month")).toBeInTheDocument();
    expect(screen.getByText("$99/month")).toBeInTheDocument();
    expect(screen.getByText("$29/month")).toBeInTheDocument();
    expect(screen.getByText("$59/month")).toBeInTheDocument();
    expect(screen.queryByText(/FOUNDING MEMBER OFFER/i)).toBeNull();
    expect(screen.queryByText(/spots remaining/i)).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});

test("test_pricing_paid_ctas_disabled_when_checkout_env_off", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_PAID_CHECKOUT", "");
  try {
    view();
    expect(screen.getByText(/Pro prices are preview-only/i)).toBeInTheDocument();
    const soon = screen.getAllByRole("button", { name: /Paid checkout coming soon/i });
    expect(soon.length).toBe(2);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("test_pdt_section_removed", () => {
  view();
  expect(screen.queryByText(/PDT/i)).toBeNull();
  expect(screen.queryByText(/Pattern Day Trader/i)).toBeNull();
  expect(screen.queryByText(/Day trades used/i)).toBeNull();
});

test("test_two_modes_section_exists", () => {
  view();
  expect(screen.getByText("SWING TRADING")).toBeInTheDocument();
  expect(screen.getByText("DAY TRADING")).toBeInTheDocument();
});

test("test_signal_card_tabs", () => {
  view();
  const swing = screen.getByRole("button", { name: "SWING" });
  const day = screen.getByRole("button", { name: "DAY" });
  expect(swing).toBeInTheDocument();
  expect(day).toBeInTheDocument();
  fireEvent.click(day);
  expect(screen.getByText(/AAPL · DAY SIGNAL/i)).toBeInTheDocument();
  fireEvent.click(swing);
  expect(screen.getByText(/NVDA · SWING SIGNAL/i)).toBeInTheDocument();
});

test("test_comparison_no_competitor_names", () => {
  view();
  const txt = document.body.textContent || "";
  expect(txt).not.toContain("TradingView");
  expect(txt).not.toContain("Finviz");
  expect(txt).not.toContain("Trade Ideas");
  expect(txt).not.toContain("Webull");
});

test("test_live_engine_section_copy", () => {
  view();
  expect(screen.getByRole("heading", { name: /Signals generate only when conditions align/i })).toBeInTheDocument();
  expect(
    screen.getByText(/The engine is live — inactivity is intentional when alignment isn'?t present\./i)
  ).toBeInTheDocument();
});
