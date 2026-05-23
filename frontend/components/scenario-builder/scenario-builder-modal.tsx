"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  computeScenarioResult,
  formatRMultiple,
  formatScenarioDollars,
  formatScenarioForClipboard,
  formatScenarioPercent
} from "@/lib/scenario/compute";
import type {
  ScenarioComputedResult,
  ScenarioInput,
  ScenarioUserInputs
} from "@/lib/scenario/types";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useModalOverlay } from "@/lib/hooks/use-modal-overlay";
import { MODAL_BACKDROP_CLASS, MODAL_DIALOG_SCROLL_CLASS } from "@/lib/overlay-classes";
import { useTheme } from "@/lib/theme-provider";

interface ScenarioBuilderModalProps {
  open: boolean;
  input: ScenarioInput;
  onClose: () => void;
}

/**
 * Derive a sensible pre-fill for `entry` from the reference levels:
 * mid of entry zone if both ends exist, otherwise the most specific
 * single anchor available. Returns NaN when nothing is usable — the
 * eligibility gate prevents the modal from ever opening in that case,
 * but the defensive return keeps the math helpers happy regardless.
 */
function deriveEntryDefault(ref: ScenarioInput["reference"]): number {
  const lo = typeof ref.entry_low === "number" && ref.entry_low > 0 ? ref.entry_low : null;
  const hi = typeof ref.entry_high === "number" && ref.entry_high > 0 ? ref.entry_high : null;
  if (lo !== null && hi !== null) return (lo + hi) / 2;
  if (lo !== null) return lo;
  if (hi !== null) return hi;
  if (typeof ref.current_price === "number" && ref.current_price > 0) return ref.current_price;
  if (typeof ref.session_open === "number" && ref.session_open > 0) return ref.session_open;
  if (typeof ref.prev_close === "number" && ref.prev_close > 0) return ref.prev_close;
  return Number.NaN;
}

/**
 * Volatility-regime default stop, as a percentage of entry. Used only
 * when no explicit stop / ATR was carried by the signal — gives the
 * user a starting point clearly labeled "Reference" rather than an
 * empty field. The percentages are deliberately conservative and ARE
 * NOT a recommendation: they're a mechanical seed value the user is
 * expected to override based on their own plan.
 */
const REGIME_DEFAULT_STOP_PCT: Record<string, number> = {
  low: 0.01,
  normal: 0.02,
  elevated: 0.03,
  extreme: 0.04
};

/**
 * Derive a stop default. Priority order:
 *   1. Explicit reference stop (signal-carried).
 *   2. ATR-based: entry ± 1.5×ATR by direction.
 *   3. Volatility-regime default: entry × (1 ± regime_pct).
 *
 * Each successive fallback is more approximate; the modal labels the
 * final cell "Reference" regardless of which path produced it, so the
 * user knows STOCVEST did not endorse the value as the correct stop
 * for this trade.
 */
function deriveStopDefault(
  ref: ScenarioInput["reference"],
  direction: "bullish" | "bearish",
  entry: number,
  regime: ScenarioInput["volatility_regime"]
): number {
  if (typeof ref.stop === "number" && Number.isFinite(ref.stop) && ref.stop > 0) {
    return ref.stop;
  }
  if (
    typeof ref.atr === "number" &&
    Number.isFinite(ref.atr) &&
    ref.atr > 0 &&
    Number.isFinite(entry)
  ) {
    return direction === "bullish" ? entry - 1.5 * ref.atr : entry + 1.5 * ref.atr;
  }
  const regimePct = REGIME_DEFAULT_STOP_PCT[regime];
  if (regimePct && Number.isFinite(entry) && entry > 0) {
    return direction === "bullish" ? entry * (1 - regimePct) : entry * (1 + regimePct);
  }
  return Number.NaN;
}

/**
 * Derive a target default. Priority order:
 *   1. T1 from signal payload (most conservative; first-leg take-profit).
 *   2. T2 → T3 fallthrough if T1 wasn't carried.
 *   3. 2R-from-stop: entry + 2 × |entry - stop| in the trade direction.
 *
 * The 2R fallback is a *mechanical* seed value — exactly 2R is a
 * structural geometry choice, not a "we recommend 2R" verdict. The user
 * is expected to override based on their own plan.
 */
