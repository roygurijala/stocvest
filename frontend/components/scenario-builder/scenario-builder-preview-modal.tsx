"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ScenarioPreviewDrillDown } from "@/components/scenario-builder/scenario-preview-drill-down";
import { scenarioWhyNotItems, type ScenarioReadinessResolved } from "@/lib/scenario/scenario-readiness";
import type { ScenarioBuilderDrillDown } from "@/lib/scenario/scenario-builder-drill-down";
import {
  SCENARIO_EXECUTION_UNLOCK_FOOTER,
  biasPreviewLabel,
  executionTierLabel,
  nextUnlockBullets,
  setupTierLabel
} from "@/lib/scenario/scenario-readiness-present";
import type { ScenarioInput } from "@/lib/scenario/types";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  open: boolean;
  input: ScenarioInput;
  resolved: ScenarioReadinessResolved;
  drillDown: ScenarioBuilderDrillDown;
  onClose: () => void;
};

export function ScenarioBuilderPreviewModal({ open, input, resolved, drillDown, onClose }: Props) {
  const { colors } = useTheme();
  const sym = input.symbol.trim().toUpperCase();
  const modeLabel = input.mode === "swing" ? "Swing" : "Day";
  const developing = resolved.setupTier === "developing" || resolved.capability === "building_soon";
  const whyNotItems = scenarioWhyNotItems(resolved);
  const next = nextUnlockBullets(resolved);
  const setupLabel = setupTierLabel(resolved.setupTier, resolved.aligned, resolved.total);
  const executionLabel = executionTierLabel(resolved.executionTier);
  const biasLabel = biasPreviewLabel(resolved.directionalLabel);
  const levelsLine = resolved.structurallyComplete
    ? "Reference levels: available on this symbol"
    : "Reference levels: still forming";

  const sectionStyle = {
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceMuted,
    marginBottom: spacing[3]
  };

  const statusStrong = { color: colors.text, fontWeight: 700 as const };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] grid place-items-stretch p-0 lg:place-items-center lg:p-3"
          style={{ background: "rgba(2,6,23,0.75)" }}
          onClick={onClose}
          data-testid="scenario-builder-preview-overlay"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className={`flex max-h-none min-h-0 w-full max-w-none flex-col overflow-y-auto rounded-none lg:max-h-[90vh] lg:w-[min(520px,100vw-1.5rem)] lg:rounded-xl ${surfaceGlowClassName}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface,
              border: `1px solid ${developing ? "rgba(245,158,11,0.45)" : colors.border}`,
              padding: spacing[5]
            }}
            data-testid="scenario-builder-preview-modal"
            role="dialog"
            aria-labelledby="scenario-preview-title"
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: spacing[3],
                marginBottom: spacing[4]
              }}
            >
              <div style={{ display: "grid", gap: spacing[1] }}>
                <h2
                  id="scenario-preview-title"
                  style={{
                    margin: 0,
                    color: colors.text,
                    fontSize: typography.scale.xl,
                    fontWeight: 700
                  }}
                >
                  Scenario status — {sym}
                </h2>
                <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
                  {modeLabel} · Planning preview · Not execution
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  color: colors.textMuted,
                  cursor: "pointer",
                  padding: 4
                }}
              >
                <X size={18} aria-hidden />
              </button>
            </header>

            <section style={sectionStyle} data-testid="scenario-preview-dual-status">
              <p style={{ margin: 0, fontSize: typography.scale.sm, lineHeight: 1.55, color: colors.textMuted }}>
                Setup and execution are independent — both must clear for the full planning sheet.
              </p>
              <p className="m-0 mt-3 text-sm" style={{ color: colors.text }}>
                <span style={{ color: colors.textMuted }}>Setup: </span>
                <span data-testid="scenario-preview-setup-status" style={statusStrong}>
                  {setupLabel}
                </span>
              </p>
              <p className="m-0 mt-1.5 text-sm" style={{ color: colors.text }}>
                <span style={{ color: colors.textMuted }}>Execution: </span>
                <span data-testid="scenario-preview-execution-status" style={statusStrong}>
                  {executionLabel}
                </span>
              </p>
              {resolved.maturationLabel ? (
                <p className="m-0 mt-2 text-xs" style={{ color: colors.textMuted }}>
                  Watchlist maturation: <span style={statusStrong}>{resolved.maturationLabel}</span>
                </p>
              ) : null}
            </section>

            <div className="mb-3">
              <ScenarioPreviewDrillDown
                drillDown={drillDown}
                executionTier={resolved.executionTier}
                whyNotItems={whyNotItems}
                onClose={onClose}
              />
            </div>

            <section style={sectionStyle} data-testid="scenario-preview-next">
              <p style={{ margin: 0, fontWeight: 600, color: colors.text }}>Next unlock</p>
              <ul
                style={{
                  margin: `${spacing[2]} 0 0`,
                  paddingLeft: spacing[4],
                  color: colors.textMuted,
                  fontSize: typography.scale.sm
                }}
              >
                {next.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>

            <section
              style={{
                padding: spacing[3],
                borderRadius: borderRadius.lg,
                border: `1px dashed ${colors.border}`,
                background: "transparent",
                marginBottom: spacing[3]
              }}
              data-testid="scenario-preview-qualitative"
            >
              <p
                style={{
                  margin: 0,
                  fontWeight: 600,
                  color: colors.textMuted,
                  fontSize: typography.scale.xs,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase"
                }}
              >
                Preview (non-executable)
              </p>
              <p className="m-0 mt-2 text-sm" style={{ color: colors.text }}>
                {biasLabel}
              </p>
              <p className="m-0 mt-1 text-sm" style={{ color: colors.textMuted }}>
                {levelsLine}
              </p>
            </section>

            <p
              className="m-0 text-xs leading-relaxed"
              style={{ color: colors.textMuted }}
              data-testid="scenario-preview-dual-footer"
            >
              ⓘ {SCENARIO_EXECUTION_UNLOCK_FOOTER}
            </p>

            <div style={{ marginTop: spacing[4], display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: `${spacing[2]} ${spacing[4]}`,
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`,
                  background: colors.surfaceMuted,
                  color: colors.text,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}