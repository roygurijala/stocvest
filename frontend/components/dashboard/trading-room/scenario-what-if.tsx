"use client";

import { useEffect, useMemo, useState } from "react";
import { spacing, borderRadius, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import { minRiskRewardForVerdict } from "@/lib/trade-conviction-tier";
import {
  buildScenarioGeometrySource,
  buildScenarioVariantCatalog,
  resolveScenarioLevels,
  scenarioRrBarFills,
  type ScenarioPresetId,
  type ScenarioSelection
} from "@/lib/scenario/scenario-variants";
import { evaluateScenarioDeskGate, parseTarget2Provenance, type Target2Provenance } from "@/lib/target-provenance";

/**
 * Inline "what-if" planner for the Trading Room deep dive.
 *
 * Lets the user nudge entry / stop / target (or pick an archetype preset) and
 * see the resulting R/R live — no modal, no broker action. Reuses the tested
 * scenario engine in `lib/scenario/scenario-variants` for preset geometry and
 * the same long/short R/R math the rest of the app uses. Planning only — this
 * never changes the system verdict, ledger, or actionable counts.
 */

type Direction = "bullish" | "bearish";

function rrFor(direction: Direction, entry: number, stop: number, target: number): number | null {
  const risk = direction === "bullish" ? entry - stop : stop - entry;
  const reward = direction === "bullish" ? target - entry : entry - target;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return reward / risk;
}

function stepFor(price: number): number {
  if (price >= 100) return 0.1;
  if (price >= 10) return 0.05;
  return 0.01;
}

const PRESET_LABELS: Record<ScenarioPresetId, string> = {
  dip: "Dip",
  continuation: "Continuation",
  breakout: "Breakout"
};

export function ScenarioWhatIf({
  direction,
  mode,
  current,
  systemStop,
  systemTarget,
  target1,
  target2,
  entryZoneLow,
  entryZoneHigh,
  vwap,
  atr,
  systemRiskReward,
  minRrGate,
  target2Provenance = null,
  colors
}: {
  direction: Direction;
  mode: "day" | "swing";
  current: number;
  systemStop: number;
  systemTarget: number;
  target1: number | null;
  target2: number | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  vwap: number | null;
  atr: number | null;
  systemRiskReward: number | null;
  /** VIX-tier desk minimum when available; falls back to static desk baseline. */
  minRrGate?: number;
  target2Provenance?: Target2Provenance | string | null;
  colors: ThemeColors;
}) {
  const source = useMemo(
    () =>
      buildScenarioGeometrySource({
        bias: direction === "bullish" ? "Bullish" : "Bearish",
        entryZoneLow,
        entryZoneHigh,
        last: current,
        structuralStop: systemStop,
        target1,
        target2,
        vwap,
        atr,
        systemRiskReward
      }),
    [direction, entryZoneLow, entryZoneHigh, current, systemStop, target1, target2, vwap, atr, systemRiskReward]
  );

  const catalog = useMemo(() => (source ? buildScenarioVariantCatalog(source) : null), [source]);

  // Editable levels — seed from the system reference and reset when the symbol/levels change.
  const [entry, setEntry] = useState(current);
  const [stop, setStop] = useState(systemStop);
  const [target, setTarget] = useState(systemTarget);
  const [activePreset, setActivePreset] = useState<ScenarioPresetId | "system" | "custom">("system");

  useEffect(() => {
    setEntry(current);
    setStop(systemStop);
    setTarget(systemTarget);
    setActivePreset("system");
  }, [current, systemStop, systemTarget]);

  const applyPreset = (id: ScenarioPresetId) => {
    if (!source || !catalog) return;
    const lvl = resolveScenarioLevels(source, catalog.presets[id] as ScenarioSelection);
    if (!lvl) return;
    setEntry(lvl.entry);
    setStop(lvl.stop);
    setTarget(lvl.target);
    setActivePreset(id);
  };

  const resetSystem = () => {
    setEntry(current);
    setStop(systemStop);
    setTarget(systemTarget);
    setActivePreset("system");
  };

  const rr = rrFor(direction, entry, stop, target);
  const gate =
    typeof minRrGate === "number" && Number.isFinite(minRrGate) && minRrGate > 0
      ? minRrGate
      : minRiskRewardForVerdict(mode);
  const provenance = parseTarget2Provenance(target2Provenance);
  const gateEval = evaluateScenarioDeskGate({
    direction,
    entry,
    stop,
    target,
    target1,
    target2,
    target2Provenance: provenance,
    deskMinRr: gate
  });
  const clears = gateEval.clearsDeskRr;
  const risk = direction === "bullish" ? entry - stop : stop - entry;
  const reward = direction === "bullish" ? target - entry : entry - target;
  const tone = gateEval.gateBlockReason
    ? colors.caution
    : rr == null
      ? colors.textMuted
      : clears
        ? colors.bullish
        : rr >= 1
          ? colors.caution
          : colors.bearish;
  const fills = scenarioRrBarFills(rr ?? 0);
  const step = stepFor(current);

  if (!source || !catalog) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.sm,
    color: colors.text,
    fontSize: typography.scale.sm,
    fontVariantNumeric: "tabular-nums",
    padding: `${spacing[1]} ${spacing[2]}`
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: colors.textMuted
  };

  return (
    <div
      style={{
        marginTop: spacing[4],
        padding: spacing[4],
        background: colors.surfaceMuted ?? colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: spacing[2] }}>
        <p style={{ ...labelStyle, fontSize: 10, letterSpacing: "1.4px", margin: 0 }}>What-if planner</p>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          Planning only — not advice
        </span>
      </div>

      {/* Archetype presets */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[3] }}>
        {(Object.keys(PRESET_LABELS) as ScenarioPresetId[]).map((id) => {
          const active = activePreset === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => applyPreset(id)}
              style={{
                padding: `${spacing[1]} ${spacing[3]}`,
                fontSize: typography.scale.xs,
                fontWeight: 600,
                color: active ? colors.surface : colors.text,
                background: active ? colors.accent : colors.surface,
                border: `1px solid ${active ? colors.accent : colors.border}`,
                borderRadius: 999,
                cursor: "pointer"
              }}
            >
              {PRESET_LABELS[id]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={resetSystem}
          style={{
            padding: `${spacing[1]} ${spacing[3]}`,
            fontSize: typography.scale.xs,
            fontWeight: 600,
            color: activePreset === "system" ? colors.surface : colors.textMuted,
            background: activePreset === "system" ? colors.accent : "transparent",
            border: `1px solid ${activePreset === "system" ? colors.accent : colors.border}`,
            borderRadius: 999,
            cursor: "pointer"
          }}
        >
          System
        </button>
      </div>

      {/* Editable entry / stop / target */}
      <div
        className="scenario-what-if-levels"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: spacing[3], marginTop: spacing[3] }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={labelStyle}>Entry</span>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            value={Number.isFinite(entry) ? entry : ""}
            onChange={(e) => {
              setEntry(parseFloat(e.target.value));
              setActivePreset("custom");
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ ...labelStyle, color: colors.bearish }}>Stop</span>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            value={Number.isFinite(stop) ? stop : ""}
            onChange={(e) => {
              setStop(parseFloat(e.target.value));
              setActivePreset("custom");
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ ...labelStyle, color: colors.bullish }}>Target</span>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            value={Number.isFinite(target) ? target : ""}
            onChange={(e) => {
              setTarget(parseFloat(e.target.value));
              setActivePreset("custom");
            }}
            style={inputStyle}
          />
        </label>
      </div>

      {/* Quick target swaps */}
      {(target1 != null || target2 != null) ? (
        <div style={{ display: "flex", gap: spacing[2], marginTop: spacing[2] }}>
          {target1 != null ? (
            <button
              type="button"
              onClick={() => {
                setTarget(target1);
                setActivePreset("custom");
              }}
              style={{
                padding: `2px ${spacing[2]}`,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                background: "transparent",
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.sm,
                cursor: "pointer"
              }}
            >
              Target → T1 ${target1.toFixed(2)}
            </button>
          ) : null}
          {target2 != null ? (
            <button
              type="button"
              onClick={() => {
                setTarget(target2);
                setActivePreset("custom");
              }}
              style={{
                padding: `2px ${spacing[2]}`,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                background: "transparent",
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.sm,
                cursor: "pointer"
              }}
            >
              Target → T2 ${target2.toFixed(2)}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Live R/R readout */}
      <div style={{ display: "flex", alignItems: "center", gap: spacing[4], marginTop: spacing[4] }}>
        <div style={{ minWidth: 92 }}>
          <p style={{ margin: 0, fontSize: typography.scale["2xl"], fontWeight: 700, color: tone, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {rr != null ? rr.toFixed(1) : "—"}
            <span style={{ color: colors.textMuted, fontWeight: 700 }}>:1</span>
          </p>
          <p style={{ margin: "3px 0 0", fontSize: typography.scale.xs, color: tone }}>
            {rr == null
              ? "Invalid geometry"
              : gateEval.gateBlockReason
                ? gateEval.gateBlockReason
                : clears
                  ? `Clears ${gate.toFixed(1)}:1 gate`
                  : `Below ${gate.toFixed(1)}:1 gate`}
          </p>
        </div>
        <div style={{ flex: 1 }}>
          {/* risk : reward split bar */}
          <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", border: `1px solid ${colors.border}` }}>
            <div style={{ width: `${(fills.risk * 100).toFixed(1)}%`, background: "rgba(239,68,68,.6)" }} />
            <div style={{ width: `${(fills.reward * 100).toFixed(1)}%`, background: "rgba(34,197,94,.6)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: typography.scale.xs, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
            <span>risk ${risk > 0 ? risk.toFixed(2) : "—"}/sh</span>
            <span>reward ${reward > 0 ? reward.toFixed(2) : "—"}/sh</span>
          </div>
        </div>
      </div>
    </div>
  );
}
