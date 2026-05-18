"use client";

import { useEffect, useState } from "react";
import { fetchAdminSystemBehavior, type AdminSystemBehaviorResponse } from "@/lib/api/admin-system-behavior";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  mode?: "swing" | "day";
};

/** Platform-wide maturation telemetry (ModeTimelineIndex GSI). */
export function AdminSetupBehaviorSnapshot({ mode = "swing" }: Props) {
  const { colors } = useTheme();
  const [data, setData] = useState<AdminSystemBehaviorResponse | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setData(undefined);
    void fetchAdminSystemBehavior(mode, 30).then((res) => {
      if (active) setData(res);
    });
    return () => {
      active = false;
    };
  }, [mode]);

  if (data === undefined) {
    return (
      <p className="m-0 text-sm" style={{ color: colors.textMuted }} data-testid="admin-setup-behavior-loading">
        Loading platform setup behavior…
      </p>
    );
  }
  if (data === null) {
    return (
      <p className="m-0 text-sm" style={{ color: colors.textMuted }} data-testid="admin-setup-behavior-error">
        Platform setup behavior unavailable (check deploy, GSI, or admin gate).
      </p>
    );
  }

  const cont = data.outcome_stats.setup_continuation_rate;

  return (
    <div
      data-testid="admin-setup-behavior-snapshot"
      style={{
        display: "grid",
        gap: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
        Platform setup behavior ({mode}, {data.days ?? 30}d)
      </p>
      <p className="m-0 text-sm" style={{ color: colors.text }}>
        {data.transition_count} transitions · {data.unique_users ?? data.outcome_stats.unique_users ?? 0} users ·{" "}
        {data.unique_symbols ?? data.outcome_stats.unique_symbols ?? 0} symbols · {data.outcome_stats.total_events}{" "}
        session pairs
      </p>
      <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
        Alignment held:{" "}
        {data.outcome_stats.alignment_held_rate != null ? `${data.outcome_stats.alignment_held_rate}%` : "—"}
        {cont != null ? ` · Setup continuation (price + alignment): ${cont}%` : null}
      </p>
      {data.note ? (
        <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
          {data.note}
        </p>
      ) : null}
    </div>
  );
}
