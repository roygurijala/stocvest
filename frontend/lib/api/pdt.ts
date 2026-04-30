import { apiFetch } from "@/lib/api/client";

export interface PDTAssessmentPayload {
  pdt_exempt: boolean;
  day_trades_in_window: number;
  current_day_trade_count: number;
  max_non_exempt: number;
  rolling_business_days: number;
  allow_next_day_trade: boolean;
  warn_near_limit: boolean;
  at_limit: boolean;
  days_until_reset: number;
}

export interface PDTStatusPayload {
  user_id: string;
  assessment: PDTAssessmentPayload;
}

export async function fetchPdtStatus(): Promise<PDTStatusPayload | null> {
  return apiFetch<PDTStatusPayload>("/v1/pdt/status");
}
