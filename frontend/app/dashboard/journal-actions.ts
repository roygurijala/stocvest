"use server";

import { createJournalEntry } from "@/lib/api/journal";

export interface JournalActionState {
  error?: string;
  success?: string;
}

export async function createJournalEntryAction(
  _prev: JournalActionState,
  formData: FormData
): Promise<JournalActionState> {
  try {
    const symbol = String(formData.get("symbol") || "").trim().toUpperCase();
    const quantity = Number(formData.get("quantity"));
    if (!symbol) {
      return { error: "Symbol is required." };
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: "Quantity must be a positive number." };
    }

    await createJournalEntry({
      entry_id: `j-${Date.now()}`,
      symbol,
      opening_side: String(formData.get("opening_side") || "buy") === "sell" ? "sell" : "buy",
      quantity,
      is_day_trade: String(formData.get("is_day_trade") || "false") === "true",
      entry_notes: String(formData.get("entry_notes") || "").trim() || undefined,
      strategy_tags: String(formData.get("strategy_tags") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    return { success: "Journal entry added." };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown journal error.";
    return { error: message };
  }
}
