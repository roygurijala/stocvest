/**
 * Dashboard clickability tiers — `DASHBOARD_TERMINAL_UX_PLAN.md` §2 (Phase 3).
 *
 * Level 1 deep → route change (signals / scanner / evidence).
 * Level 2 medium → expand/collapse only (`<details>`).
 * Level 3 light → tooltip / info icon.
 * Level 4 none → read-only summary (no pointer affordance).
 */

export type DashboardInteractionLevel = "deep" | "medium" | "light" | "none";

export const DATA_INTERACTION_LEVEL = "data-interaction-level" as const;

export function interactionLevelProps(
  level: DashboardInteractionLevel
): { [DATA_INTERACTION_LEVEL]: DashboardInteractionLevel } {
  return { [DATA_INTERACTION_LEVEL]: level };
}
