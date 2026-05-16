import { browserApiFetch } from "@/lib/browser-api-fetch";

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

export type SetupEvolutionResponse = {
  symbol: string;
  mode: "swing" | "day";
  started_tracking_at: string | null;
  evaluation_cadence: string;
  transitions: SetupEvolutionTransition[];
};

export async function fetchSetupEvolution(
  symbol: string,
  mode: "swing" | "day"
): Promise<SetupEvolutionResponse | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const qs = new URLSearchParams({ mode }).toString();
  const res = await browserApiFetch(
    `/api/stocvest/watchlists/symbols/${encodeURIComponent(sym)}/setup-evolution?${qs}`,
    { method: "GET" }
  );
  if (!res.ok) return null;
  return (await res.json()) as SetupEvolutionResponse;
}
