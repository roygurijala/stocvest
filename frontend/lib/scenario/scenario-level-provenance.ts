/**
 * Human-readable labels for reference level provenance (display only).
 */

import type { ScenarioLevelProvenance } from "@/lib/scenario/scenario-variants";

/** Map API ``reference_stop_provenance`` text when present. */
export function formatApiStopProvenance(label: string | null | undefined): string | null {
  const t = (label ?? "").trim();
  return t || null;
}

export function formatScenarioLevelProvenance(provenance: ScenarioLevelProvenance): {
  entry: string;
  stop: string;
  target: string;
} {
  let entry = "Estimated from price";
  if (provenance.entry === "zone") entry = "Session entry zone (today)";
  else if (provenance.entry === "last") entry = "Current / last trade price";
  else if (provenance.entry === "synthetic_zone") entry = "Synthetic band around last price";

  let stop = "Estimated percent rule";
  if (provenance.stop === "composite") stop = "Composite reference stop (API)";
  else if (provenance.stop === "structure") stop = "Session structure (low/high + VWAP)";
  else if (provenance.stop === "vwap") stop = "VWAP-based buffer";
  else if (provenance.stop === "percent_rule") stop = "Percent fallback from entry";

  let target = "Estimated extension";
  if (provenance.target === "composite") target = "Composite reference target (API)";
  else if (provenance.target === "structure") target = "Session high/low (structure)";
  else if (provenance.target === "percent_rule") target = "Percent extension from entry";

  return { entry, stop, target };
}
