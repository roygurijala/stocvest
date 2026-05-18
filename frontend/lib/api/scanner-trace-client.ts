import { browserApiFetch } from "@/lib/api/browser-api-fetch";
import { parseScannerSynthesis, type ScannerSynthesis } from "@/lib/scanner-synthesis";
import {
  parseEvaluationTraceFromResponse,
  type ScannerEvaluationTraceRow
} from "@/lib/scanner-setups-response";

export type ScannerTraceResponse = {
  session_date_et: string;
  mode: string;
  evaluation_trace: ScannerEvaluationTraceRow[];
  synthesis?: unknown;
  disclaimer: string;
};

export type ScannerTraceFetchResult = {
  rows: ScannerEvaluationTraceRow[];
  synthesis: ScannerSynthesis | null;
};

/** Browser-only persisted scanner trace (cookie session; no `next/headers`). */
export async function fetchScannerEvaluationTraceClient(
  mode: "day" | "swing" | "both" = "both",
  limit = 20
): Promise<ScannerEvaluationTraceRow[]> {
  const result = await fetchScannerTraceBundleClient(mode, limit);
  return result.rows;
}

export async function fetchScannerTraceBundleClient(
  mode: "day" | "swing" | "both" = "both",
  limit = 20
): Promise<ScannerTraceFetchResult> {
  const q = new URLSearchParams({ mode, limit: String(limit) });
  const data = await browserApiFetch<ScannerTraceResponse>(`/v1/signals/scanner-trace?${q.toString()}`);
  return {
    rows: parseEvaluationTraceFromResponse(data?.evaluation_trace),
    synthesis: parseScannerSynthesis(data?.synthesis)
  };
}
