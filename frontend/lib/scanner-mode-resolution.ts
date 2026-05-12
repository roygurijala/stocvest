/**
 * Scanner & dashboard mode-resolution rules for opening the Evidence card.
 *
 * The Evidence card has two parts that MUST be mode-correct or the user reads a
 * subtly wrong trade plan:
 *   1. Which composite engine answers (`/v1/signals/composite/swing` vs
 *      `/v1/signals/composite/real`). The engines use fundamentally different
 *      inputs — swing reads daily bars + SMA50/200/MACD + 120h news + 168h geo +
 *      weekly sector posture; day reads 1-min bars + RSI/VWAP/EMA9/EMA20/ORB +
 *      day-tier news + daily sector posture.
 *   2. Which chips are kept — `filterChipsForMode(chips, "swing")` strips
 *      intraday-only chips (VWAP / EMA9 / EMA20 / ORB / "(session)") from the
 *      technical layer on swing reads. The filter fires on the response's
 *      `body.mode` field, so if the wrong engine answered, the filter never
 *      fires and intraday chips leak into the swing modal — which is exactly
 *      the regression B30 Phase 1 fixed.
 *
 * This module is the single source of truth for HOW the call sites resolve
 * mode before calling `enrichEvidenceWithComposite(evidence, mode)`. The rules
 * are intentionally simple but they encode product decisions, so they live in
 * a named module with tests rather than as inline ternaries inside React
 * components where they were previously hidden.
 */

import type { ScannerSetupLoadMode } from "@/lib/api/scanner";

/** Trading mode used to select the Evidence-card composite engine and chip filter. */
export type EvidenceTradingMode = "swing" | "day";

/**
 * Resolve the Evidence-card trading mode from the scanner's top-level setup-load mode.
 *
 * Mapping:
 *   - `"day"`   → `"day"`  (Scanner is in day-only mode; everything intraday.)
 *   - `"swing"` → `"swing"` (Scanner is in swing-only mode; everything multi-day.)
 *   - `"both"`  → `"swing"` (Scanner shows BOTH desks stacked, with the swing
 *                            desk rendered above the day desk; the swing desk
 *                            is the default and a Day-specific "evaluate as
 *                            intraday" CTA is a deferred Severity-2 product
 *                            decision tracked in BACKLOG B30. Picking swing
 *                            here is reversible — a future side-by-side dual
 *                            Evidence modal would supersede this choice.)
 *
 * This MUST stay aligned with `panelNewsTradingMode` in `scanner-page-client.tsx`
 * — the same collapse rule (`scannerSetupMode === "day" ? "day" : "swing"`) is
 * used to pick the news-lookback window. Keeping them in lockstep guarantees
 * the news the user reads is tagged with the same horizon as the composite
 * engine that produced the verdict.
 */
export function resolveEvidenceTradingMode(
  scannerSetupMode: ScannerSetupLoadMode
): EvidenceTradingMode {
  if (scannerSetupMode === "day") return "day";
  return "swing";
}

/**
 * Resolve the per-row Evidence-card trading mode from a setup-render-group key.
 *
 * In `scannerSetupMode === "both"` view the scanner renders two side-by-side
 * groups — a swing group (`group.key === "swing"`) and a day group
 * (`group.key === "day"`). A swing-group row MUST open the swing engine; a
 * day-group row MUST open the day engine; otherwise the wrong-engine bug from
 * B30 Phase 1 silently returns on the "both" surface.
 *
 * Single-mode views use `group.key === "swing-only"` or `"day-only"`; those
 * also resolve unambiguously by prefix.
 *
 * The defensive `fallback` parameter covers a hypothetical future render group
 * whose key does not start with `"swing"` or `"day"` (no such group exists
 * today — see `SetupRenderGroup.key` in `scanner-page-client.tsx`). Pass the
 * top-level `resolveEvidenceTradingMode(scannerSetupMode)` as the fallback so
 * future additions degrade to the canonical "both → swing" rule.
 *
 * @example
 *   resolveSetupRowTradingMode("swing", "swing")       // → "swing"
 *   resolveSetupRowTradingMode("swing-only", "swing")  // → "swing"
 *   resolveSetupRowTradingMode("day", "swing")         // → "day"   (overrides "both → swing" for day-group rows)
 *   resolveSetupRowTradingMode("day-only", "day")      // → "day"
 */
export function resolveSetupRowTradingMode(
  groupKey: string,
  fallback: EvidenceTradingMode
): EvidenceTradingMode {
  if (groupKey.startsWith("swing")) return "swing";
  if (groupKey.startsWith("day")) return "day";
  return fallback;
}
