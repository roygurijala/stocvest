/**
 * B52 — Signals desk tabs (Setup / Layers / Evolution) + KPI deep-links.
 */

import { SIGNALS_SECTION_TARGET } from "@/lib/signals-page-sections";

export const SIGNALS_DESK_TABS = ["setup", "layers", "evolution"] as const;
export type SignalsDeskTab = (typeof SIGNALS_DESK_TABS)[number];

export const SIGNALS_TAB_QUERY_KEY = "tab";

export type SignalsKpiTarget = "bias" | "alignment" | "execution";

const TAB_SET = new Set<string>(SIGNALS_DESK_TABS);

export function isSignalsDeskTab(value: string | null | undefined): value is SignalsDeskTab {
  return typeof value === "string" && TAB_SET.has(value);
}

export function parseSignalsDeskTab(raw: string | null | undefined): SignalsDeskTab {
  return isSignalsDeskTab(raw) ? raw : "setup";
}

/** KPI column → tab panel (Bias & Execution → Setup; Alignment → Layers). */
export function kpiTargetToDeskTab(target: SignalsKpiTarget): SignalsDeskTab {
  if (target === "alignment") return "layers";
  return "setup";
}

/** Scroll anchor after a KPI card click (Setup or Layers panel must be mounted). */
export function kpiTargetScrollId(target: SignalsKpiTarget): string {
  if (target === "alignment") return SIGNALS_SECTION_TARGET.layers;
  if (target === "bias") return SIGNALS_SECTION_TARGET.biasRationale;
  return SIGNALS_SECTION_TARGET.whyNotActionable;
}

export function deskTabHighlightsKpi(tab: SignalsDeskTab, target: SignalsKpiTarget): boolean {
  return kpiTargetToDeskTab(target) === tab;
}

export const SIGNALS_DESK_TAB_LABEL: Record<SignalsDeskTab, string> = {
  setup: "Setup",
  layers: "Layers",
  evolution: "Evolution"
};
