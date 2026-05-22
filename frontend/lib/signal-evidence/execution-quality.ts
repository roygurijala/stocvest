/**
 * Soft execution-quality metrics from composite APIs (Phase 2 — informational only).
 */

export type ExecutionQualityBand = "strong" | "moderate" | "weak" | "unavailable";

export type ExecutionQualityPayload = {
  band: ExecutionQualityBand;
  stop_atr_ratio: number | null;
  level_path: {
    has_reference_stop: boolean;
    has_reference_target: boolean;
    structure_complete: boolean;
  };
  volume_ratio: number | null;
  volume_band: string | null;
  risk_reward: number | null;
  session_window: {
    in_swing_ledger_window?: boolean;
    in_day_ledger_window?: boolean;
  };
  setup_tags: string[];
  disclaimer: string;
};

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export function parseExecutionQuality(body: Record<string, unknown>): ExecutionQualityPayload | null {
  const raw = body.execution_quality;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const bandRaw = String(o.band ?? "").trim().toLowerCase();
  const band: ExecutionQualityBand =
    bandRaw === "strong" || bandRaw === "moderate" || bandRaw === "weak" || bandRaw === "unavailable"
      ? bandRaw
      : "unavailable";
  const lp = o.level_path;
  const level_path =
    lp && typeof lp === "object"
      ? {
          has_reference_stop: Boolean((lp as Record<string, unknown>).has_reference_stop),
          has_reference_target: Boolean((lp as Record<string, unknown>).has_reference_target),
          structure_complete: Boolean((lp as Record<string, unknown>).structure_complete)
        }
      : {
          has_reference_stop: false,
          has_reference_target: false,
          structure_complete: false
        };
  const sw = o.session_window;
  const session_window =
    sw && typeof sw === "object"
      ? {
          in_swing_ledger_window: Boolean((sw as Record<string, unknown>).in_swing_ledger_window),
          in_day_ledger_window: Boolean((sw as Record<string, unknown>).in_day_ledger_window)
        }
      : {};
  const tagsRaw = o.setup_tags;
  const setup_tags = Array.isArray(tagsRaw) ? tagsRaw.map((t) => String(t)) : [];
  return {
    band,
    stop_atr_ratio: numOrNull(o.stop_atr_ratio),
    level_path,
    volume_ratio: numOrNull(o.volume_ratio),
    volume_band: typeof o.volume_band === "string" ? o.volume_band : null,
    risk_reward: numOrNull(o.risk_reward),
    session_window,
    setup_tags,
    disclaimer:
      typeof o.disclaimer === "string"
        ? o.disclaimer
        : "Execution quality is informational only — it does not change actionable verdicts."
  };
}

const BAND_LABEL: Record<ExecutionQualityBand, string> = {
  strong: "Strong execution context",
  moderate: "Moderate execution context",
  weak: "Weak execution context",
  unavailable: "Execution context unavailable"
};

export function executionQualitySummaryLine(eq: ExecutionQualityPayload): string {
  const parts: string[] = [BAND_LABEL[eq.band]];
  if (eq.stop_atr_ratio != null) {
    parts.push(`stop ${eq.stop_atr_ratio.toFixed(1)}× ATR`);
  }
  if (eq.volume_band) {
    parts.push(`volume ${eq.volume_band}`);
  }
  if (!eq.level_path.structure_complete) {
    parts.push("reference levels incomplete");
  }
  return parts.join(" · ");
}
