"use client";

import Link from "next/link";

import { EnvironmentPolicyBacktestPanel } from "@/components/admin/environment-policy-backtest-panel";
import { ProductKpiPanel } from "@/components/admin/product-kpi-panel";
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
          Product KPI is the default scorecard (qualified actionable only). Expand internal diagnostics
          for full stratification or VIX policy replay. PUBLIC mirrors include decision state, VIX audit,
          and capture kind. Run{" "}
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
          padding: spacing[4],
          borderRadius: 12,
          border: `1px solid ${colors.accent}`,
          boxShadow: `0 0 0 1px ${colors.accent}22`
        }}
      >
        <ProductKpiPanel adminScope="public" defaultWindowDays={90} />
      </div>

      <details
        style={{
          padding: spacing[4],
          borderRadius: 12,
          border: `1px solid ${colors.border}`
        }}
      >
        <summary
          className="cursor-pointer text-sm font-medium"
          style={{ color: colors.textMuted }}
        >
          Internal diagnostics — full D2 stratification (all capture kinds)
        </summary>
        <div style={{ marginTop: spacing[4] }}>
          <HistoricalValidationPanel
            ledgerScope="admin-public"
            adminScope="public"
            windowOptions={[30, 60, 90, 180]}
          />
        </div>
      </details>

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
