import { browserApiFetch } from "@/lib/api/browser-api-fetch";
import {
  parseEvaluationTraceFromResponse,
  type ScannerEvaluationTraceRow
} from "@/lib/scanner-setups-response";

export type ScannerTraceResponse = {
  session_date_et: string;
  mode: string;
  evaluation_trace: ScannerEvaluationTraceRow[];
  disclaimer: string;
};

/** Browser-only persisted scanner trace (cookie session; no `next/headers`). */
export async function fetchScannerEvaluationTraceClient(
  mode: "day" | "swing" | "both" = "both",
  limit = 20
): Promise<ScannerEvaluationTraceRow[]> {
  const q = new URLSearchParams({ mode, limit: String(limit) });
  const data = await browserApiFetch<ScannerTraceResponse>(`/v1/signals/scanner-trace?${q.toString()}`);
  return parseEvaluationTraceFromResponse(data?.evaluation_trace);
}
