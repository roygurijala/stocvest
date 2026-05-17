/**
 * User-facing copy and tooltips for Scenario Builder dual-axis status.
 */

import type { ScenarioInput } from "@/lib/scenario/types";
import type { ScenarioExecutionTier, ScenarioSetupTier } from "@/lib/scenario/scenario-readiness";

export const SCENARIO_DUAL_UNLOCK_FOOTER =
  "Scenario Builder unlocks the full planning sheet when both setup alignment and execution window conditions are met. Until then, this preview is educational only — not trading advice.";

export function formatGapIntelReasonCode(code: string): string {
  const map: Record<string, string> = {
    market_closed: "Regular session is closed — intraday structure is not live.",
    swing_premarket_planning_only:
      "Swing desk: pre-market only — confirm participation after the regular open.",
    day_open_phase_volatility:
      "Day desk: open-phase volatility — structure may stabilize after ~10:30 ET.",
    swing_after_hours_next_session_only:
      "Swing desk: after hours — plan now, confirm on the next regular session.",
    day_planning_requires_rth_structure: "Day desk: needs regular-session VWAP/structure.",
    day_after_hours_no_rth_context: "Day desk: no regular-session context after the close.",
    closed: "Market phase blocks structured execution planning."
  };
  return map[code] ?? code.replace(/_/g, " ");
}

export function gapIntelReasonBullets(input: ScenarioInput): string[] {
  const reasons = input.gap_intel_gate?.reasons ?? [];
  if (reasons.length === 0) {
    return ["Session or gap conditions do not allow structured execution planning right now."];
  }
  return reasons.map(formatGapIntelReasonCode);
}

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

export function setupTierTip(tier: ScenarioSetupTier, aligned: number, total: number): string {
  const base = `Setup readiness counts how many of the ${total} signal layers align with the current bias.`;
  switch (tier) {
    case "actionable":
      return `${base} At ${aligned}/${total} with actionable maturation, the setup qualifies for full scenario planning when execution window is also open.`;
    case "developing":
      return `${base} At ${aligned}/${total}, the setup is developing — confirmations are building but the stack is not fully actionable yet.`;
    case "invalidated":
      return `${base} This setup was invalidated — conditions no longer support the prior thesis. Re-evaluate on Signals or Watchlist.`;
    default:
      return `${base} At ${aligned}/${total}, alignment is still early — use layer breakdown and evidence to see what is missing.`;
  }
}

export function executionTierTip(tier: ScenarioExecutionTier, input: ScenarioInput): string {
  if (tier === "available") {
    return "Execution window is open: gap/session gates allow structured scenario drafting (entry/stop/target math) when setup is also actionable.";
  }
  if (tier === "session_limited") {
    const bullets = gapIntelReasonBullets(input);
    return `Execution window is closed for planning:\n${bullets.map((b) => `• ${b}`).join("\n")}`;
  }
  return "Reference levels (entry zone, stop, targets) are still forming on this symbol. Alignment can progress while prices are not yet populated for planning math.";
}

export function biasPreviewLabel(biasLabel: string | null): string {
  if (!biasLabel) return "Bias: Neutral (no directional thesis yet)";
  if (biasLabel.includes("Long")) return "Bias: Bullish (long thesis when setup qualifies)";
  if (biasLabel.includes("Short")) return "Bias: Bearish (short thesis when setup qualifies)";
  return `Bias: ${biasLabel}`;
}

export function biasPreviewTip(biasLabel: string | null): string {
  if (!biasLabel || biasLabel.includes("Neutral")) {
    return "No directional thesis yet — layers are not stacked strongly enough for a long or short scenario. Bias can update as confirmations arrive.";
  }
  if (biasLabel.includes("Long")) {
    return "Layer stack leans bullish. Scenario planning assumes a long framework when setup and execution gates both clear.";
  }
  if (biasLabel.includes("Short")) {
    return "Layer stack leans bearish. Scenario planning assumes a short framework when setup and execution gates both clear.";
  }
  return "Directional bias from the composite layer stack — informational only.";
}

export function layerMissingTip(layerBullet: string): string {
  if (layerBullet.includes("Sector")) {
    return "Sector layer: industry group must confirm the symbol's move — watch for sector momentum and relative strength vs peers.";
  }
  if (layerBullet.includes("Participation") || layerBullet.includes("Internals")) {
    return "Internals / participation: breadth and volume participation should support the move — weak participation often blocks actionable state.";
  }
  if (layerBullet.includes("Trend") || layerBullet.includes("Technical")) {
    return "Technical structure: trend and key levels should align with bias — conflicting structure keeps the setup in developing state.";
  }
  if (layerBullet.includes("Macro")) {
    return "Macro layer: index and macro regime should not strongly oppose the symbol thesis.";
  }
  if (layerBullet.includes("Volatility")) {
    return "Volatility regime: elevated vol can widen stops and change risk framing before planning.";
  }
  if (layerBullet.includes("Catalyst")) {
    return "Catalyst / event risk: earnings or scheduled events can invalidate timing for structured plans.";
  }
  return "This confirmation layer is not yet aligned with the current bias. Open Signals evidence for the full layer read.";
}

export function nextUnlockBullets(
  setupTier: ScenarioSetupTier,
  executionTier: ScenarioExecutionTier,
  aligned: number,
  total: number
): string[] {
  const out: string[] = [];
  if (setupTier !== "actionable") {
    const target = aligned >= 3 ? `${Math.min(aligned + 1, total)}–${total}` : "3+";
    out.push(`Setup reaches sufficient alignment (${target} layers with confirmations)`);
  }
  if (executionTier !== "available") {
    out.push("Market session / gap conditions allow structured execution planning");
  }
  if (out.length === 0) {
    out.push("Open the full planning sheet from this button when both axes are green.");
  }
  return out;
}
