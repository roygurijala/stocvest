"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, Layers } from "lucide-react";
import { ScenarioPreviewWhyNot } from "@/components/scenario-builder/scenario-preview-why-not";
import type { ScenarioExecutionTier, ScenarioWhyNotItem } from "@/lib/scenario/scenario-readiness";
import type { ScenarioBuilderDrillDown } from "@/lib/scenario/scenario-builder-drill-down";
import { borderRadius, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  drillDown: ScenarioBuilderDrillDown;
  executionTier: ScenarioExecutionTier;
  whyNotItems?: ScenarioWhyNotItem[];
  onClose: () => void;
};

const linkClass =
  "border-0 bg-transparent p-0 text-left text-xs font-semibold underline-offset-2 hover:underline";

function collapsedTeaser(items: ScenarioWhyNotItem[], actionCount: number): string {
  const bits: string[] = [];
  if (items.length > 0) {
    const missing = items.find((i) => i.kind === "missing_confirmations");
    if (missing && missing.kind === "missing_confirmations") {
      const names = missing.layers.slice(0, 3).join(", ");
      const extra = missing.layers.length > 3 ? ` +${missing.layers.length - 3}` : "";
      bits.push(`Missing: ${names}${extra}`);
    } else {
      bits.push(`${items.length} blocker${items.length > 1 ? "s" : ""}`);
    }
  }
  if (actionCount > 0) {
    bits.push(`${actionCount} link${actionCount > 1 ? "s" : ""} to Signals`);
  }
  return bits.join(" · ");
}

export function ScenarioPreviewDrillDown({
  drillDown,
  executionTier,
  whyNotItems = [],
  onClose
}: Props) {
  const { colors } = useTheme();
  const panelId = useId();
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

  const teaser = collapsedTeaser(whyNotItems, actions.length);
  const hasBody = whyNotItems.length > 0 || actions.length > 0;

  if (!hasBody && !onSignals) return null;

  const accent = colors.accent;
  const shellBg = `color-mix(in srgb, ${accent} 10%, ${colors.surfaceMuted})`;
  const shellBorder = `color-mix(in srgb, ${accent} 45%, ${colors.border})`;

  return (
    <div
      data-testid="scenario-preview-drill-down"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${shellBorder}`,
        background: shellBg,
        overflow: "hidden"
      }}
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 border-0 p-3 text-left transition-colors"
        style={{
          cursor: "pointer",
          background: open ? `color-mix(in srgb, ${accent} 6%, transparent)` : "transparent"
        }}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="scenario-preview-drill-down-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          style={{
            background: `color-mix(in srgb, ${accent} 18%, ${colors.surface})`,
            border: `1px solid ${shellBorder}`,
            color: accent
          }}
          aria-hidden
        >
          <Layers size={16} strokeWidth={2.25} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className="text-sm font-semibold"
              style={{ color: colors.text, letterSpacing: "0.01em" }}
            >
              Understand this setup
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{
                color: accent,
                background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`
              }}
              data-testid="scenario-preview-drill-down-badge"
            >
              {open ? "Expanded" : "Expand"}
            </span>
          </span>
          <span
            className="mt-1 block text-xs leading-snug"
            style={{ color: open ? colors.textMuted : colors.text }}
            data-testid="scenario-preview-drill-down-hint"
          >
            {open
              ? "Collapse when you are done reviewing blockers and links."
              : teaser
                ? teaser
                : "Tap to see why the sheet is limited and jump to Signals for layers & evidence."}
          </span>
        </span>
        <span
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{
            background: colors.surface,
            border: `1px solid ${shellBorder}`,
            color: accent
          }}
          aria-hidden
        >
          <ChevronDown
            size={18}
            strokeWidth={2.5}
            style={{
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 180ms ease"
            }}
          />
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="border-t px-3 pb-3 pt-2"
          style={{
            borderColor: shellBorder,
            background: `color-mix(in srgb, ${colors.surface} 55%, transparent)`
          }}
          data-testid="scenario-preview-drill-down-panel"
        >
          {whyNotItems.length > 0 ? (
            <section data-testid="scenario-preview-why-not" className="mb-3">
              <p className="m-0 text-sm font-semibold" style={{ color: colors.text }}>
                Why not?
              </p>
              <div className="mt-2">
                <ScenarioPreviewWhyNot items={whyNotItems} />
              </div>
            </section>
          ) : null}

          {actions.length > 0 ? (
            <section>
              <p
                className="m-0 text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: colors.textMuted }}
              >
                Go deeper on Signals
              </p>
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                {actions.map((a) => (
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
                ))}
              </ul>
            </section>
          ) : whyNotItems.length === 0 ? (
            <p className="m-0 text-xs leading-snug" style={{ color: colors.textMuted }}>
              Use the layer breakdown, setup read, and evidence on this page.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
