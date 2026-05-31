"use client";

import Link from "next/link";

import { EnvironmentPolicyBacktestPanel } from "@/components/admin/environment-policy-backtest-panel";
import { HistoricalValidationPanel } from "@/components/historical-validation-panel";
import { spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { usePublishAssistantContext } from "@/lib/assistant/context";

/**
 * Admin desk backtesting — platform success rate (PUBLIC ledger) + VIX policy grid replay.
 */
export function AdminDeskBacktestPageClient() {
  const { colors } = useTheme();
  usePublishAssistantContext({ page: "dashboard/admin/backtesting" });

  return (
    <section style={{ display: "grid", gap: spacing[6] }} data-testid="admin-desk-backtest-page">
      <header>
        <h1 className="m-0 text-2xl font-semibold" style={{ color: colors.text }}>
          Desk backtesting
        </h1>
        <p className="m-0 mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: colors.textMuted }}>
          Measure real product success from the platform signal ledger (PUBLIC mirrors of every capture)
          and tune VIX environment enter bands. New captures automatically write a de-identified PUBLIC
          row with decision state, VIX audit, and capture kind. Run{" "}
          <code className="text-xs">scripts/backfill_platform_backtest_mirror.py</code> once to mirror
          existing history. Per-user tuning detail remains on{" "}
          <Link
            href="/dashboard/admin/historical-validation"
            className="font-medium hover:underline"
            style={{ color: colors.accent }}
          >
            Historical validation
          </Link>
          .
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gap: spacing[5],
          padding: spacing[4],
          borderRadius: 12,
          border: `1px solid ${colors.border}`
        }}
      >
        <HistoricalValidationPanel
          ledgerScope="admin-public"
          adminScope="public"
          windowOptions={[30, 60, 90, 180]}
        />
      </div>

      <div
        style={{
          padding: spacing[4],
          borderRadius: 12,
          border: `1px solid ${colors.border}`
        }}
      >
        <EnvironmentPolicyBacktestPanel />
      </div>
    </section>
  );
}
