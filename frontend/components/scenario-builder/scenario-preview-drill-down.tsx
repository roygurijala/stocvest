"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, Layers } from "lucide-react";
import { ScenarioPreviewInlinePanels } from "@/components/scenario-builder/scenario-preview-inline-panels";
import { ScenarioPreviewWhyNot } from "@/components/scenario-builder/scenario-preview-why-not";
import type { ScenarioExecutionTier, ScenarioWhyNotItem } from "@/lib/scenario/scenario-readiness";
import type { ScenarioBuilderDrillDown } from "@/lib/scenario/scenario-builder-drill-down";
import type { ScenarioPreviewPanelData } from "@/lib/scenario/scenario-preview-panels";
import { borderRadius } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  drillDown: ScenarioBuilderDrillDown;
  executionTier: ScenarioExecutionTier;
  whyNotItems?: ScenarioWhyNotItem[];
  previewPanels: ScenarioPreviewPanelData;
  onClose: () => void;
};

const linkClass =
  "border-0 bg-transparent p-0 text-left text-xs font-semibold underline-offset-2 hover:underline";

function collapsedTeaser(items: ScenarioWhyNotItem[]): string {
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
  bits.push("Layer breakdown & session context below");
  return bits.join(" · ");
}

export function ScenarioPreviewDrillDown({
  drillDown,
  executionTier: _executionTier,
  whyNotItems = [],
  previewPanels,
  onClose
}: Props) {
  const { colors } = useTheme();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const inEvidence = drillDown.surface === "evidence";

  const runThenClose = (fn?: () => void) => {
    onClose();
    fn?.();
  };

  const showEvidenceLink = !inEvidence;
  const evidenceHref = drillDown.evidenceHref ?? previewPanels.evidenceHref;

  const teaser = collapsedTeaser(whyNotItems);

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
              ? "Collapse when you are done reviewing blockers and context."
              : teaser}
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

          <ScenarioPreviewInlinePanels panels={previewPanels} />

          {showEvidenceLink ? (
            <section className="mt-3">
              <p
                className="m-0 text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: colors.textMuted }}
              >
                Dive deeper (advanced view)
              </p>
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                <li>
                  {drillDown.onOpenEvidence ? (
                    <button
                      type="button"
                      className={linkClass}
                      style={{ color: colors.accent, cursor: "pointer" }}
                      data-testid="scenario-preview-action-evidence"
                      onClick={() => runThenClose(drillDown.onOpenEvidence)}
                    >
                      Open full evidence
                    </button>
                  ) : (
                    <Link
                      href={evidenceHref}
                      className={`${linkClass} no-underline hover:underline`}
                      style={{ color: colors.accent }}
                      data-testid="scenario-preview-action-evidence"
                      onClick={() => onClose()}
                    >
                      Open full evidence
                    </Link>
                  )}
                </li>
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}