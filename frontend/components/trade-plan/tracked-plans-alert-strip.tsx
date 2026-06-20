"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import {
  collectThesisAlerts,
  useTrackedPlansLiveAssessment
} from "@/lib/hooks/use-tracked-plans-live-assessment";
import { useTrackedPlansList } from "@/lib/hooks/use-tracked-plans-list";
import { dashboardDeepLinkForPlan } from "@/lib/trade-plan/plans-hub-deeplink";

const DISMISS_KEY = "stocvest:tracked-plan-alerts-dismissed";

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x) => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

export function TrackedPlansAlertStrip() {
  const { colors } = useTheme();
  const { plans } = useTrackedPlansList();
  const { diffByPlanId } = useTrackedPlansLiveAssessment(plans);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  const alerts = useMemo(
    () => collectThesisAlerts(plans, diffByPlanId).filter((a) => !dismissed.has(a.plan.id)),
    [plans, diffByPlanId, dismissed]
  );

  if (alerts.length === 0) return null;

  const primary = alerts[0]!;

  return (
    <div
      data-testid="tracked-plans-alert-strip"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: spacing[2],
        padding: spacing[2],
        marginBottom: spacing[2],
        borderRadius: borderRadius.md,
        border: `1px solid ${primary.diff.thesis.status === "invalid" ? colors.bearish : colors.caution}55`,
        background: `${primary.diff.thesis.status === "invalid" ? colors.bearish : colors.caution}12`,
        fontSize: typography.scale.xs,
        lineHeight: 1.45,
        color: colors.text
      }}
    >
      <span style={{ fontWeight: 700 }}>
        {primary.plan.symbol} ({primary.plan.mode}): {primary.diff.thesis.label}
      </span>
      <span style={{ color: colors.textMuted }}>{primary.diff.thesis.hint}</span>
      {alerts.length > 1 ? (
        <span style={{ color: colors.textMuted }}>+{alerts.length - 1} more tracked plan(s)</span>
      ) : null}
      <Link
        href={dashboardDeepLinkForPlan(primary.plan.symbol, primary.plan.mode)}
        style={{ color: colors.accent, fontWeight: 600, textDecoration: "none" }}
      >
        Review
      </Link>
      <Link href="/dashboard/plans" style={{ color: colors.accent, fontWeight: 600, textDecoration: "none" }}>
        All plans
      </Link>
      <button
        type="button"
        onClick={() => {
          const next = new Set(dismissed);
          for (const a of alerts) next.add(a.plan.id);
          setDismissed(next);
          writeDismissed(next);
        }}
        style={{
          marginLeft: "auto",
          border: "none",
          background: "transparent",
          color: colors.textMuted,
          fontSize: typography.scale.xs,
          cursor: "pointer"
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
