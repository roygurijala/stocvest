/**
 * Drill-down from Scenario Builder preview — evidence is the only navigation escape hatch.
 */

export type ScenarioBuilderSurface = "signals" | "watchlist" | "scanner" | "evidence";

export type ScenarioBuilderDrillDown = {
  /** Where the Scenario Builder button was opened from. */
  surface: ScenarioBuilderSurface;
  /** On Signals / Evidence: open full evidence in-page without route change. */
  onOpenEvidence?: () => void;
  /** Off Signals: deep link to Signals with ``#evidence`` (preserves ref + symbol). */
  evidenceHref?: string;
};
