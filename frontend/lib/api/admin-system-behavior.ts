"use client";

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

export type AdminSystemBehaviorResponse = {
  mode: "swing" | "day";
  days?: number;
  scope: string;
  transition_count: number;
  unique_users?: number;
  unique_symbols?: number;
  evolution_summary: {
    days_tracked: number;
    latest_state: string | null;
    transition_counts: Record<string, number>;
  };
  outcome_stats: {
    total_events: number;
    alignment_held_rate: number | null;
    setup_continuation_rate?: number | null;
    unique_users?: number;
    unique_symbols?: number;
  };
  note?: string | null;
};

export async function fetchAdminSystemBehavior(
  mode: "swing" | "day" = "swing",
  days = 30
): Promise<AdminSystemBehaviorResponse | null> {
  const qs = new URLSearchParams({ mode, days: String(days) }).toString();
  try {
    const res = await fetch(`/api/stocvest/admin/system-behavior?${qs}`, {
      cache: "no-store",
      credentials: "same-origin"
    });
    surfaceAuthErrorIfAny(res);
    if (!res.ok) return null;
    return (await res.json()) as AdminSystemBehaviorResponse;
  } catch {
    return null;
  }
}
