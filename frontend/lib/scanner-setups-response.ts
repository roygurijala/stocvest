/** Parse day/swing setups API responses (legacy array or v2 bundle). */

import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { parseScannerSynthesis, type ScannerSynthesis } from "@/lib/scanner-synthesis";

export type ScannerEvaluationTraceRow = {
  symbol: string;
  desk: "swing" | "day";
  gate: string;
  detail: string;
  outcome: "did_not_qualify";
  score?: number;
  min_score?: number;
  margin_pct?: number;
};

export type ScannerSetupsDeskBundle = {
  qualifying: IntradaySetupPayload[];
  nearQualification: IntradaySetupPayload[];
  evaluationTrace: ScannerEvaluationTraceRow[];
  synthesis: ScannerSynthesis | null;
};

export function isSwingSetupRow(row: IntradaySetupPayload): boolean {
  return row.scanner_mode === "swing_daily";
}

export function parseEvaluationTraceFromResponse(data: unknown): ScannerEvaluationTraceRow[] {
  return parseEvaluationTrace(data);
}

function parseEvaluationTrace(data: unknown): ScannerEvaluationTraceRow[] {
  if (!Array.isArray(data)) return [];
  const out: ScannerEvaluationTraceRow[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const symbol = String(o.symbol ?? "").trim().toUpperCase();
    const desk = o.desk === "swing" ? "swing" : o.desk === "day" ? "day" : null;
    const gate = String(o.gate ?? "").trim();
    const detail = String(o.detail ?? "").trim();
    if (!symbol || !desk || !gate || !detail) continue;
    out.push({
      symbol,
      desk,
      gate,
      detail,
      outcome: "did_not_qualify",
      score: typeof o.score === "number" ? o.score : undefined,
      min_score: typeof o.min_score === "number" ? o.min_score : undefined,
      margin_pct: typeof o.margin_pct === "number" ? o.margin_pct : undefined
    });
  }
  return out;
}

export function parseScannerSetupsDeskResponse(data: unknown): ScannerSetupsDeskBundle {
  if (Array.isArray(data)) {
    return {
      qualifying: data as IntradaySetupPayload[],
      nearQualification: [],
      evaluationTrace: [],
      synthesis: null
    };
  }
  if (!data || typeof data !== "object") {
    return { qualifying: [], nearQualification: [], evaluationTrace: [], synthesis: null };
  }
  const o = data as {
    qualifying?: unknown;
    near_qualification?: unknown;
    evaluation_trace?: unknown;
    synthesis?: unknown;
  };
  const qualifying = Array.isArray(o.qualifying) ? (o.qualifying as IntradaySetupPayload[]) : [];
  const nearQualification = Array.isArray(o.near_qualification)
    ? (o.near_qualification as IntradaySetupPayload[])
    : [];
  const evaluationTrace = parseEvaluationTrace(o.evaluation_trace);
  const synthesis = parseScannerSynthesis(o.synthesis);
  return { qualifying, nearQualification, evaluationTrace, synthesis };
}

export function mergeDeskSetupBundles(
  swing: ScannerSetupsDeskBundle,
  day: ScannerSetupsDeskBundle
): {
  qualifying: IntradaySetupPayload[];
  nearQualification: IntradaySetupPayload[];
  evaluationTrace: ScannerEvaluationTraceRow[];
  synthesis: ScannerSynthesis | null;
} {
  const qualifying = [...swing.qualifying, ...day.qualifying];
  const nearQualification = [...swing.nearQualification, ...day.nearQualification];
  nearQualification.sort((a, b) => b.score - a.score);
  const evaluationTrace = [...swing.evaluationTrace, ...day.evaluationTrace].slice(0, 20);
  return {
    qualifying,
    nearQualification: nearQualification.slice(0, 10),
    evaluationTrace,
    synthesis: day.synthesis
  };
}
