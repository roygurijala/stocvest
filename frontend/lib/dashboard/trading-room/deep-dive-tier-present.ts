/**
 * ADR-003 UX-D4 — Deep Dive tier model (pure).
 *
 * Decision block (plain summary + geometry strip) stays above the fold.
 * Evidence panels live behind Setup | Layers | Chart | Context tabs.
 */

export const DEEP_DIVE_EVIDENCE_TABS = ["setup", "layers", "chart", "context"] as const;

export type DeepDiveEvidenceTab = (typeof DEEP_DIVE_EVIDENCE_TABS)[number];

/** Default evidence tab — Setup holds execution read and plan tools. */
export const DEFAULT_DEEP_DIVE_EVIDENCE_TAB: DeepDiveEvidenceTab = "setup";

export function isDeepDiveEvidenceTab(value: string): value is DeepDiveEvidenceTab {
  return (DEEP_DIVE_EVIDENCE_TABS as readonly string[]).includes(value);
}

export const DEEP_DIVE_EVIDENCE_TAB_LABELS: Record<DeepDiveEvidenceTab, string> = {
  setup: "Setup",
  layers: "Layers",
  chart: "Chart",
  context: "Context"
};

/** Context tab sections collapsed by default (ADR UX-D4). */
export const DEEP_DIVE_CONTEXT_COLLAPSED_DEFAULT = true;
