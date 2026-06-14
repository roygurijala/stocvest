"use client";

import Link from "next/link";
import type { SetupOutcomesResponse } from "@/lib/api/setup-outcomes";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  data: SetupOutcomesResponse;
};

/** User-facing system behavior summary from setup outcome stats (not ledger win rate). */
export function SetupSystemBehaviorCard({ data }: Props) {
  const { colors } = useTheme();
  const { stats } = data;
  const held = stats.by_kind.alignment_held ?? 0;
  const weakened = stats.by_kind.alignment_weakened ?? 0;

  return (
    <section
      className={surfaceGlowClassName}
      data-testid="setup-system-behavior"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <p
        className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: colors.textMuted }}
      >
        System behavior ({data.mode === "swing" ? "Swing" : "Day"})
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: colors.text }}>
            {stats.total_events}
          </p>
          <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
            Session pairs on your watchlist
          </p>
        </div>
        <div>
          <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: colors.bullish }}>
            {held}
          </p>
          <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
            Alignment held into next session
          </p>
        </div>
        <div>
          <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: "#f59e0b" }}>
            {weakened}
          </p>
          <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
            Alignment weakened next session
          </p>
        </div>
      </div>
      <p className="m-0 mt-3 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
        Per-symbol timelines live on{" "}
        <Link href="/dashboard/setup-evolution" className="font-semibold hover:underline" style={{ color: colors.accent }}>
          Setup evolution
        </Link>
        .
      </p>
    </section>
  );
}
