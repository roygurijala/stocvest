import type { GapModeBestFit } from "@/lib/api/scanner";

/** How long a gap remains relevant — discovery context, not desk routing. */
export type GapTimeHorizon = "multi_session" | "intraday";

export function classifyGapTimeHorizon(item: {
  hasCatalyst: boolean;
  modeBestFit?: GapModeBestFit;
  isIpoWatch?: boolean;
}): GapTimeHorizon {
  if (item.isIpoWatch) return "multi_session";
  if (item.hasCatalyst) return "multi_session";
  const fit = item.modeBestFit ?? "either";
  if (fit === "swing") return "multi_session";
  if (fit === "day") return "intraday";
  return "intraday";
}

export function gapTimeHorizonLabel(horizon: GapTimeHorizon): string {
  return horizon === "multi_session" ? "Multi-session catalyst" : "Intraday window only";
}
