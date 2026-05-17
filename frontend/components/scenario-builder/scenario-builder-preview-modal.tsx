"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import {
  defaultMissingBullets,
  type ScenarioBuilderCapability,
  type ScenarioReadinessResolved
} from "@/lib/scenario/scenario-readiness";
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
  const isSoon = resolved.capability === "building_soon";
  const title = isSoon ? "Setup is progressing" : "Scenario preview";
  const missing = defaultMissingBullets(resolved);

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
              border: `1px solid ${isSoon ? "rgba(245,158,11,0.45)" : colors.border}`,
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
                    color: isSoon ? "#f59e0b" : colors.text,
                    fontSize: typography.scale.xl,
                    fontWeight: 700
                  }}
                >
                  {title} — {sym}
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

            <PreviewBody
              colors={colors}
              capability={resolved.capability}
              sym={sym}
              resolved={resolved}
              missing={missing}
              gapIntelBlocked={resolved.gapIntelBlocked}
            />

            <p
              style={{
                margin: `${spacing[4]} 0 0`,
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

function PreviewBody({
  colors,
  capability,
  sym,
  resolved,
  missing,
  gapIntelBlocked
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  capability: ScenarioBuilderCapability;
  sym: string;
  resolved: ScenarioReadinessResolved;
  missing: string[];
  gapIntelBlocked: boolean;
}) {
  const sectionStyle = {
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceMuted,
    marginBottom: spacing[3]
  };

  if (gapIntelBlocked) {
    return (
      <section style={sectionStyle} data-testid="scenario-preview-gap-blocked">
        <p style={{ margin: 0, fontWeight: 700, color: colors.text }}>Planning window limited</p>
        <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
          Gap Intelligence marks scenario drafting as unavailable for this market phase. You can still review
          alignment and what the setup needs — execution planning unlocks when session structure is available.
        </p>
        <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
          Current alignment: {resolved.aligned} / {resolved.total}
        </p>
      </section>
    );
  }

  if (capability === "building_soon") {
    return (
      <>
        <section style={sectionStyle} data-testid="scenario-preview-building-soon">
          <p style={{ margin: 0, fontWeight: 700, color: "#f59e0b" }}>Setup is progressing</p>
          <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
            {sym} is not fully actionable yet. The scenario builder will unlock the full planning sheet once
            confirmation and structural gates clear.
          </p>
          <p style={{ margin: `${spacing[2]} 0 0`, color: colors.text, fontSize: typography.scale.sm }}>
            Current alignment: <strong>{resolved.aligned}</strong> / {resolved.total}
          </p>
          {resolved.maturationLabel ? (
            <p style={{ margin: `${spacing[1]} 0 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
              Maturation: {resolved.maturationLabel}
            </p>
          ) : null}
        </section>
        <section style={sectionStyle}>
          <p style={{ margin: 0, fontWeight: 600, color: colors.text }}>Waiting for final confirmations</p>
          <ul style={{ margin: `${spacing[2]} 0 0`, paddingLeft: spacing[4], color: colors.textMuted, fontSize: typography.scale.sm }}>
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
        <QualitativeStructure colors={colors} resolved={resolved} />
      </>
    );
  }

  return (
    <>
      <section style={sectionStyle} data-testid="scenario-preview-not-ready">
        <p style={{ margin: 0, fontWeight: 700, color: colors.text }}>This setup is not yet actionable</p>
        <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
          Scenario builder will activate once alignment and confirmation are sufficient. Use this preview to
          see what the system is waiting on.
        </p>
        <p style={{ margin: `${spacing[2]} 0 0`, color: colors.text, fontSize: typography.scale.sm }}>
          Current alignment: <strong>{resolved.aligned}</strong> / {resolved.total}
        </p>
      </section>
      <section style={sectionStyle}>
        <p style={{ margin: 0, fontWeight: 600, color: colors.text }}>Missing</p>
        <ul style={{ margin: `${spacing[2]} 0 0`, paddingLeft: spacing[4], color: colors.textMuted, fontSize: typography.scale.sm }}>
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </section>
      <QualitativeStructure colors={colors} resolved={resolved} />
    </>
  );
}

function QualitativeStructure({
  colors,
  resolved
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  resolved: ScenarioReadinessResolved;
}) {
  return (
    <section
      style={{
        padding: spacing[3],
        borderRadius: borderRadius.lg,
        border: `1px dashed ${colors.border}`,
        background: "transparent"
      }}
      data-testid="scenario-preview-qualitative"
    >
      <p style={{ margin: 0, fontWeight: 600, color: colors.textMuted, fontSize: typography.scale.xs, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Potential structure (preview only)
      </p>
      <ul style={{ margin: `${spacing[2]} 0 0`, paddingLeft: spacing[4], color: colors.text, fontSize: typography.scale.sm }}>
        {resolved.directionalLabel ? <li>Direction: {resolved.directionalLabel}</li> : null}
        <li>
          Reference levels: {resolved.structurallyComplete ? "available on this symbol" : "still forming"}
        </li>
        <li>Execution logic unlocks when the setup qualifies</li>
      </ul>
    </section>
  );
}
