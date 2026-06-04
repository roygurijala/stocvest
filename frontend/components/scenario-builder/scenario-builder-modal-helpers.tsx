"use client";

/**
 * Pure helpers + small presentational rows for ScenarioBuilderModal.
 * Split out of scenario-builder-modal.tsx (which imports them back). All pure
 * functions / props-only components — no behavior change.
 */
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { referenceStopAtrK } from "@/lib/scenario/reference-stop-resolve";
import {
  applyMinStopDistance,
  isLongGeometryInvalid,
  isShortGeometryInvalid
} from "@/lib/scenario/scenario-stop-policy";
import type { ScenarioPresetId } from "@/lib/scenario/scenario-variants";
import type { ScenarioInput } from "@/lib/scenario/types";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";

function defaultSystemDecision(): TradeDecision {
  return {
    state: "monitor",
    line: "Setup status unavailable — treat scenario math as exploratory only.",
    reinforcements: [],
    rationale: null
  };
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
  const last =
    typeof ref.current_price === "number" && Number.isFinite(ref.current_price) && ref.current_price > 0
      ? ref.current_price
      : null;
  // Match System default preset (mid_zone): last when available, else zone midpoint.
  if (last !== null) return last;
  if (lo !== null && hi !== null) return (lo + hi) / 2;
  if (lo !== null) return lo;
  if (hi !== null) return hi;
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
 *   2. ATR-based: entry ± k×ATR14 (continuation default k=1.0).
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
  const atr = typeof ref.atr === "number" && ref.atr > 0 ? ref.atr : null;
  if (typeof ref.stop === "number" && Number.isFinite(ref.stop) && ref.stop > 0 && Number.isFinite(entry)) {
    const adjusted = applyMinStopDistance(direction, entry, ref.stop, atr);
    const invalid =
      direction === "bullish" ? isLongGeometryInvalid(entry, adjusted) : isShortGeometryInvalid(entry, adjusted);
    if (!invalid) return adjusted;
  }
  if (
    typeof ref.atr === "number" &&
    Number.isFinite(ref.atr) &&
    ref.atr > 0 &&
    Number.isFinite(entry)
  ) {
    const k = referenceStopAtrK({ preset: "continuation" });
    const raw = direction === "bullish" ? entry - k * ref.atr : entry + k * ref.atr;
    return applyMinStopDistance(direction, entry, raw, atr);
  }
  const regimePct = REGIME_DEFAULT_STOP_PCT[regime];
  if (regimePct && Number.isFinite(entry) && entry > 0) {
    const raw = direction === "bullish" ? entry * (1 - regimePct) : entry * (1 + regimePct);
    return applyMinStopDistance(direction, entry, raw, atr);
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

type ScenarioViewMode = "guided" | "pro";

function modeHint(viewMode: ScenarioViewMode): string {
  return viewMode === "guided"
    ? "Guided view explains each step in plain language."
    : "Pro view is compact and metric-first.";
}

function presetPlaybook(preset: ScenarioPresetId): { title: string; whenToUse: string; skipWhen: string } {
  if (preset === "dip") {
    return {
      title: "Option B — Pullback entry",
      whenToUse: "Price pulls back toward support while structure remains intact.",
      skipWhen: "Pullback slices through support or momentum breaks down."
    };
  }
  if (preset === "breakout") {
    return {
      title: "Option C — Breakout entry",
      whenToUse: "Price reclaims range highs with follow-through.",
      skipWhen: "Breakout fails quickly back into range."
    };
  }
  return {
    title: "Option A — Base continuation",
    whenToUse: "Trend context remains aligned and price holds the current range.",
    skipWhen: "Trend alignment weakens before trigger."
  };
}

function tradeStatusLine(tone: "red" | "amber" | "green"): string {
  if (tone === "green") return "Plan conditions are aligned.";
  if (tone === "amber") return "Partial alignment — tighten conditions.";
  return "Do not act yet — conditions are incomplete.";
}

function breakEvenWinRate(rMultiple: number | null): string {
  if (!Number.isFinite(rMultiple) || (rMultiple as number) <= 0) return "—";
  const pct = (1 / (1 + (rMultiple as number))) * 100;
  return `${pct.toFixed(1)}%`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function allocateScaleOutShares(totalShares: number): [number, number, number] {
  if (!Number.isFinite(totalShares) || totalShares <= 0) return [0, 0, 0];
  const total = Math.max(0, Math.floor(totalShares));
  const first = Math.floor(total * 0.3);
  const second = Math.floor(total * 0.3);
  const runner = Math.max(0, total - first - second);
  return [first, second, runner];
}

function isDirectionallyValidLevel(
  direction: "bullish" | "bearish",
  entry: number,
  level: number | null
): level is number {
  if (!Number.isFinite(entry) || !Number.isFinite(level)) return false;
  if (direction === "bullish") return (level as number) > entry;
  return (level as number) < entry;
}

function normalizeTargetLevel(args: {
  direction: "bullish" | "bearish";
  floorFrom: number;
  candidate: number | null;
  riskPerShare: number;
}): number | null {
  const { direction, floorFrom, candidate, riskPerShare } = args;
  if (!Number.isFinite(floorFrom) || !Number.isFinite(riskPerShare) || riskPerShare <= 1e-6) return null;
  if (direction === "bullish") {
    const minLevel = floorFrom + riskPerShare * 0.5;
    const picked = Number.isFinite(candidate) ? (candidate as number) : minLevel;
    return round4(Math.max(minLevel, picked));
  }
  const maxLevel = floorFrom - riskPerShare * 0.5;
  const picked = Number.isFinite(candidate) ? (candidate as number) : maxLevel;
  return round4(Math.min(maxLevel, picked));
}

function legRMultiple(args: {
  direction: "bullish" | "bearish";
  entry: number;
  level: number;
  riskPerShare: number;
}): number | null {
  const { direction, entry, level, riskPerShare } = args;
  if (!Number.isFinite(entry) || !Number.isFinite(level) || !Number.isFinite(riskPerShare) || riskPerShare <= 1e-6) {
    return null;
  }
  const reward = direction === "bullish" ? level - entry : entry - level;
  if (reward <= 1e-6) return null;
  return round4(reward / riskPerShare);
}

export {
  defaultSystemDecision,
  deriveEntryDefault,
  deriveStopDefault,
  deriveTargetDefault,
  ReferenceRow,
  InputRow,
  ComputedRow,
  modeHint,
  presetPlaybook,
  tradeStatusLine,
  breakEvenWinRate,
  round4,
  allocateScaleOutShares,
  isDirectionallyValidLevel,
  normalizeTargetLevel,
  legRMultiple,
};
export type { ScenarioViewMode };
