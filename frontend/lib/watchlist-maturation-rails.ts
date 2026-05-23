/** Maturation summary rails (actionable / developing / …) — filter + label helpers. */

export type WatchlistMaturationRailKey = "actionable" | "developing" | "notAligned" | "invalidated";

export const WATCHLIST_MATURATION_RAIL_LABELS: Record<WatchlistMaturationRailKey, string> = {
  actionable: "Actionable",
  developing: "Developing",
  notAligned: "Not aligned",
  invalidated: "Invalidated"
};

/** Map a symbol's presentation maturation state to a rail key, if any. */
export function maturationRailKeyForState(state: string | undefined): WatchlistMaturationRailKey | null {
  const st = (state || "").trim().toLowerCase();
  if (st === "actionable") return "actionable";
  if (st === "developing" || st === "re_evaluating") return "developing";
  if (st === "not_aligned") return "notAligned";
  if (st === "invalidated") return "invalidated";
  return null;
}

export function symbolMatchesMaturationRail(
  presentationState: string | undefined,
  rail: WatchlistMaturationRailKey
): boolean {
  return maturationRailKeyForState(presentationState) === rail;
}
