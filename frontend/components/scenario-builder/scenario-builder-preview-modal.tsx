"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ScenarioDetailChip } from "@/components/scenario-builder/scenario-detail-chip";
import { InfoTip } from "@/components/info-tip";
import {
  scenarioWhyNotBullets,
  type ScenarioReadinessResolved
} from "@/lib/scenario/scenario-readiness";
import {
  SCENARIO_DUAL_UNLOCK_FOOTER,
  biasPreviewLabel,
  biasPreviewTip,
  executionTierLabel,
  executionTierTip,
  layerMissingTip,
  nextUnlockBullets,
  setupTierLabel,
  setupTierTip
} from "@/lib/scenario/scenario-readiness-present";
import type { ScenarioInput } from "@/lib/scenario/types";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  open: boolean;
  input: ScenarioInput;
  resolved: ScenarioReadinessResolved;
  onClose: () => void;
};

export function ScenarioBuilderPreviewModal({ open, input, resolved, onClose }: Props) {
  const { colors } = useTheme();
  const sym = input.symbol.trim().toUpperCase();
  const modeLabel = input.mode === "swing" ? "Swing" : "Day";
  const developing = resolved.setupTier === "developing" || resolved.capability === "building_soon";
  const whyNot = scenarioWhyNotBullets(resolved, input);
  const next = nextUnlockBullets(resolved.setupTier, resolved.executionTier, resolved.aligned, resolved.total);
  const setupLabel = setupTierLabel(resolved.setupTier, resolved.aligned, resolved.total);
  const executionLabel = executionTierLabel(resolved.executionTier);
  const biasLabel = biasPreviewLabel(resolved.directionalLabel);

  const sectionStyle = {
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceMuted,
    marginBottom: spacing[3]
  };

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
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
                Setup and execution are independent — both must clear for the full planning sheet.
              </p>
              <div
                className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
                style={{ fontSize: typography.scale.sm }}
              >
                <span style={{ color: colors.textMuted }}>Setup:</span>
                <ScenarioDetailChip
                  label={setupLabel}
                  tip={setupTierTip(resolved.setupTier, resolved.aligned, resolved.total)}
                  testId="scenario-preview-setup-chip"
                />
                <span style={{ color: colors.textMuted }}>Execution:</span>
                <ScenarioDetailChip
                  label={executionLabel}
                  tip={executionTierTip(resolved.executionTier, input)}
                  testId="scenario-preview-execution-chip"
                />
              </div>
              {resolved.maturationLabel ? (
                <p className="m-0 mt-2 text-xs" style={{ color: colors.textMuted }}>
                  Watchlist maturation:{" "}
                  <ScenarioDetailChip
                    label={resolved.maturationLabel}
                    tip={`Maturation state from your watchlist evaluation cadence. Setup tier (${resolved.setupTier}) is derived from alignment and decision gates.`}
                    testId="scenario-preview-maturation-chip"
                  />
                </p>
              ) : null}
            </section>

            {whyNot.length > 0 ? (
              <section style={sectionStyle} data-testid="scenario-preview-why-not">
                <p style={{ margin: 0, fontWeight: 600, color: colors.text }}>Why not?</p>
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {whyNot.map((bullet) => (
                    <li key={bullet}>
                      <ScenarioDetailChip
                        label={bullet}
                        tip={layerMissingTip(bullet)}
                        testId={`scenario-preview-why-${bullet.slice(0, 24).replace(/\W+/g, "-")}`}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

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
                background: "transparent"
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
              <div className="mt-2 flex flex-col gap-2">
                <ScenarioDetailChip
                  label={biasLabel}
                  tip={biasPreviewTip(resolved.directionalLabel)}
                  testId="scenario-preview-bias-chip"
                />
                <ScenarioDetailChip
                  label={`Reference levels: ${resolved.structurallyComplete ? "available on this symbol" : "still forming"}`}
                  tip={
                    resolved.structurallyComplete
                      ? "Structural anchors exist on the payload. Full planning still requires setup + execution gates — prices are not shown until then."
                      : "Entry zone, stop, and targets are not yet populated. Alignment can progress while reference levels are still forming."
                  }
                  testId="scenario-preview-levels-chip"
                />
              </div>
            </section>

            <p
              className="m-0 flex flex-wrap items-start gap-1 text-xs leading-relaxed"
              style={{ color: colors.textMuted }}
              data-testid="scenario-preview-dual-footer"
            >
              <InfoTip text={SCENARIO_DUAL_UNLOCK_FOOTER} label="When scenario builder unlocks" maxWidth={320} />
              {SCENARIO_DUAL_UNLOCK_FOOTER}
            </p>

            <p
              style={{
                margin: `${spacing[3]} 0 0`,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: 1.5
              }}
            >
              STOCVEST does not show entry, stop, target, or risk/reward until the setup qualifies. This is
              educational readiness only — not trading advice.
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
