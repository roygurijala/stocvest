"use client";

import Link from "next/link";
import { HistoricalValidationPanel } from "@/components/historical-validation-panel";
import { spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { usePublishAssistantContext } from "@/lib/assistant/context";

/** Admin-only D2 stratified validation (SignalHistory-backed). End users use Setup outcomes. */
export function AdminHistoricalValidationPageClient() {
  const { colors } = useTheme();
  usePublishAssistantContext({ page: "dashboard/admin/historical-validation" });

  return (
    <section style={{ display: "grid", gap: spacing[4] }} data-testid="admin-historical-validation-page">
      <header>
        <h1 className="m-0 text-2xl font-semibold" style={{ color: colors.text }}>
          Historical validation (D2)
        </h1>
        <p className="m-0 mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: colors.textMuted }}>
          Stratified directional accuracy from the SignalHistory ledger — for parameter tuning, weight proposals,
          and operator review. Not shown to customers as a trade-performance surface. User-facing setup behavior
          lives on{" "}
          <Link href="/dashboard/setup-outcomes" className="font-medium hover:underline" style={{ color: colors.accent }}>
            Setup outcomes
          </Link>{" "}
          and{" "}
          <Link href="/dashboard/setup-evolution" className="font-medium hover:underline" style={{ color: colors.accent }}>
            Setup evolution
          </Link>
          .
        </p>
      </header>
      <HistoricalValidationPanel />
    </section>
  );
}
