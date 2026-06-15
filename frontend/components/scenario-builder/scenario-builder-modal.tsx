"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import {
  computeScenarioResult,
  formatRMultiple,
  formatScenarioDollars,
  formatScenarioForClipboard,
  formatScenarioPercent
} from "@/lib/scenario/compute";
import {
  formatScenarioRatio,
  resolveScenarioLevels,
  buildScenarioVariantCatalog,
  type ScenarioPresetId
} from "@/lib/scenario/scenario-variants";
import { buildScenarioComparisonRows } from "@/lib/scenario/scenario-comparison-rows";
import { scenarioInputToGeometrySource } from "@/lib/scenario/scenario-input-geometry";
import { evaluatePresetRiskCap, formatRiskPctLine, riskPctOfEntry } from "@/lib/scenario/planning-risk-present";
import {
  classifyEntryEdge,
  effectiveEntryZoneForClassification,
  entryEdgeHint,
  suggestStopForEntry,
  isLongGeometryInvalid,
  isShortGeometryInvalid
} from "@/lib/scenario/scenario-stop-policy";
import {
  detectExecutionTimingFlags,
  type ScenarioExecutionTiming
} from "@/lib/scenario/scenario-execution-timing";
import { scenarioGeometryError } from "@/lib/scenario/scenario-geometry";
import { resolveScenarioVerdict } from "@/lib/scenario/scenario-verdict";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import { ScenarioBuilderVerdictBanner } from "@/components/scenario-builder/scenario-builder-verdict-banner";
import { ScenarioBuilderComparisonTable } from "@/components/scenario-builder/scenario-builder-comparison-table";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useModalOverlay } from "@/lib/hooks/use-modal-overlay";
import { MODAL_BACKDROP_CLASS, MODAL_DIALOG_SCROLL_CLASS } from "@/lib/overlay-classes";
import { useTheme } from "@/lib/theme-provider";
import type {
  ScenarioComputedResult,
  ScenarioInput,
  ScenarioUserInputs
} from "@/lib/scenario/types";

import {
  allocateScaleOutShares,
  breakEvenWinRate,
  ComputedRow,
  defaultSystemDecision,
  deriveEntryDefault,
  deriveStopDefault,
  deriveTargetDefault,
  InputRow,
  isDirectionallyValidLevel,
  legRMultiple,
  modeHint,
  normalizeTargetLevel,
  presetPlaybook,
  ReferenceRow,
  round4,
  tradeStatusLine,
  type ScenarioViewMode
} from "./scenario-builder-modal-helpers";

interface ScenarioBuilderModalProps {
  open: boolean;
  input: ScenarioInput;
  onClose: () => void;
  /** Desk decision for verdict banner; defaults to monitor when omitted (tests, legacy callers). */
  systemDecision?: TradeDecision;
  /** Weak timing / VWAP conflict — caps green verdict and seeds Dip preset on open. */
  executionTiming?: ScenarioExecutionTiming;
}


/**
 * Scenario Builder Modal.
 *
 * Three blocks:
 *   1. Reference data — read-only / pre-fill source, every row tagged
 *      "Reference" so the user knows STOCVEST did NOT recommend the
 *      value, it merely surfaced what the signal carried.
 *   2. Your inputs — user owns these. Defaults are mechanically derived
 *      from reference data (mid of entry zone, etc.) but the user MUST
 *      confirm every cell themselves.
 *   3. Computed — pure consequences of (2). Risk/share, total risk,
 *      R-multiple, cost basis, optional %-of-account.
 *
 * Terminal actions:
 *   - "Copy scenario" — clipboard write (plain text). Nothing more.
 *   - "Reset" — reset user inputs back to reference defaults.
 *   - "Close" — dismiss.
 *
 * Explicit non-features (intentional, do not add):
 *   - No "Submit," "Send to broker," "Stage order," or any verb that
 *     implies an outbound action to a broker, exchange, or backend.
 *   - No "Recommended size" / "Recommended stop" — every pre-fill is
 *     labeled "Reference."
 *   - No save-to-server. We can add a local-storage "Saved scenarios"
 *     follow-up later (backlog B32) but the MVP keeps the surface
 *     stateless to stay clearly non-advisory.
 */
