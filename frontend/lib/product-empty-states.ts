/** Shared empty / warming copy — observational, never “broken”. */

import {
  setupEvolutionEmptyWarmingBody,
  setupEvolutionEmptyWarmingCadence,
  watchlistEvaluationHeader
} from "@/lib/maturation-expected-frequency";

export const EMPTY_SETUP_EVOLUTION = {
  title: "Tracking started",
  body: setupEvolutionEmptyWarmingBody(),
  cadence: setupEvolutionEmptyWarmingCadence("swing")
} as const;

export const EMPTY_VALIDATION = {
  title: "No outcomes yet",
  body: "Data appears once setups start resolving. We record outcomes when signals reach measurable states — not at list-add time.",
  hint: "Run evidence on Signals to refresh watchlist maturation; validation fills as setups close."
} as const;

export const EMPTY_PERFORMANCE = {
  title: "Tracking initialized",
  body: "Performance appears after first resolved setups. Metrics reflect directional accuracy only — not dollar P&L.",
  hint: "Historical signal accuracy does not guarantee future results."
} as const;

export const WATCHLIST_EVALUATION_HEADER = watchlistEvaluationHeader();
