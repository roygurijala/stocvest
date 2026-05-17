"use client";

import Link from "next/link";
import type { ScenarioExecutionTier } from "@/lib/scenario/scenario-readiness";
import type { ScenarioBuilderDrillDown } from "@/lib/scenario/scenario-builder-drill-down";
import { typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  drillDown: ScenarioBuilderDrillDown;
  executionTier: ScenarioExecutionTier;
  onClose: () => void;
};

const linkClass =
  "border-0 bg-transparent p-0 text-left text-sm font-semibold underline-offset-2 hover:underline";

export function ScenarioPreviewDrillDown({ drillDown, executionTier, onClose }: Props) {
  const { colors } = useTheme();
  const showSession = executionTier === "session_limited";
  const onSignals = drillDown.surface === "signals";
  const inEvidence = drillDown.surface === "evidence";

  const runThenClose = (fn?: () => void) => {
    onClose();
    fn?.();
  };

  const actions: { id: string; label: string; hint: string; onClick?: () => void; href?: string }[] = [];

  if (onSignals && drillDown.onViewLayerBreakdown) {
    actions.push({
      id: "layers",
      label: "View layer breakdown",
      hint: "six-layer stack on this page",
      onClick: () => runThenClose(drillDown.onViewLayerBreakdown)
    });
  } else if (drillDown.signalsHref) {
    actions.push({
      id: "layers",
      label: "View layer breakdown on Signals",
      hint: "alignment and confirmations",
      href: drillDown.signalsHref
    });
  }

  if (showSession) {
    if (onSignals && drillDown.onViewSessionContext) {
      actions.push({
        id: "session",
        label: "View session & gap context",
        hint: "why execution planning is limited",
        onClick: () => runThenClose(drillDown.onViewSessionContext)
      });
    } else if (drillDown.signalsHref) {
      actions.push({
        id: "session",
        label: "View session context on Signals",
        hint: "gap and market phase",
        href: drillDown.signalsHref
      });
    }
  }

  if (!inEvidence) {
    if (onSignals && drillDown.onOpenEvidence) {
      actions.push({
        id: "evidence",
        label: "Open full evidence",
        hint: "layer detail + reference context",
        onClick: () => runThenClose(drillDown.onOpenEvidence)
      });
    } else if (drillDown.signalsHref) {
      actions.push({
        id: "evidence",
        label: "Open symbol on Signals",
        hint: "evidence, layers, and setup read",
        href: drillDown.signalsHref
      });
    }
  } else {
    actions.push({
      id: "layers-evidence",
      label: "Review layers in this evidence view",
      hint: "scroll the card below",
      onClick: () => onClose()
    });
  }

  if (actions.length === 0) {
    if (onSignals) {
      return (
        <section data-testid="scenario-preview-drill-down">
          <p style={{ margin: 0, fontWeight: 600, color: colors.text, fontSize: typography.scale.sm }}>
            Understand this setup
          </p>
          <p className="m-0 mt-2 text-sm leading-snug" style={{ color: colors.textMuted }}>
            Use the layer breakdown, setup read, and evidence on this page for full detail.
          </p>
        </section>
      );
    }
    return null;
  }

  return (
    <section data-testid="scenario-preview-drill-down">
      <p style={{ margin: 0, fontWeight: 600, color: colors.text, fontSize: typography.scale.sm }}>
        Understand this setup
      </p>
      <ul className="m-0 mt-2 list-none space-y-2 p-0">
        {actions.map((a) => (
          <li key={a.id} className="text-sm leading-snug">
            {a.href ? (
              <Link
                href={a.href}
                className={`${linkClass} no-underline hover:underline`}
                style={{ color: colors.accent }}
                data-testid={`scenario-preview-action-${a.id}`}
                onClick={() => onClose()}
              >
                {a.label}
              </Link>
            ) : (
              <button
                type="button"
                className={linkClass}
                style={{ color: colors.accent, cursor: "pointer" }}
                data-testid={`scenario-preview-action-${a.id}`}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            )}
            <span style={{ color: colors.textMuted }}> — {a.hint}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