export function ScenarioBuilderModal({
  open,
  input,
  onClose,
  systemDecision = defaultSystemDecision(),
  executionTiming
}: ScenarioBuilderModalProps) {
  const { colors } = useTheme();
  useModalOverlay(open, onClose);
  const direction = input.direction === "bullish" || input.direction === "bearish" ? input.direction : "bullish";

  const catalog = useMemo(() => {
    const source = scenarioInputToGeometrySource(input);
    if (!source) return null;
    return buildScenarioVariantCatalog(source);
  }, [input]);

  const entryDefault = useMemo(() => deriveEntryDefault(input.reference), [input.reference]);
  const stopDefault = useMemo(
    () => deriveStopDefault(input.reference, direction, entryDefault, input.volatility_regime),
    [input.reference, direction, entryDefault, input.volatility_regime]
  );
  const targetDefault = useMemo(
    () => deriveTargetDefault(input.reference, entryDefault, stopDefault, direction),
    [input.reference, entryDefault, stopDefault, direction]
  );

  const [entry, setEntry] = useState<number>(entryDefault);
  const [stop, setStop] = useState<number>(stopDefault);
  const [target, setTarget] = useState<number>(targetDefault);
  const [shares, setShares] = useState<number>(100);
  const [accountSize, setAccountSize] = useState<number>(Number.NaN);
  const [orderTypeLabel, setOrderTypeLabel] = useState<"market" | "limit" | "stop">("limit");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [executionCopyState, setExecutionCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [stopAutoAdjusted, setStopAutoAdjusted] = useState(false);
  const [activePreset, setActivePreset] = useState<ScenarioPresetId>("continuation");
  const [viewMode, setViewMode] = useState<ScenarioViewMode>("guided");

  const timingFlags = useMemo(
    () => ({
      ...detectExecutionTimingFlags(systemDecision),
      ...executionTiming
    }),
    [systemDecision, executionTiming]
  );

  /** Seed Your plan from best-fit preset whenever the sheet opens. */
  useEffect(() => {
    if (!open) return;
    setStopAutoAdjusted(false);
    if (catalog?.system) {
      const presetId: ScenarioPresetId =
        timingFlags.entryTimingWeak || timingFlags.vwapConflict ? "dip" : "continuation";
      setActivePreset(presetId);
      const resolved =
        resolveScenarioLevels(catalog.source, catalog.presets[presetId]) ?? catalog.system;
      setEntry(resolved.entry);
      setStop(resolved.stop);
      setTarget(resolved.target);
      return;
    }
    setEntry(entryDefault);
    setStop(stopDefault);
    setTarget(targetDefault);
  }, [open, catalog, entryDefault, stopDefault, targetDefault, timingFlags.entryTimingWeak, timingFlags.vwapConflict]);

  const entryEdgeQuality = useMemo(() => {
    if (!catalog) return "unknown" as const;
    const zone = effectiveEntryZoneForClassification({
      sessionLo: catalog.source.entryZoneLow,
      sessionHi: catalog.source.entryZoneHigh,
      swingLo: input.reference.swing_range_low ?? null,
      swingHi: input.reference.swing_range_high ?? null
    });
    return classifyEntryEdge(entry, zone.lo, zone.hi);
  }, [catalog, entry, input.reference.swing_range_low, input.reference.swing_range_high]);

  const entryEdgeMessage = entryEdgeHint(entryEdgeQuality);

  const geometryError = useMemo(
    () => scenarioGeometryError(direction, entry, stop, target),
    [direction, entry, stop, target]
  );

  const handleEntryChange = (nextEntry: number) => {
    setEntry(nextEntry);
    if (!catalog || !Number.isFinite(nextEntry)) return;
    const invalid =
      direction === "bullish"
        ? isLongGeometryInvalid(nextEntry, stop)
        : isShortGeometryInvalid(nextEntry, stop);
    if (!invalid) return;
    const suggested = suggestStopForEntry({
      direction,
      entry: nextEntry,
      structuralStop: catalog.source.structuralStop,
      zoneLo: catalog.source.entryZoneLow,
      zoneHi: catalog.source.entryZoneHigh,
      atr: catalog.source.atr
    });
    if (suggested != null) {
      setStop(suggested);
      setStopAutoAdjusted(true);
    }
  };

  const userInputs: ScenarioUserInputs = useMemo(
    () => ({
      entry,
      stop,
      target,
      shares,
      account_size: Number.isFinite(accountSize) ? accountSize : null,
      order_type_label: orderTypeLabel
    }),
    [entry, stop, target, shares, accountSize, orderTypeLabel]
  );

  const result: ScenarioComputedResult = useMemo(
    () => computeScenarioResult(userInputs, direction),
    [userInputs, direction]
  );

  const verdict = useMemo(
    () =>
      resolveScenarioVerdict({
        systemDecision,
        mode: input.mode,
        direction,
        entry,
        stop,
        target,
        executionTiming: timingFlags,
        target1: input.reference.target_1 ?? null,
        target2: input.reference.target_2 ?? null,
        target2Provenance: input.reference.target_2_provenance ?? null
      }),
    [systemDecision, input.mode, direction, entry, stop, target, timingFlags, input.reference]
  );

  const applyPreset = (preset: ScenarioPresetId) => {
    if (!catalog) return;
    const resolved = resolveScenarioLevels(catalog.source, catalog.presets[preset]);
    if (!resolved) return;
    setActivePreset(preset);
    setEntry(resolved.entry);
    setStop(resolved.stop);
    setTarget(resolved.target);
    setStopAutoAdjusted(false);
  };

  const draftRiskPct = useMemo(
    () => riskPctOfEntry(direction, entry, stop),
    [direction, entry, stop]
  );
  const draftRiskCapWarning = useMemo(() => {
    if (draftRiskPct == null) return null;
    return evaluatePresetRiskCap(activePreset, draftRiskPct);
  }, [draftRiskPct, activePreset]);

  const postFillPlan = useMemo(() => {
    const totalShares = Number.isFinite(shares) && shares > 0 ? Math.floor(shares) : 0;
    const [leg1Shares, leg2Shares, runnerShares] = allocateScaleOutShares(totalShares);
    const riskPerShare = Number.isFinite(result.risk_per_share) ? result.risk_per_share : Number.NaN;
    const targetTwoRef = isDirectionallyValidLevel(direction, entry, input.reference.target_2 ?? null)
      ? (input.reference.target_2 as number)
      : null;
    const targetThreeRef = isDirectionallyValidLevel(direction, entry, input.reference.target_3 ?? null)
      ? (input.reference.target_3 as number)
      : null;

    const targetTwoAuto =
      Number.isFinite(riskPerShare) && riskPerShare > 0
        ? round4(direction === "bullish" ? entry + 2 * riskPerShare : entry - 2 * riskPerShare)
        : null;
    const targetThreeAuto =
      Number.isFinite(riskPerShare) && riskPerShare > 0
        ? round4(direction === "bullish" ? entry + 3 * riskPerShare : entry - 3 * riskPerShare)
        : null;

    const leg1Level = Number.isFinite(target) ? target : null;
    const leg2Level = normalizeTargetLevel({
      direction,
      floorFrom: leg1Level ?? entry,
      candidate: targetTwoRef ?? targetTwoAuto,
      riskPerShare
    });
    const runnerLevel = normalizeTargetLevel({
      direction,
      floorFrom: leg2Level ?? leg1Level ?? entry,
      candidate: targetThreeRef ?? targetThreeAuto,
      riskPerShare
    });

    const leg1R = leg1Level != null ? legRMultiple({ direction, entry, level: leg1Level, riskPerShare }) : null;
    const leg2R = leg2Level != null ? legRMultiple({ direction, entry, level: leg2Level, riskPerShare }) : null;
    const runnerR = runnerLevel != null ? legRMultiple({ direction, entry, level: runnerLevel, riskPerShare }) : null;

    return {
      totalShares,
      leg1Shares,
      leg2Shares,
      runnerShares,
      leg1Level,
      leg2Level,
      runnerLevel,
      leg1R,
      leg2R,
      runnerR
    };
  }, [shares, result.risk_per_share, direction, entry, target, input.reference.target_2, input.reference.target_3]);

  const riskBudgetAssessment = useMemo(() => {
    if (result.risk_pct_of_account == null) {
      return {
        tone: "info" as const,
        line: "Add account size to validate whether this plan fits your risk budget."
      };
    }
    if (result.risk_pct_of_account > 2) {
      return {
        tone: "risk" as const,
        line: `Risk budget warning: ${result.risk_pct_of_account.toFixed(2)}% of account is above the 2.00% guardrail.`
      };
    }
    if (result.risk_pct_of_account > 1) {
      return {
        tone: "caution" as const,
        line: `Risk budget check: ${result.risk_pct_of_account.toFixed(2)}% of account is elevated.`
      };
    }
    return {
      tone: "ok" as const,
      line: `Risk budget check: ${result.risk_pct_of_account.toFixed(2)}% of account is within conservative bounds.`
    };
  }, [result.risk_pct_of_account]);

  const comparisonRows = useMemo(() => {
    if (!catalog) return [];
    return buildScenarioComparisonRows(catalog, entry, stop, target).filter((row) => row.id !== "your_draft");
  }, [catalog, entry, stop, target]);

  const noTradeConditions = useMemo(() => {
    const lines = [...verdict.blockers];
    if (timingFlags.entryTimingWeak) {
      lines.push("Entry timing is weak for the current setup window.");
    }
    if (timingFlags.vwapConflict) {
      lines.push("Price action conflicts with the intraday VWAP context.");
    }
    if (geometryError) {
      lines.push(geometryError);
    }
    return lines.filter((line, idx, arr) => arr.indexOf(line) === idx).slice(0, 5);
  }, [verdict.blockers, timingFlags.entryTimingWeak, timingFlags.vwapConflict, geometryError]);

  const handleReset = () => {
    setStopAutoAdjusted(false);
    if (catalog?.system) {
      const presetId: ScenarioPresetId =
        timingFlags.entryTimingWeak || timingFlags.vwapConflict ? "dip" : "continuation";
      setActivePreset(presetId);
      const resolved =
        resolveScenarioLevels(catalog.source, catalog.presets[presetId]) ?? catalog.system;
      setEntry(resolved.entry);
      setStop(resolved.stop);
      setTarget(resolved.target);
    } else {
      setEntry(entryDefault);
      setStop(stopDefault);
      setTarget(targetDefault);
    }
    setShares(100);
    setAccountSize(Number.NaN);
    setOrderTypeLabel("limit");
    setCopyState("idle");
    setExecutionCopyState("idle");
    setViewMode("guided");
  };

  const handleCopy = async () => {
    const text = formatScenarioForClipboard(input.symbol, direction, input.mode, userInputs, result);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopyState("copied");
        setTimeout(() => setCopyState("idle"), 2000);
      } else {
        setCopyState("error");
      }
    } catch {
      setCopyState("error");
    }
  };

  const handleCopyExecutionPlan = async () => {
    const scaleVerb = direction === "bullish" ? "Sell" : "Cover";
    const stopLine =
      direction === "bullish"
        ? `Sell stop all remaining @ ${formatScenarioDollars(stop, { fractionDigits: 2 })}`
        : `Buy stop to cover all remaining @ ${formatScenarioDollars(stop, { fractionDigits: 2 })}`;
    const lines = [
      `Execution ticket — ${input.symbol.toUpperCase()} (${directionLabel}, ${modeLabel})`,
      "",
      `Entry plan: ${formatScenarioDollars(entry, { fractionDigits: 4 })}`,
      `${scaleVerb} ${postFillPlan.leg1Shares} shares @ ${formatScenarioDollars(postFillPlan.leg1Level ?? Number.NaN, { fractionDigits: 2 })}${postFillPlan.leg1R != null ? ` (${postFillPlan.leg1R.toFixed(2)}R)` : ""}`,
      `${scaleVerb} ${postFillPlan.leg2Shares} shares @ ${formatScenarioDollars(postFillPlan.leg2Level ?? Number.NaN, { fractionDigits: 2 })}${postFillPlan.leg2R != null ? ` (${postFillPlan.leg2R.toFixed(2)}R)` : ""}`,
      `${scaleVerb} ${postFillPlan.runnerShares} shares @ ${formatScenarioDollars(postFillPlan.runnerLevel ?? Number.NaN, { fractionDigits: 2 })} (runner)${postFillPlan.runnerR != null ? ` (${postFillPlan.runnerR.toFixed(2)}R)` : ""}`,
      stopLine,
      "",
      "Planning only. You control order routing and execution."
    ];
    const text = lines.join("\n");
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setExecutionCopyState("copied");
        setTimeout(() => setExecutionCopyState("idle"), 2000);
      } else {
        setExecutionCopyState("error");
      }
    } catch {
      setExecutionCopyState("error");
    }
  };

  const directionLabel = direction === "bullish" ? "Bullish" : "Bearish";
  const modeLabel = input.mode === "swing" ? "Swing" : "Day";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 z-[95] grid place-items-stretch p-0 lg:place-items-center lg:p-3 ${MODAL_BACKDROP_CLASS}`}
          onClick={onClose}
          data-testid="scenario-builder-modal-overlay"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className={`flex max-h-none min-h-0 w-full max-w-none flex-col overflow-hidden rounded-none lg:max-h-[95vh] lg:min-h-0 lg:w-[min(720px,100vw-1.5rem)] lg:rounded-xl min-h-screen lg:min-h-0 ${surfaceGlowClassName}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`
            }}
            data-testid="scenario-builder-modal"
            role="dialog"
            aria-labelledby="scenario-builder-title"
          >
            <header
              className="sticky top-0 z-10 shrink-0 border-b"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: spacing[3],
                padding: spacing[5],
                paddingBottom: spacing[3],
                background: colors.surface,
                borderColor: colors.border
              }}
            >
              <div style={{ display: "grid", gap: spacing[1] }}>
                <h2
                  id="scenario-builder-title"
                  style={{
                    margin: 0,
                    color: colors.text,
                    fontSize: typography.scale.xl,
                    fontWeight: 700
                  }}
                >
                  Build scenario — {input.symbol.toUpperCase()}
                </h2>
                <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
                  {directionLabel} · {modeLabel}
                  {verdict.scenarioRr != null ? ` · Your plan ${formatScenarioRatio(verdict.scenarioRr)}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close scenario builder"
                data-testid="scenario-builder-close"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border"
                style={{
                  borderColor: colors.border,
                  background: "transparent",
                  color: colors.text,
                  cursor: "pointer"
                }}
              >
                <X size={16} />
              </button>
            </header>

            <div
              className={`min-h-0 flex-1 overflow-y-auto ${MODAL_DIALOG_SCROLL_CLASS}`}
              style={{ padding: spacing[5], paddingTop: spacing[4] }}
            >
            {input.desk_environment_headline ? (
              <p
                className="mb-4 rounded-md border px-3 py-2 text-xs leading-relaxed"
                style={{
                  borderColor: colors.border,
                  color: colors.text,
                  background: colors.surfaceMuted
                }}
                role="status"
                data-testid="scenario-desk-environment-banner"
              >
                {input.environment_tier ? (
                  <span className="font-semibold" style={{ color: colors.textMuted }}>
                    Desk environment ({input.environment_tier}) —{" "}
                  </span>
                ) : (
                  <span className="font-semibold" style={{ color: colors.textMuted }}>
                    Desk environment —{" "}
                  </span>
                )}
                {input.desk_environment_headline}
              </p>
            ) : null}

            {input.structural_planning_banner ? (
              <p
                className="mb-4 rounded-md border px-3 py-2 text-xs leading-relaxed"
                style={{
                  borderColor: colors.caution,
                  color: colors.text,
                  background: "rgba(245,158,11,.08)"
                }}
                role="status"
                data-testid="scenario-structural-planning-banner"
              >
                {input.structural_planning_banner}
              </p>
            ) : null}

            <ScenarioBuilderVerdictBanner verdict={verdict} />

            <section
              data-testid="scenario-decision-plan"
              style={{
                background: colors.surfaceMuted,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                padding: spacing[4],
                marginBottom: spacing[3]
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: spacing[2],
                  marginBottom: spacing[2],
                  flexWrap: "wrap"
                }}
              >
                <div style={{ display: "grid", gap: spacing[1] }}>
                  <h3
                    style={{
                      margin: 0,
                      color: colors.text,
                      fontSize: typography.scale.sm,
                      fontWeight: 700,
                      letterSpacing: "0.02em",
                      textTransform: "uppercase"
                    }}
                  >
                    Trade plan summary
                  </h3>
                  <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
                    {tradeStatusLine(verdict.tone)}
                  </p>
                </div>
                <div
                  role="tablist"
                  aria-label="Scenario view mode"
                  style={{ display: "inline-flex", gap: spacing[1] }}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === "guided"}
                    onClick={() => setViewMode("guided")}
                    data-testid="scenario-view-guided"
                    style={{
                      borderRadius: borderRadius.md,
                      border: `1px solid ${viewMode === "guided" ? colors.accent : colors.border}`,
                      background: viewMode === "guided" ? colors.background : "transparent",
                      color: colors.text,
                      fontSize: typography.scale.xs,
                      fontWeight: 600,
                      padding: `${spacing[1]} ${spacing[2]}`,
                      cursor: "pointer"
                    }}
                  >
                    Guided
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === "pro"}
                    onClick={() => setViewMode("pro")}
                    data-testid="scenario-view-pro"
                    style={{
                      borderRadius: borderRadius.md,
                      border: `1px solid ${viewMode === "pro" ? colors.accent : colors.border}`,
                      background: viewMode === "pro" ? colors.background : "transparent",
                      color: colors.text,
                      fontSize: typography.scale.xs,
                      fontWeight: 600,
                      padding: `${spacing[1]} ${spacing[2]}`,
                      cursor: "pointer"
                    }}
                  >
                    Pro
                  </button>
                </div>
              </div>

              <p style={{ margin: `0 0 ${spacing[2]} 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
                {modeHint(viewMode)}
              </p>

              {viewMode === "guided" ? (
                <div
                  data-testid="scenario-what-to-do-box"
                  style={{
                    background: colors.background,
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    padding: spacing[3],
                    marginBottom: spacing[3]
                  }}
                >
                  <p style={{ margin: `0 0 ${spacing[2]} 0`, color: colors.text, fontWeight: 700, fontSize: typography.scale.sm }}>
                    What to do now
                  </p>
                  <ol
                    style={{
                      margin: 0,
                      paddingLeft: spacing[4],
                      color: colors.text,
                      fontSize: typography.scale.xs,
                      lineHeight: 1.6
                    }}
                  >
                    <li>
                      Wait for trigger: use your selected setup condition before entering.
                    </li>
                    <li>
                      Entry plan: {formatScenarioDollars(entry, { fractionDigits: 4 })} ({directionLabel} setup).
                    </li>
                    <li>
                      Invalidation: stop at {formatScenarioDollars(stop, { fractionDigits: 4 })}.
                    </li>
                    <li>
                      Profit objective: target {formatScenarioDollars(target, { fractionDigits: 4 })} ({formatRMultiple(result.r_multiple_to_target)}).
                    </li>
                    <li>
                      Risk check: total risk {formatScenarioDollars(result.total_risk_dollars)} for {shares} shares.
                    </li>
                  </ol>
                </div>
              ) : (
                <div
                  data-testid="scenario-pro-metrics-box"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: spacing[2],
                    marginBottom: spacing[3]
                  }}
                >
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing[2] }}>
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>R/R</p>
                    <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.text, fontWeight: 700 }}>
                      {formatRMultiple(result.r_multiple_to_target)}
                    </p>
                  </div>
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing[2] }}>
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>Risk % of entry</p>
                    <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.text, fontWeight: 700 }}>
                      {draftRiskPct != null ? `${draftRiskPct.toFixed(2)}%` : "—"}
                    </p>
                  </div>
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing[2] }}>
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>Break-even win rate</p>
                    <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.text, fontWeight: 700 }}>
                      {breakEvenWinRate(result.r_multiple_to_target)}
                    </p>
                  </div>
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing[2] }}>
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>Desk floor</p>
                    <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.text, fontWeight: 700 }}>
                      {verdict.deskMinRr.toFixed(1)} : 1
                    </p>
                  </div>
                </div>
              )}

              <div
                data-testid="scenario-post-fill-plan"
                style={{
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`,
                  background: colors.background,
                  padding: spacing[3],
                  marginBottom: spacing[3]
                }}
              >
                <p style={{ margin: 0, color: colors.text, fontSize: typography.scale.sm, fontWeight: 700 }}>
                  If your entry fills, run this execution plan
                </p>
                <p style={{ margin: `${spacing[1]} 0 ${spacing[2]} 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
                  This sequence is plan logic only. You control whether and when each step is sent to your broker.
                </p>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: spacing[4],
                    color: colors.text,
                    fontSize: typography.scale.xs,
                    lineHeight: 1.65
                  }}
                >
                  <li>
                    {(direction === "bullish" ? "Sell" : "Cover")} {postFillPlan.leg1Shares} shares @{" "}
                    {formatScenarioDollars(postFillPlan.leg1Level ?? Number.NaN, { fractionDigits: 2 })}
                    {postFillPlan.leg1R != null ? ` (${postFillPlan.leg1R.toFixed(2)}R)` : ""}
                  </li>
                  <li>
                    {(direction === "bullish" ? "Sell" : "Cover")} {postFillPlan.leg2Shares} shares @{" "}
                    {formatScenarioDollars(postFillPlan.leg2Level ?? Number.NaN, { fractionDigits: 2 })}
                    {postFillPlan.leg2R != null ? ` (${postFillPlan.leg2R.toFixed(2)}R)` : ""}
                  </li>
                  <li>
                    {(direction === "bullish" ? "Sell" : "Cover")} {postFillPlan.runnerShares} shares @{" "}
                    {formatScenarioDollars(postFillPlan.runnerLevel ?? Number.NaN, { fractionDigits: 2 })} (runner)
                    {postFillPlan.runnerR != null ? ` (${postFillPlan.runnerR.toFixed(2)}R)` : ""}
                  </li>
                  <li>
                    {direction === "bullish" ? "Sell stop" : "Buy stop to cover"} all remaining shares @{" "}
                    {formatScenarioDollars(stop, { fractionDigits: 2 })}.
                  </li>
                </ul>
                <p style={{ margin: `${spacing[2]} 0 0 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
                  Share split: {postFillPlan.leg1Shares + postFillPlan.leg2Shares + postFillPlan.runnerShares} planned
                  shares (30% / 30% / 40% allocation).
                </p>
                <p
                  data-testid="scenario-risk-budget-assessment"
                  style={{
                    margin: `${spacing[2]} 0 0 0`,
                    color:
                      riskBudgetAssessment.tone === "risk"
                        ? colors.bearish
                        : riskBudgetAssessment.tone === "caution"
                          ? colors.caution
                          : colors.textMuted,
                    fontSize: typography.scale.xs
                  }}
                >
                  {riskBudgetAssessment.line}
                </p>
                <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
                  Management rule: once the first scale-out fills, tighten remaining risk only if that is part of your
                  predefined process.
                </p>
                <button
                  type="button"
                  onClick={handleCopyExecutionPlan}
                  data-testid="scenario-copy-execution-plan"
                  aria-live="polite"
                  style={{
                    marginTop: spacing[2],
                    padding: `${spacing[1]} ${spacing[3]}`,
                    background: "transparent",
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    cursor: "pointer",
                    fontSize: typography.scale.xs,
                    fontWeight: 600
                  }}
                >
                  {executionCopyState === "copied"
                    ? "Execution copied"
                    : executionCopyState === "error"
                      ? "Copy failed"
                      : "Copy execution ticket"}
                </button>
              </div>

              {comparisonRows.length > 0 ? (
                <div
                  data-testid="scenario-option-cards"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                    gap: spacing[2],
                    marginBottom: spacing[3]
                  }}
                >
                  {comparisonRows.map((row) => {
                    const playbook = presetPlaybook(row.id as ScenarioPresetId);
                    const isActive = row.id === activePreset;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => applyPreset(row.id as ScenarioPresetId)}
                        data-testid={`scenario-option-card-${row.id}`}
                        style={{
                          textAlign: "left",
                          borderRadius: borderRadius.md,
                          border: `1px solid ${isActive ? colors.accent : colors.border}`,
                          background: isActive ? colors.background : "transparent",
                          padding: spacing[3],
                          cursor: "pointer"
                        }}
                      >
                        <p style={{ margin: 0, color: colors.text, fontSize: typography.scale.xs, fontWeight: 700 }}>
                          {playbook.title}
                        </p>
                        <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
                          {playbook.whenToUse}
                        </p>
                        <p style={{ margin: `${spacing[2]} 0 0 0`, color: colors.text, fontSize: typography.scale.xs }}>
                          Entry {formatScenarioDollars(row.entry, { fractionDigits: 2 })} · Stop{" "}
                          {formatScenarioDollars(row.stop, { fractionDigits: 2 })} · Target{" "}
                          {formatScenarioDollars(row.target, { fractionDigits: 2 })}
                        </p>
                        <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
                          Skip when: {playbook.skipWhen}
                        </p>
                        <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.text, fontSize: typography.scale.xs, fontWeight: 600 }}>
                          {row.riskReward != null ? formatScenarioRatio(row.riskReward) : "—"} R/R
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div
                data-testid="scenario-no-trade-rules"
                style={{
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.caution}`,
                  background: "rgba(245,158,11,.08)",
                  padding: spacing[3]
                }}
              >
                <p style={{ margin: `0 0 ${spacing[1]} 0`, color: colors.text, fontSize: typography.scale.xs, fontWeight: 700 }}>
                  Skip this setup if any of these remain true
                </p>
                <ul style={{ margin: 0, paddingLeft: spacing[4], color: colors.textMuted, fontSize: typography.scale.xs, lineHeight: 1.6 }}>
                  {(noTradeConditions.length > 0
                    ? noTradeConditions
                    : ["Wait for cleaner structure and timing alignment before acting."]
                  ).map((line) => (
                    <li key={line.slice(0, 64)}>{line}</li>
                  ))}
                </ul>
              </div>
            </section>

            {catalog ? (
              <ScenarioBuilderComparisonTable
                catalog={catalog}
                mode={input.mode}
                entry={entry}
                stop={stop}
                target={target}
                onApplyPreset={applyPreset}
              />
            ) : null}

            <section
              data-testid="scenario-reference-block"
              style={{
                background: colors.background,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                padding: spacing[4],
                marginBottom: spacing[3]
              }}
            >
              <h3
                style={{
                  margin: 0,
                  marginBottom: spacing[2],
                  color: colors.text,
                  fontSize: typography.scale.sm,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase"
                }}
              >
                Reference — surfaced from signal
              </h3>
              <p style={{ margin: 0, marginBottom: spacing[2], color: colors.textMuted, fontSize: typography.scale.xs }}>
                Reference values are derived mechanically from the signal payload. They are not entry, stop, or exit recommendations.
              </p>
              <ReferenceRow
                label="Symbol"
                value={input.symbol.toUpperCase()}
                tag="Reference"
                testId="scenario-ref-symbol"
              />
              <ReferenceRow
                label="Direction"
                value={directionLabel}
                tag="Reference"
                testId="scenario-ref-direction"
              />
              <ReferenceRow
                label="Mode"
                value={modeLabel}
                tag="Reference"
                testId="scenario-ref-mode"
              />
              {Number.isFinite(input.reference.entry_low) && Number.isFinite(input.reference.entry_high) ? (
                <ReferenceRow
                  label="Session entry zone (reference)"
                  value={`${formatScenarioDollars(input.reference.entry_low as number, { fractionDigits: 4 })} – ${formatScenarioDollars(input.reference.entry_high as number, { fractionDigits: 4 })}`}
                  tag="Reference"
                  testId="scenario-ref-entry-zone"
                />
              ) : null}
              {Number.isFinite(input.reference.vwap) ? (
                <ReferenceRow
                  label="Session VWAP"
                  value={formatScenarioDollars(input.reference.vwap as number, { fractionDigits: 4 })}
                  tag="Reference"
                  testId="scenario-ref-vwap"
                />
              ) : null}
              {Number.isFinite(input.reference.swing_range_low) &&
              Number.isFinite(input.reference.swing_range_high) ? (
                <ReferenceRow
                  label={
                    input.reference.swing_range_sessions != null
                      ? `Swing range (~${input.reference.swing_range_sessions} sessions)`
                      : "Swing range (recent daily bars)"
                  }
                  value={`${formatScenarioDollars(input.reference.swing_range_low as number, { fractionDigits: 4 })} – ${formatScenarioDollars(input.reference.swing_range_high as number, { fractionDigits: 4 })}`}
                  tag="Reference"
                  testId="scenario-ref-swing-range"
                />
              ) : null}
              {Number.isFinite(input.reference.stop) ? (
                <ReferenceRow
                  label="Reference stop"
                  value={formatScenarioDollars(input.reference.stop as number, { fractionDigits: 4 })}
                  tag="Reference"
                  testId="scenario-ref-stop"
                />
              ) : null}
              {input.reference.stop_provenance?.trim() ? (
                <ReferenceRow
                  label="Stop provenance"
                  value={input.reference.stop_provenance.trim()}
                  tag="How derived"
                  testId="scenario-ref-stop-provenance"
                />
              ) : null}
              {Number.isFinite(input.reference.target_1) ? (
                <ReferenceRow
                  label="Reference target 1"
                  value={formatScenarioDollars(input.reference.target_1 as number, { fractionDigits: 4 })}
                  tag="Reference"
                  testId="scenario-ref-target-1"
                />
              ) : null}
              {Number.isFinite(input.reference.target_2) ? (
                <ReferenceRow
                  label="Reference target 2"
                  value={formatScenarioDollars(input.reference.target_2 as number, { fractionDigits: 4 })}
                  tag="Reference"
                />
              ) : null}
              {input.reference.target_provenance?.trim() ? (
                <ReferenceRow
                  label="Target provenance"
                  value={input.reference.target_provenance.trim()}
                  tag="How derived"
                  testId="scenario-ref-target-provenance"
                />
              ) : null}
              {Number.isFinite(input.reference.atr) ? (
                <ReferenceRow
                  label="ATR (reference)"
                  value={formatScenarioDollars(input.reference.atr as number, { fractionDigits: 4 })}
                  tag="Reference"
                />
              ) : null}
              <ReferenceRow
                label="Volatility regime"
                value={input.volatility_regime}
                tag="Reference"
                testId="scenario-ref-vol"
              />
              {input.tags && input.tags.length > 0 ? (
                <ReferenceRow
                  label="Context tags"
                  value={input.tags.join(", ")}
                  tag="Reference"
                />
              ) : null}
            </section>

            <section
              data-testid="scenario-userinput-block"
              style={{
                background: colors.surfaceMuted,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                padding: spacing[4],
                marginBottom: spacing[3]
              }}
            >
              <h3
                style={{
                  margin: 0,
                  marginBottom: spacing[2],
                  color: colors.text,
                  fontSize: typography.scale.sm,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase"
                }}
              >
                Your planning inputs — you own these
              </h3>
              <p style={{ margin: 0, marginBottom: spacing[2], color: colors.textMuted, fontSize: typography.scale.xs }}>
                Defaults are derived from reference data. Confirm or override every value before treating any number as actionable.
              </p>
              {entryEdgeMessage ? (
                <p
                  data-testid="scenario-entry-edge-hint"
                  style={{
                    margin: `0 0 ${spacing[2]} 0`,
                    color: colors.caution,
                    fontSize: typography.scale.xs
                  }}
                >
                  {entryEdgeMessage}
                </p>
              ) : null}
              {stopAutoAdjusted ? (
                <p
                  data-testid="scenario-stop-auto-adjusted"
                  style={{
                    margin: `0 0 ${spacing[2]} 0`,
                    color: colors.caution,
                    fontSize: typography.scale.xs
                  }}
                >
                  Stop was adjusted to sit below your entry with a minimum risk width (structure + ATR floor).
                </p>
              ) : null}
              {draftRiskPct != null ? (
                <p
                  data-testid="scenario-risk-pct-line"
                  style={{
                    margin: `0 0 ${spacing[2]} 0`,
                    color: colors.textMuted,
                    fontSize: typography.scale.xs
                  }}
                >
                  {formatRiskPctLine(draftRiskPct)}
                  {draftRiskCapWarning?.message ? ` — ${draftRiskCapWarning.message}` : null}
                </p>
              ) : null}
              {geometryError ? (
                <p
                  data-testid="scenario-geometry-inline-error"
                  style={{
                    margin: `0 0 ${spacing[2]} 0`,
                    color: colors.bearish,
                    fontSize: typography.scale.xs
                  }}
                >
                  {geometryError}
                </p>
              ) : null}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `0 ${spacing[4]}` }}>
                <InputRow
                  label="Entry price"
                  value={entry}
                  step={0.01}
                  onChange={handleEntryChange}
                  testId="scenario-input-entry"
                  helper="Pre-filled from reference entry zone."
                />
                <InputRow
                  label="Stop price"
                  value={stop}
                  step={0.01}
                  onChange={setStop}
                  testId="scenario-input-stop"
                  helper="Pre-filled from reference stop or ATR."
                />
                <InputRow
                  label="Target price"
                  value={target}
                  step={0.01}
                  onChange={setTarget}
                  testId="scenario-input-target"
                  helper="Pre-filled from reference target 1."
                />
                <InputRow
                  label="Shares"
                  value={shares}
                  step={1}
                  onChange={setShares}
                  testId="scenario-input-shares"
                />
                <InputRow
                  label="Account size ($) — optional"
                  value={Number.isFinite(accountSize) ? accountSize : Number.NaN}
                  step={1}
                  onChange={setAccountSize}
                  testId="scenario-input-account"
                  helper="Enables 'risk as % of account' below."
                />
                <label style={{ display: "grid", gap: spacing[1], padding: `${spacing[2]} 0`, borderBottom: `1px dashed ${colors.border}` }}>
                  <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
                    Order type (educational only)
                  </span>
                  <select
                    value={orderTypeLabel}
                    onChange={(e) => setOrderTypeLabel(e.currentTarget.value as "market" | "limit" | "stop")}
                    data-testid="scenario-input-order-type"
                    style={{
                      background: colors.background,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.md,
                      padding: `${spacing[2]} ${spacing[3]}`,
                      fontSize: typography.scale.sm
                    }}
                  >
                    <option value="market">market</option>
                    <option value="limit">limit</option>
                    <option value="stop">stop</option>
                  </select>
                  <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
                    Never sent anywhere — for your reference only.
                  </span>
                </label>
              </div>
            </section>

            <section
              data-testid="scenario-computed-block"
              style={{
                background: colors.background,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                padding: spacing[4],
                marginBottom: spacing[3]
              }}
            >
              <h3
                style={{
                  margin: 0,
                  marginBottom: spacing[2],
                  color: colors.text,
                  fontSize: typography.scale.sm,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase"
                }}
              >
                Computed — consequences of your inputs
              </h3>
              <ComputedRow
                label="Risk per share"
                value={formatScenarioDollars(result.risk_per_share, { fractionDigits: 4 })}
                testId="scenario-computed-rps"
              />
              <ComputedRow
                label="Total $ at risk"
                value={formatScenarioDollars(result.total_risk_dollars)}
                testId="scenario-computed-total-risk"
              />
              <ComputedRow
                label="R-multiple to target"
                value={formatRMultiple(result.r_multiple_to_target)}
                testId="scenario-computed-r"
              />
              <ComputedRow
                label="Cost basis"
                value={formatScenarioDollars(result.cost_basis_dollars)}
                testId="scenario-computed-cost"
              />
              <ComputedRow
                label="Risk as % of account"
                value={formatScenarioPercent(result.risk_pct_of_account)}
                testId="scenario-computed-risk-pct"
              />
            </section>

            <div
              data-testid="scenario-disclaimer"
              style={{
                background: colors.surfaceMuted,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                padding: spacing[3],
                marginBottom: spacing[4],
                color: colors.textMuted,
                fontSize: typography.scale.xs,
                lineHeight: 1.5
              }}
            >
              This is a planning scenario only. STOCVEST does not submit, queue, or persist this scenario to any broker. Reference values are derived mechanically from signal data and are not entry, stop, or exit endorsements.
            </div>
            </div>

            <footer
              className="sticky bottom-0 z-10 shrink-0 border-t"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: spacing[3],
                padding: spacing[5],
                paddingTop: spacing[3],
                background: colors.surface,
                borderColor: colors.border
              }}
            >
              <button
                type="button"
                onClick={handleReset}
                data-testid="scenario-reset"
                style={{
                  padding: `${spacing[2]} ${spacing[4]}`,
                  background: "transparent",
                  color: colors.textMuted,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.md,
                  cursor: "pointer",
                  fontSize: typography.scale.sm,
                  fontWeight: 500
                }}
              >
                Reset to reference defaults
              </button>
              <div style={{ display: "flex", gap: spacing[2] }}>
                <button
                  type="button"
                  onClick={onClose}
                  data-testid="scenario-close-footer"
                  style={{
                    padding: `${spacing[2]} ${spacing[4]}`,
                    background: "transparent",
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    cursor: "pointer",
                    fontSize: typography.scale.sm,
                    fontWeight: 500
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  data-testid="scenario-copy"
                  aria-live="polite"
                  style={{
                    padding: `${spacing[2]} ${spacing[4]}`,
                    background: colors.accent,
                    color: "#fff",
                    border: `1px solid ${colors.accent}`,
                    borderRadius: borderRadius.md,
                    cursor: "pointer",
                    fontSize: typography.scale.sm,
                    fontWeight: 600
                  }}
                >
                  {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy scenario"}
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
