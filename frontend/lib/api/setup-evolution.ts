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
