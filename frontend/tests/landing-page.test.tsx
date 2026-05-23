import { fireEvent, render, screen, within } from "@testing-library/react";
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
});

test("test_landing_nav_shows_logo_and_start_free", () => {
  view();
  const header = screen.getByTestId("landing-header");
  expect(within(header).getByTestId("stocvest-logo")).toHaveAttribute("data-variant", "landingNav");
  expect(within(header).getByRole("link", { name: /Start Free/i })).toBeInTheDocument();
});

test("test_product_demo_and_philosophy_sections", () => {
  view();
  expect(screen.getByTestId("landing-product-demo")).toBeInTheDocument();
  expect(screen.getByTestId("landing-philosophy")).toBeInTheDocument();
  expect(screen.getByText(/Inactivity is intentional/i)).toBeInTheDocument();
  expect(screen.getByText(/Typical week:/i)).toBeInTheDocument();
});

test("test_signal_card_tabs_in_product_demo", () => {
  view();
  const swing = screen.getByRole("button", { name: "SWING" });
  const day = screen.getByRole("button", { name: "DAY" });
  fireEvent.click(day);
  expect(screen.getByText(/AAPL · DAY SIGNAL/i)).toBeInTheDocument();
  fireEvent.click(swing);
  expect(screen.getByText(/NVDA · SWING SIGNAL/i)).toBeInTheDocument();
});

test("test_fit_section_preserved", () => {
  view();
  expect(screen.getByTestId("landing-fit-section")).toBeInTheDocument();
  expect(screen.getByText(/Traders who value patience over activity/i)).toBeInTheDocument();
  expect(screen.getByText(/Constant action seekers/i)).toBeInTheDocument();
});

test("test_beta_signup_when_checkout_off", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_PAID_CHECKOUT", "");
  try {
    view();
    expect(screen.getByTestId("landing-signup-section")).toHaveTextContent(/Start free during beta/i);
    expect(screen.queryByText(/Paid checkout coming soon/i)).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});

test("test_pricing_shows_standard_rates_when_checkout_enabled", () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_PAID_CHECKOUT", "true");
  try {
    view();
    expect(screen.getByText("$49/month")).toBeInTheDocument();
    expect(screen.getByText("$99/month")).toBeInTheDocument();
  } finally {
    vi.unstubAllEnvs();
  }
});

test("test_removed_verbose_sections", () => {
  view();
  expect(screen.queryByTestId("landing-aha-section")).toBeNull();
  expect(screen.queryByTestId("landing-first-minutes")).toBeNull();
  expect(screen.queryByTestId("landing-assistant-section")).toBeNull();
});

test("test_comparison_no_competitor_names", () => {
  view();
  const txt = document.body.textContent || "";
  expect(txt).not.toContain("TradingView");
  expect(txt).not.toContain("Finviz");
});
