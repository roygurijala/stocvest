import { apiFetch } from "@/lib/api/client";
import type { CreateJournalEntryRequest, JournalAnalyticsPayload, JournalEntryPayload } from "@/lib/api/contracts";

export type { CreateJournalEntryRequest } from "@/lib/api/contracts";

export async function fetchJournalEntries(params?: { status?: "open" | "closed" | "all"; limit?: number }): Promise<JournalEntryPayload[]> {
  const qs = new URLSearchParams();
  if (params?.status && params.status !== "all") qs.set("status", params.status);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return (await apiFetch<JournalEntryPayload[]>(`/v1/journal/entries${suffix}`)) || [];
}

export async function fetchJournalAnalytics(): Promise<JournalAnalyticsPayload | null> {
  return apiFetch<JournalAnalyticsPayload>("/v1/journal/analytics");
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
