import { apiFetch } from "@/lib/api/client";
import type { JournalEntryPayload } from "@/lib/api/contracts";

export interface CreateJournalEntryRequest {
  entry_id: string;
  symbol: string;
  opening_side: "buy" | "sell";
  quantity: number;
  is_day_trade: boolean;
  entry_notes?: string;
  strategy_tags?: string[];
  broker_order_ids?: string[];
}

export async function fetchJournalEntries(): Promise<JournalEntryPayload[]> {
  return (await apiFetch<JournalEntryPayload[]>("/v1/journal/entries")) || [];
}

export async function createJournalEntry(
  payload: CreateJournalEntryRequest
): Promise<JournalEntryPayload> {
  const result = await apiFetch<JournalEntryPayload>("/v1/journal/entries", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  if (!result) {
    throw new Error("Service temporarily unavailable. Please try again.");
  }
  return result;
}