function deriveTargetDefault(
  ref: ScenarioInput["reference"],
  entry: number,
  stop: number,
  direction: "bullish" | "bearish"
): number {
  if (typeof ref.target_1 === "number" && ref.target_1 > 0) return ref.target_1;
  if (typeof ref.target_2 === "number" && ref.target_2 > 0) return ref.target_2;
  if (typeof ref.target_3 === "number" && ref.target_3 > 0) return ref.target_3;
  if (Number.isFinite(entry) && Number.isFinite(stop) && entry > 0 && stop > 0) {
    const risk = Math.abs(entry - stop);
    if (risk > 0) {
      return direction === "bullish" ? entry + 2 * risk : entry - 2 * risk;
    }
  }
  return Number.NaN;
}

function ReferenceRow({
  label,
  value,
  tag,
  testId
}: {
  label: string;
  value: string;
  tag?: string;
  testId?: string;
}) {
  const { colors } = useTheme();
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: spacing[3],
        padding: `${spacing[2]} 0`,
        borderBottom: `1px dashed ${colors.border}`
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: spacing[2] }}>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{label}</span>
        {tag ? (
          <span
            style={{
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.sm,
              padding: `2px 6px`
            }}
          >
            {tag}
          </span>
        ) : null}
      </span>
      <span style={{ color: colors.text, fontSize: typography.scale.sm, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

function InputRow({
  label,
  value,
  onChange,
  step,
  testId,
  helper
}: {
  label: string;
  value: number | "";
  onChange: (v: number) => void;
  step: number;
  testId: string;
  helper?: string;
}) {
  const { colors } = useTheme();
  return (
    <label
      style={{
        display: "grid",
        gap: spacing[1],
        padding: `${spacing[2]} 0`,
        borderBottom: `1px dashed ${colors.border}`
      }}
    >
      <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={Number.isFinite(value) ? (value as number) : ""}
        onChange={(e) => {
          const next = e.currentTarget.value === "" ? Number.NaN : Number(e.currentTarget.value);
          onChange(next);
        }}
        data-testid={testId}
        style={{
          background: colors.background,
          color: colors.text,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          padding: `${spacing[2]} ${spacing[3]}`,
          fontSize: typography.scale.sm
        }}
      />
      {helper ? (
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{helper}</span>
      ) : null}
    </label>
  );
}

function ComputedRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  const { colors } = useTheme();
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: spacing[3],
        padding: `${spacing[2]} 0`,
        borderBottom: `1px dashed ${colors.border}`
      }}
    >
      <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{label}</span>
      <span
        style={{
          color: colors.text,
          fontSize: typography.scale.sm,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {value}
      </span>
    </div>
  );
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
export function ScenarioBuilderModal({ open, input, onClose }: ScenarioBuilderModalProps) {
  const { colors } = useTheme();
  useModalOverlay(open, onClose);
  const direction = input.direction === "bullish" || input.direction === "bearish" ? input.direction : "bullish";

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
    () => computeScenarioResult(userInputs),
    [userInputs]
  );

  const handleReset = () => {
    setEntry(entryDefault);
    setStop(stopDefault);
    setTarget(targetDefault);
    setShares(100);
    setAccountSize(Number.NaN);
    setOrderTypeLabel("limit");
    setCopyState("idle");
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
            className={`flex max-h-none min-h-screen w-full max-w-none flex-col overflow-y-auto rounded-none lg:max-h-[95vh] lg:min-h-0 lg:w-[min(720px,100vw-1.5rem)] lg:rounded-xl ${surfaceGlowClassName} ${MODAL_DIALOG_SCROLL_CLASS}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              padding: spacing[5]
            }}
            data-testid="scenario-builder-modal"
            role="dialog"
            aria-labelledby="scenario-builder-title"
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
                  {directionLabel} · {modeLabel} · Structurally complete
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
                  label="Reference entry zone"
                  value={`${formatScenarioDollars(input.reference.entry_low as number, { fractionDigits: 4 })} – ${formatScenarioDollars(input.reference.entry_high as number, { fractionDigits: 4 })}`}
                  tag="Reference"
                  testId="scenario-ref-entry-zone"
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `0 ${spacing[4]}` }}>
                <InputRow
                  label="Entry price"
                  value={entry}
                  step={0.01}
                  onChange={setEntry}
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

            <footer
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: spacing[3]
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
