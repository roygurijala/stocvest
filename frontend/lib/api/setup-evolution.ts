export type SetupEvolutionTransition = {
  recorded_at: string;
  session_date: string;
  from_state: string | null;
  to_state: string;
  layers_aligned: number;
  previous_layers_aligned: number | null;
  layers_total: number;
  alignment_pct: number;
  bias: string;
  transition_type: "initial" | "improved" | "worsened" | "unchanged";
  missing_layers: string[];
  evaluation_source: string;
  parameter_version?: string;
  signal_score?: number | null;
};

export type SetupEvolutionScorePoint = {
  session_date: string;
  signal_score: number;
  to_state: string;
  layers_aligned: number;
  layers_total: number;
};

export type SetupEvolutionAnalytics = {
  actionable_score_threshold: number;
  score_trend: SetupEvolutionScorePoint[];
  state_journey: Array<{
    state: string;
    started_session: string;
    ended_session: string | null;
    duration_days: number | null;
    entry_score: number;
    entry_layers_aligned?: number;
    current_score?: number;
    is_current?: boolean;
  }>;
  inflection: {
    peak: { session_date: string; signal_score: number; to_state: string; label: string } | null;
    biggest_jump: {
      from_session: string;
      to_session: string;
      delta: number;
      label: string;
    } | null;
    current_state_streak_days: number | null;
    current_state: string | null;
    momentum: {
      direction: "strengthening" | "weakening" | "stable";
      delta_last_sessions: number;
      sessions_window: number;
      label: string;
    } | null;
  };
  layer_stability: Array<{
    layer: string;
    confirm_rate: number;
    confirmed_sessions: number;
    total_sessions: number;
    band: "consistent" | "intermittent" | "not_confirming";
    pattern: string;
    hint: string;
  }>;
  score_timeline: Array<{
    session_date: string;
    signal_score: number;
    score_delta: number | null;
    delta_label: string;
    to_state: string;
    layers_aligned?: number;
    state_changed: boolean;
    dot: string;
    summary: string;
  }>;
  forward_projection: {
    kind: string;
    label: string;
    disclaimer: string;
    sessions_estimate?: number;
  } | null;
};

export type SetupEvolutionSummary = {
  days_tracked: number;
  first_session: string | null;
  last_session: string | null;
  state_distribution: Record<string, number>;
  alignment_trend: Array<{
    session_date: string;
    layers_aligned: number;
    layers_total: number;
    to_state: string;
  }>;
  transition_counts: {
    initial: number;
    improved: number;
    worsened: number;
    unchanged: number;
  };
  latest_state: string | null;
  latest_layers_aligned: number | null;
};

export type SetupEvolutionResponse = {
  symbol: string;
  mode: "swing" | "day";
  started_tracking_at: string | null;
  has_full_access?: boolean;
  evaluation_cadence: string;
  summary?: SetupEvolutionSummary;
  analytics?: SetupEvolutionAnalytics;
  transitions: SetupEvolutionTransition[];
};

export async function fetchSetupEvolution(
  symbol: string,
  mode: "swing" | "day"
): Promise<SetupEvolutionResponse | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const qs = new URLSearchParams({ mode }).toString();
  try {
    const res = await fetch(
      `/api/stocvest/watchlists/symbols/${encodeURIComponent(sym)}/setup-evolution?${qs}`,
      { cache: "no-store", credentials: "same-origin" }
    );
    if (!res.ok) return null;
    return (await res.json()) as SetupEvolutionResponse;
  } catch {
    return null;
  }
}
