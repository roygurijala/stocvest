/**
 * Drill-down from Scenario Builder preview → Signals detail (layers, evidence, session).
 */

export type ScenarioBuilderSurface = "signals" | "watchlist" | "scanner" | "evidence";

export type ScenarioBuilderDrillDown = {
  /** Where the Scenario Builder button was opened from. */
  surface: ScenarioBuilderSurface;
  /** On Signals: scroll to the six-layer breakdown card. */
  onViewLayerBreakdown?: () => void;
  /** On Signals: open the full evidence modal. */
  onOpenEvidence?: () => void;
  /** On Signals: scroll to session / after-hours / gap context. */
  onViewSessionContext?: () => void;
  /** Off Signals: navigate to this href (symbol + mode + ref). */
  signalsHref?: string;
};
