/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme-provider";
import { SetupEvolutionPanel } from "@/components/signals/setup-evolution-panel";
import { WATCHLIST_SYMBOLS_CHANGED_EVENT } from "@/lib/watchlist-membership-client";
import { WATCHLIST_MATURATION_UPDATED_EVENT } from "@/lib/watchlist-maturation-bump";

vi.mock("@/lib/api/setup-evolution", () => ({
  fetchSetupEvolution: vi.fn()
}));

import { fetchSetupEvolution, type SetupEvolutionAnalytics } from "@/lib/api/setup-evolution";

const fetchMock = vi.mocked(fetchSetupEvolution);

function mockAnalytics(overrides: Partial<SetupEvolutionAnalytics> = {}): SetupEvolutionAnalytics {
  return {
    actionable_score_threshold: 72,
    score_trend: [
      {
        session_date: "2026-05-19",
        signal_score: 58,
        to_state: "developing",
        layers_aligned: 4,
        layers_total: 6
      }
    ],
    state_journey: [
      {
        state: "developing",
        started_session: "2026-05-19",
        ended_session: null,
        duration_days: 1,
        entry_score: 58,
        entry_layers_aligned: 4,
        current_score: 58,
        is_current: true
      }
    ],
    inflection: {
      peak: { session_date: "2026-05-19", signal_score: 58, to_state: "developing", label: "Peak alignment: May 19, score 58" },
      biggest_jump: null,
      current_state_streak_days: 1,
      current_state: "developing",
      momentum: { direction: "stable", delta_last_sessions: 0, sessions_window: 1, label: "Momentum: → Stable (+0 pts last 1 sessions)" }
    },
    layer_stability: [],
    score_timeline: [
      {
        session_date: "2026-05-19",
        signal_score: 58,
        score_delta: null,
        delta_label: "—",
        to_state: "developing",
        layers_aligned: 4,
        state_changed: false,
        dot: "○",
        summary: "Tracking started"
      }
    ],
    forward_projection: null,
    ...overrides
  };
}

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("SetupEvolutionPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("refetches when watchlist symbols change after add", async () => {
    fetchMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        symbol: "AMD",
        mode: "day",
        started_tracking_at: "2026-05-19T14:00:00Z",
        evaluation_cadence: "test cadence",
        transitions: [],
        summary: {
          days_tracked: 0,
          first_session: null,
          last_session: null,
          state_distribution: {},
          alignment_trend: [],
          transition_counts: { initial: 0, improved: 0, worsened: 0, unchanged: 0 },
          latest_state: null,
          latest_layers_aligned: null
        }
      });

    wrap(<SetupEvolutionPanel symbol="AMD" tradingMode="day" />);

    await waitFor(() => {
      expect(
        screen.getByText(/Add AMD to your default watchlist to track setup evolution/i)
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent(WATCHLIST_SYMBOLS_CHANGED_EVENT));

    await waitFor(() => {
      expect(screen.getByTestId("setup-evolution-warming")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("AMD", "day");
  });

  test("refetches when maturation is primed for the same symbol and desk", async () => {
    fetchMock
      .mockResolvedValueOnce({
        symbol: "AMD",
        mode: "swing",
        started_tracking_at: null,
        evaluation_cadence: "cadence",
        transitions: [],
        summary: {
          days_tracked: 0,
          first_session: null,
          last_session: null,
          state_distribution: {},
          alignment_trend: [],
          transition_counts: { initial: 0, improved: 0, worsened: 0, unchanged: 0 },
          latest_state: null,
          latest_layers_aligned: null
        }
      })
      .mockResolvedValueOnce({
        symbol: "AMD",
        mode: "swing",
        started_tracking_at: "2026-05-19T14:00:00Z",
        evaluation_cadence: "cadence",
        transitions: [
          {
            recorded_at: "2026-05-19T14:00:00Z",
            session_date: "2026-05-19",
            from_state: null,
            to_state: "developing",
            layers_aligned: 4,
            previous_layers_aligned: null,
            layers_total: 6,
            alignment_pct: 66.7,
            bias: "long",
            transition_type: "initial",
            missing_layers: [],
            evaluation_source: "composite"
          }
        ],
        summary: {
          days_tracked: 1,
          first_session: "2026-05-19",
          last_session: "2026-05-19",
          state_distribution: { developing: 1 },
          alignment_trend: [],
          transition_counts: { initial: 1, improved: 0, worsened: 0, unchanged: 0 },
          latest_state: "developing",
          latest_layers_aligned: 4
        },
        analytics: mockAnalytics()
      });

    wrap(<SetupEvolutionPanel symbol="AMD" tradingMode="swing" />);

    await waitFor(() => {
      expect(screen.getByTestId("setup-evolution-warming")).toBeInTheDocument();
    });

    window.dispatchEvent(
      new CustomEvent(WATCHLIST_MATURATION_UPDATED_EVENT, {
        detail: { symbol: "AMD", mode: "swing" }
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("setup-evolution-timeline")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
