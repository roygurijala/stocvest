export type SetupOutcomeEvent = {
  symbol: string;
  mode: "swing" | "day";
  session_date: string;
  event_state: string;
  layers_aligned: number;
  layers_total: number;
  bias: string;
  outcome_kind: string;
  next_session_date: string | null;
  next_layers_aligned: number | null;
  next_state: string | null;
};

export type SetupOutcomesResponse = {
  mode: "swing" | "day";
  days: number;
  has_full_access: boolean;
  watchlist_symbol_count: number;
  stats: {
    total_events: number;
    building_dataset: boolean;
    by_kind: Record<string, number>;
    alignment_held_rate: number | null;
    setup_continuation_rate?: number | null;
    symbols_with_events: number;
  };
  events: SetupOutcomeEvent[];
  disclaimer: string;
};

export async function fetchSetupOutcomes(
  mode: "swing" | "day",
  days = 30
): Promise<SetupOutcomesResponse | null> {
  const qs = new URLSearchParams({ mode, days: String(days) }).toString();
  try {
    const res = await fetch(`/api/stocvest/analytics/setup-outcomes?${qs}`, {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!res.ok) return null;
    return (await res.json()) as SetupOutcomesResponse;
  } catch {
    return null;
  }
}
