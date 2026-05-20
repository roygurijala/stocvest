"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CuteLoader } from "@/components/cute-loader";
import {
  layerAlignedWithBias,
  layerDirectionContextLabel,
  layerPreviewSummary,
  type ScenarioPreviewPanelData
} from "@/lib/scenario/scenario-preview-panels";
import { layerPolarity } from "@/lib/signals-page-present";
import { borderRadius } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type PanelId = "layers" | "session";

function InlineAccordion({
  id,
  title,
  summary,
  children,
  defaultOpen = false
}: {
  id: PanelId;
  title: string;
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const { colors } = useTheme();
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      data-testid={`scenario-preview-panel-${id}`}
      style={{
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        overflow: "hidden"
      }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 border-0 px-3 py-2.5 text-left"
        style={{ background: "transparent", cursor: "pointer" }}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        data-testid={`scenario-preview-panel-${id}-toggle`}
      >
        <ChevronDown
          size={16}
          aria-hidden
          style={{
            color: colors.textMuted,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 160ms ease"
          }}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            {title}
          </span>
          {!open ? (
            <span className="mt-0.5 block text-sm leading-snug" style={{ color: colors.text }}>
              {summary}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div id={panelId} className="border-t px-3 pb-3 pt-2" style={{ borderColor: colors.border }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ScenarioPreviewInlinePanels({ panels }: { panels: ScenarioPreviewPanelData }) {
  const { colors } = useTheme();
  const { layerRows, setupBias, sessionLines, loadingLayers, alignmentRatio } = panels;
  const layerSummary =
    layerRows.length > 0
      ? layerPreviewSummary(layerRows, setupBias, alignmentRatio)
      : loadingLayers
        ? "Loading layers…"
        : "Layer data not available yet";
  const sessionSummary = sessionLines[0] ?? "Session context";

  return (
    <div className="mt-3 space-y-2" data-testid="scenario-preview-inline-panels">
      <InlineAccordion id="layers" title="Layer breakdown" summary={layerSummary}>
        {loadingLayers && layerRows.length === 0 ? (
          <CuteLoader label="Loading layers" sublabel={panels.symbol} compact />
        ) : layerRows.length === 0 ? (
          <p className="m-0 text-sm leading-snug" style={{ color: colors.textMuted }}>
            Composite layers are not available for this symbol yet. Try again in a moment.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-1.5 p-0">
            {layerRows.map((row) => {
              const aligned = layerAlignedWithBias(row, setupBias);
              const unavailable = row.status === "Unavailable" || row.statusLabel?.includes("Unavailable");
              const mark = unavailable ? "—" : aligned ? "✅" : "❌";
              const direction = unavailable
                ? null
                : layerDirectionContextLabel(layerPolarity(row, setupBias));
              return (
                <li
                  key={row.key}
                  className="flex items-center gap-2 text-sm"
                  data-testid={`scenario-preview-layer-${row.key}`}
                >
                  <span aria-hidden>{mark}</span>
                  <span style={{ color: colors.text, fontWeight: 600 }}>{row.name}</span>
                  {direction ? (
                    <span style={{ color: colors.textMuted, fontWeight: 500 }}>({direction})</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </InlineAccordion>

      <InlineAccordion id="session" title="Session context" summary={sessionSummary}>
        <ul className="m-0 list-none space-y-1.5 p-0 text-sm leading-snug" style={{ color: colors.textMuted }}>
          {sessionLines.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </InlineAccordion>
    </div>
  );
}
