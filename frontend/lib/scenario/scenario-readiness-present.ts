/**
 * User-facing copy for Scenario Builder dual-axis status.
 */

import type { ScenarioExecutionTier, ScenarioReadinessResolved, ScenarioSetupTier } from "@/lib/scenario/scenario-readiness";
import { formatMissingLayerDisplayName } from "@/lib/scenario/scenario-readiness";

export const SCENARIO_EXECUTION_UNLOCK_FOOTER =
  "Execution planning unlocks when both setup alignment and execution conditions are met.";

export function setupTierLabel(tier: ScenarioSetupTier, aligned: number, total: number): string {
  const ratio = `${aligned} / ${total}`;
  switch (tier) {
    case "actionable":
      return `Actionable (${ratio})`;
    case "developing":
      return `Developing (${ratio})`;
    case "invalidated":
      return `Invalidated (${ratio})`;
    default:
      return `Not aligned (${ratio})`;
  }
}

export function executionTierLabel(tier: ScenarioExecutionTier): string {
  switch (tier) {
    case "available":
      return "Available";
    case "session_limited":
      return "Not available yet";
    case "structural_incomplete":
      return "Limited — levels still forming";
    default:
      return "Unavailable";
  }
}

export function biasPreviewLabel(directionalLabel: string | null): string {
  if (!directionalLabel) return "Bias: Neutral (no directional thesis yet)";
  if (directionalLabel.includes("Long") || directionalLabel.includes("Bullish")) {
    return "Bias: Bullish (conditional — requires alignment)";
  }
  if (directionalLabel.includes("Short") || directionalLabel.includes("Bearish")) {
    return "Bias: Bearish (conditional — requires alignment)";
  }
  if (directionalLabel.includes("Neutral")) {
    return "Bias: Neutral (no directional thesis yet)";
  }
  return `Bias: ${directionalLabel}`;
}

export function nextUnlockBullets(resolved: ScenarioReadinessResolved): string[] {
  const { setupTier, executionTier, aligned, total, missingLayers } = resolved;
  const out: string[] = [];

  if (setupTier !== "actionable") {
    if (aligned < 4) {
      out.push("Alignment improves to 4–5 layers");
    } else if (aligned < total) {
      out.push(`Alignment improves toward ${total} layers`);
    }
    if (missingLayers.length > 0) {
      const names = missingLayers.map(formatMissingLayerDisplayName).join(", ");
      out.push(`Missing confirmations (${names}) align`);
    } else if (aligned < total) {
      out.push("Confirmation layers align with bias");
    }
  }

  if (executionTier === "session_limited") {
    out.push("Market session enables execution planning");
  } else if (executionTier === "structural_incomplete") {
    out.push("Reference levels populate for planning math");
  }

  if (out.length === 0) {
    out.push("Open the full planning sheet when both setup and execution are available");
  }

  return out;
}
