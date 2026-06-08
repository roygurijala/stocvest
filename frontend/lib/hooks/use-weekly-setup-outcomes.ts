/**
 * `useWeeklySetupOutcomes()` — the brief's "setup follow-through" recap.
 *
 * Wraps the setup-outcomes analytics endpoint, which intentionally reports
 * *follow-through* (alignment-held / continuation rates) with a disclaimer and a
 * `building_dataset` flag rather than a trade "win rate" — keeping the brief
 * consistent with the product's no-performance-promise posture. Gated by
 * `enabled` so it only runs on the weekend / after-hours preparation surface.
 */
import { useEffect, useState } from "react";
import { fetchSetupOutcomes, type SetupOutcomesResponse } from "@/lib/api/setup-outcomes";

export function useWeeklySetupOutcomes(
  enabled: boolean,
  mode: "swing" | "day" = "swing",
  days = 30
): SetupOutcomesResponse | null {
  const [data, setData] = useState<SetupOutcomesResponse | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let cancelled = false;
    void fetchSetupOutcomes(mode, days).then((res) => {
      if (!cancelled) setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, mode, days]);

  return data;
}
