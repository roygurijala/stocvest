/** Shared empty / warming copy — observational, never “broken”. */

export const EMPTY_SETUP_EVOLUTION = {
  title: "Tracking started",
  body: "Evaluated daily after market close (~4:30 PM ET). First data point appears after the next evaluation when alignment or state changes.",
  cadence: "Opening a symbol on Signals evaluates it immediately."
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

export const WATCHLIST_EVALUATION_HEADER =
  "Evaluated daily after market close (~4:30 PM ET). Opening a symbol on Signals evaluates it immediately.";
