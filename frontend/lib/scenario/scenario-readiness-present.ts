/**
 * User-facing copy for Scenario Builder dual-axis status.
 */

import {
  formatAlignmentStatusLine,
  layersAwayFromActionable
} from "@/lib/alignment-display-tier";
import type { ScenarioExecutionTier, ScenarioReadinessResolved, ScenarioSetupTier } from "@/lib/scenario/scenario-readiness";
import { formatMissingLayerDisplayName } from "@/lib/scenario/scenario-readiness";

export const SCENARIO_EXECUTION_UNLOCK_FOOTER =
  "Execution planning unlocks when both setup alignment and execution conditions are met.";

export function setupTierLabel(tier: ScenarioSetupTier, aligned: number, total: number): string {
  if (tier === "near_ready") {
    return formatAlignmentStatusLine({
      layersAligned: aligned,
      layersTotal: total,
      maturationState: "developing"
    });
  }
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

/** One-line anchor under Setup / Execution — reflects live dual-axis state. */
export function scenarioPreviewTakeaway(resolved: ScenarioReadinessResolved): string {
  const { setupTier, executionTier } = resolved;
  const setupReady = setupTier === "actionable";
  const executionReady = executionTier === "available";

  if (setupTier === "invalidated") {
    return "This setup read has been invalidated — review layers before planning.";
  }
  if (setupTier === "near_ready") {
    if (executionTier === "session_limited") {
      return "Setup is approaching the actionable threshold — execution planning waits on session conditions.";
    }
    if (!executionReady) {
      return "Setup is one layer from the actionable band — execution planning is still limited.";
    }
    return "Setup is approaching the actionable threshold — review missing layers before opening the full sheet.";
  }
  if (setupReady && executionReady) {
    return "Setup and execution are both available — open the full planning sheet when ready.";
  }
  if (setupReady && !executionReady) {
    if (executionTier === "session_limited") {
      return "Setup qualifies, but execution planning is not available in the current session.";
    }
    return "Setup qualifies, but execution planning is still limited until reference levels clear.";
  }
  if (!setupReady && executionReady) {
    if (setupTier === "developing") {
      return "Execution window is open, but the setup is still developing — missing layers may still need to align.";
    }
    return "Execution window is open, but setup alignment is still below the actionable band.";
  }
  if (!executionReady) {
    return "Setup is progressing, but execution is currently not possible.";
  }
  return "Setup is still developing — layer alignment or confirmations need to catch up.";
}

export function nextUnlockBullets(resolved: ScenarioReadinessResolved): string[] {
  const { setupTier, executionTier, aligned, total, missingLayers } = resolved;
  const out: string[] = [];

  if (setupTier !== "actionable") {
    const layersAway = layersAwayFromActionable(aligned, total);
    if (setupTier === "near_ready" && layersAway > 0) {
      if (missingLayers.length > 0) {
        const names = missingLayers.map(formatMissingLayerDisplayName).join(", ");
        out.push(
          layersAway === 1
            ? `Missing: ${names} — 1 layer from actionable threshold (${aligned} / ${total})`
            : `Missing: ${names} — ${layersAway} layers from actionable threshold (${aligned} / ${total})`
        );
      } else {
        out.push(
          layersAway === 1
            ? `One layer aligns with bias to reach actionable threshold (${aligned} / ${total} now)`
            : `${layersAway} layers align with bias to reach actionable threshold (${aligned} / ${total} now)`
        );
      }
    } else if (missingLayers.length > 0) {
      const names = missingLayers.map(formatMissingLayerDisplayName).join(", ");
      out.push(`Remaining layers to align: ${names}`);
    } else if (aligned < total) {
      const gap = total - aligned;
      out.push(
        gap === 1
          ? `One more layer aligns with bias (${aligned} / ${total} now)`
          : `${gap} more layers align with bias (${aligned} / ${total} now)`
      );
    }
  }

  if (executionTier === "session_limited") {
    out.push(
      resolved.gapIntelBlocked
        ? "Execution window becomes available when the market is open"
        : "Execution window becomes available when session conditions clear"
    );
  } else if (executionTier === "structural_incomplete") {
    out.push("Reference levels populate for execution planning");
  }

  if (out.length === 0) {
    out.push("Open the full planning sheet when both setup and execution are available");
  }

  return out;
}
