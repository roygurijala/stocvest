/**
 * B47 — Static expected-frequency copy for maturation / progression surfaces.
 *
 * Observational only: explains when evaluations run and what pace to expect.
 * Does not promise setups, returns, or daily actionable rows.
 */

export type MaturationFrequencyDesk = "swing" | "day";

/** Login / page-load background refresh (Dashboard + default Watchlists). */
export const MATURATION_SESSION_SWING_LINE =
  "Swing desk: stale default-watchlist symbols refresh in the background when you open Dashboard or Watchlists.";

export const MATURATION_SESSION_DAY_LINE =
  "Day desk: same session refresh on Dashboard or Watchlists when the regular session is active.";

/** @deprecated Batch schedules removed; kept for tests importing legacy names. */
export const MATURATION_SCHEDULED_SWING_OPEN_LINE = MATURATION_SESSION_SWING_LINE;

/** @deprecated */
export const MATURATION_SCHEDULED_DAY_OPEN_LINE = MATURATION_SESSION_DAY_LINE;

/** @deprecated */
export const MATURATION_SCHEDULED_EOD_LINE =
  "Scheduled platform-wide maturation batches are disabled; use session refresh or row Refresh.";

/** @deprecated Use desk-specific lines; kept for tests that import the old name. */
export const MATURATION_SCHEDULED_REFRESH_LINE = MATURATION_SCHEDULED_EOD_LINE;

/** Immediate evaluation when the user opens Evidence / composite on Signals. */
export const MATURATION_ON_DEMAND_SWING_LINE =
  "Opening Evidence, row Refresh, or adding a symbol evaluates swing immediately.";

export const MATURATION_ON_DEMAND_DAY_LINE =
  "Opening Evidence or row Refresh evaluates the day desk when the regular session is active.";

/** B47 display-band expectation — quiet days are normal. */
export const MATURATION_PROGRESSION_EXPECTATION_LINE =
  "Most symbols spend time in Developing or Near ready before Strong alignment (5+ of 6 layers). Quiet scans are normal — progression is observational, not a trade signal.";

export const MATURATION_DISPLAY_BANDS_LINE =
  "Display bands: Not aligned (0–1) · Developing (2–3) · Near ready (4/6) · Strong (5–6). Execution readiness is separate.";

export type MaturationFrequencyCopy = {
  desk: MaturationFrequencyDesk;
  scheduled: string;
  onDemand: string;
  progression: string;
  displayBands: string;
};

export function expectedFrequencyForDesk(desk: MaturationFrequencyDesk): MaturationFrequencyCopy {
  const scheduled =
    desk === "swing"
      ? MATURATION_SESSION_SWING_LINE
      : `${MATURATION_SESSION_DAY_LINE} ${MATURATION_SESSION_SWING_LINE}`;
  return {
    desk,
    scheduled,
    onDemand: desk === "swing" ? MATURATION_ON_DEMAND_SWING_LINE : MATURATION_ON_DEMAND_DAY_LINE,
    progression: MATURATION_PROGRESSION_EXPECTATION_LINE,
    displayBands: MATURATION_DISPLAY_BANDS_LINE
  };
}

/** Signals command bar + watchlist maturation header. */
export function watchlistEvaluationHeader(): string {
  return `${MATURATION_SESSION_SWING_LINE} ${MATURATION_SESSION_DAY_LINE} ${MATURATION_ON_DEMAND_SWING_LINE}`;
}

/** Setup evolution hub intro + empty warming body. */
export function setupEvolutionHubIntro(desk: MaturationFrequencyDesk): string {
  const f = expectedFrequencyForDesk(desk);
  return `${f.scheduled} ${f.onDemand} ${f.progression}`;
}

export function setupEvolutionEmptyWarmingBody(): string {
  return (
    "First transition appears after the next evaluation when alignment or maturation state changes. " +
    "Symbols can stay in Developing for multiple sessions before reaching Near ready or Strong alignment."
  );
}

export function setupEvolutionEmptyWarmingCadence(desk: MaturationFrequencyDesk): string {
  return expectedFrequencyForDesk(desk).onDemand;
}

/** Compact footnote under dashboard daily pulse desk blocks. */
export function dailyPulseFrequencyFootnote(desk: MaturationFrequencyDesk): string {
  const f = expectedFrequencyForDesk(desk);
  return `${f.scheduled} ${f.progression}`;
}

/** Onboarding wizard bullets (progress + cadence). */
export function onboardingMaturationExpectationBullets(): string[] {
  return [
    MATURATION_SESSION_SWING_LINE,
    MATURATION_SESSION_DAY_LINE,
    MATURATION_ON_DEMAND_SWING_LINE,
    MATURATION_PROGRESSION_EXPECTATION_LINE
  ];
}

/** Single paragraph for compact InfoTip / assistant context. */
export function maturationFrequencyTooltip(desk: MaturationFrequencyDesk): string {
  const f = expectedFrequencyForDesk(desk);
  return [f.scheduled, f.onDemand, f.progression, f.displayBands].join(" ");
}
