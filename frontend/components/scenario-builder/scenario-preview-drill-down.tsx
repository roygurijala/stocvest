"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { ScenarioExecutionTier } from "@/lib/scenario/scenario-readiness";
import type { ScenarioBuilderDrillDown } from "@/lib/scenario/scenario-builder-drill-down";
import { borderRadius, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  drillDown: ScenarioBuilderDrillDown;
  executionTier: ScenarioExecutionTier;
  onClose: () => void;
};

const linkClass =
  "border-0 bg-transparent p-0 text-left text-xs font-semibold underline-offset-2 hover:underline";

export function ScenarioPreviewDrillDown({ drillDown, executionTier, onClose }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const showSession = executionTier === "session_limited";
  const onSignals = drillDown.surface === "signals";
  const inEvidence = drillDown.surface === "evidence";

  const runThenClose = (fn?: () => void) => {
    onClose();
    fn?.();
  };

  const actions: { id: string; label: string; onClick?: () => void; href?: string }[] = [];

  if (onSignals && drillDown.onViewLayerBreakdown) {
    actions.push({
      id: "layers",
      label: "View layer breakdown",
      onClick: () => runThenClose(drillDown.onViewLayerBreakdown)
    });
  } else if (drillDown.signalsHref) {
    actions.push({ id: "layers", label: "View layer breakdown on Signals", href: drillDown.signalsHref });
  }

  if (showSession) {
    if (onSignals && drillDown.onViewSessionContext) {
      actions.push({
        id: "session",
        label: "View session & gap context",
        onClick: () => runThenClose(drillDown.onViewSessionContext)
      });
    } else if (drillDown.signalsHref) {
      actions.push({ id: "session", label: "View session context on Signals", href: drillDown.signalsHref });
    }
  }

  if (!inEvidence) {
    if (onSignals && drillDown.onOpenEvidence) {
      actions.push({
        id: "evidence",
        label: "Open full evidence",
        onClick: () => runThenClose(drillDown.onOpenEvidence)
      });
    } else if (drillDown.signalsHref) {
      actions.push({ id: "evidence", label: "Open symbol on Signals", href: drillDown.signalsHref });
    }
  } else {
    actions.push({
      id: "layers-evidence",
      label: "Review layers in this evidence view",
      onClick: () => onClose()
    });
  }

  if (actions.length === 0 && !onSignals) return null;

  return (
    <div
      data-testid="scenario-preview-drill-down"
      style={{
        borderRadius: borderRadius.md,
        border: `1px dashed color-mix(in srgb, ${colors.border} 70%, transparent)`,
        background: "transparent"
      }}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left"
        style={{ color: colors.textMuted, cursor: "pointer", fontSize: typography.scale.xs }}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium uppercase tracking-wide">Understand this setup</span>
        <span className="font-normal normal-case tracking-normal opacity-80">(optional)</span>
        <ChevronDown
          size={14}
          aria-hidden
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms ease"
          }}
        />
      </button>
      {open ? (
        <ul className="m-0 list-none space-y-1.5 border-t border-dashed p-2 pt-1.5" style={{ borderColor: colors.border }}>
          {actions.length === 0 ? (
            <li className="text-xs leading-snug" style={{ color: colors.textMuted }}>
              Use the layer breakdown, setup read, and evidence on this page.
            </li>
          ) : (
            actions.map((a) => (
              <li key={a.id}>
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
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
