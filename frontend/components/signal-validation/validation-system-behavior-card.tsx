"use client";

import Link from "next/link";
import type { PublicSignal } from "@/lib/api/public-signals";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  rows: PublicSignal[] | null;
  tab: "swing" | "day";
};

/**
 * High-level system behavior summary from the loaded ledger (observational, not P&amp;L).
 */
export function ValidationSystemBehaviorCard({ rows, tab }: Props) {
  const { colors } = useTheme();
  const list = rows ?? [];
  const observed = list.length;
  const resolved = list.filter((r) => {
    const o = r.outcome_1d ?? r.outcome_1h;
    return o === "correct" || o === "incorrect" || o === "neutral";
  }).length;
  const pending = observed - resolved;

  return (
    <section
      className={surfaceGlowClassName}
      data-testid="validation-system-behavior"
      style={{
        marginBottom: spacing[4],
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
        System behavior ({tab === "swing" ? "Swing" : "Day"})
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: colors.text }}>
            {observed}
          </p>
          <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
            Setups observed in this ledger window
          </p>
        </div>
        <div>
          <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: colors.bullish }}>
            {resolved}
          </p>
          <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
            Resolved with a measured outcome
          </p>
        </div>
        <div>
          <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: "#f59e0b" }}>
            {pending}
          </p>
          <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
            Still pending evaluation
          </p>
        </div>
      </div>
      <p className="m-0 mt-3 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
        For layer alignment and maturation, use{" "}
        <Link href="/dashboard/watchlists" className="font-semibold hover:underline" style={{ color: colors.accent }}>
          Watchlist
        </Link>{" "}
        and{" "}
        <Link
          href={`/dashboard/signals?trading_mode=${tab}`}
          className="font-semibold hover:underline"
          style={{ color: colors.accent }}
        >
          Signals
        </Link>
        . Switch to Historical accuracy for stratified hit rates.
      </p>
    </section>
  );
}
