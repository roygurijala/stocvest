"use client";

import { useMemo } from "react";
import { useSignalComposite } from "@/lib/hooks/use-signal-composite";
import { borderRadius, spacing, typography, type ThemeColors } from "@/lib/design-system";
import { minRrForDeskMode } from "@/lib/signal-evidence/market-environment-present";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import {
  roundRiskRewardDisplay,
  structureRiskRewardLong,
  structureRiskRewardShort
} from "@/lib/risk-reward-structure";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function zone(v: unknown): { low: number; high: number } | null {
  if (!v || typeof v !== "object") return null;
  const z = v as Record<string, unknown>;
  const lo = num(z.low);
  const hi = num(z.high);
  return lo != null && hi != null && hi > lo ? { low: lo, high: hi } : null;
}

function resolveRiskReward(
  composite: Record<string, unknown> | null,
  entry: { low: number; high: number } | null,
  stop: number | null,
  target1: number | null,
  target2: number | null,
  isLong: boolean
): number | null {
  const fromPayload = num(composite?.risk_reward);
  if (fromPayload != null) return roundRiskRewardDisplay(fromPayload);

  const price =
    num(composite?.last_trade_price) ??
    num(composite?.last_price) ??
    (entry != null ? (entry.low + entry.high) / 2 : null);
  if (price == null || stop == null || target1 == null) return null;

  const raw = isLong
    ? structureRiskRewardLong(price, target1, stop, target2)
    : structureRiskRewardShort(price, target1, stop, target2);
  return raw != null ? roundRiskRewardDisplay(raw) : null;
}

type Props = {
  symbol: string;
  lane: "day" | "swing";
  colors: ThemeColors;
  environment?: MarketEnvironmentPayload | null;
  bias?: "bull" | "bear" | "neutral";
};

export function ScannerDetailKeyLevels({ symbol, lane, colors, environment = null, bias = "neutral" }: Props) {
  const { composite, isInitialLoading } = useSignalComposite(symbol, lane);

  const levels = useMemo(() => {
    if (!composite) return null;
    const c = composite as Record<string, unknown>;
    const entry = zone(c.historical_entry_zone ?? c.session_entry_zone);
    const stop = num(c.reference_stop_level);
    const target1 = num(c.reference_target_1);
    const target2 = num(c.reference_target_2);
    const isLong = bias !== "bear";
    const riskReward = resolveRiskReward(c, entry, stop, target1, target2, isLong);
    return { riskReward, entry, stop, target1, target2 };
  }, [composite, bias]);

  if (isInitialLoading) {
    return (
      <p style={{ margin: `${spacing[3]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
        Loading setup context…
      </p>
    );
  }

  const hasLevels =
    levels != null &&
    (levels.stop != null || levels.target1 != null || levels.entry != null);
  const riskReward = levels?.riskReward ?? null;

  if (riskReward == null && !hasLevels) return null;

  const minRr = minRrForDeskMode(environment, lane);
  const clearsGate = riskReward != null && riskReward >= minRr;

  const Level = ({ label, value, tone }: { label: string; value: string; tone: string }) => (
    <div
      style={{
        padding: `${spacing[2]} ${spacing[2]}`,
        borderRadius: borderRadius.sm,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted ?? colors.surface
      }}
    >
      <p style={{ margin: 0, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: colors.textMuted }}>
        {label}
      </p>
      <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.sm, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </p>
    </div>
  );

  return (
    <div style={{ marginTop: spacing[3] }}>
      {riskReward != null ? (
        <>
          <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
              R/R{" "}
            </span>
            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: colors.accent }}>
              {riskReward.toFixed(1)}:1
            </span>
          </p>
          {environment ? (
            <p
              style={{
                margin: `${spacing[1]} 0 0`,
                fontSize: typography.scale.xs,
                color: clearsGate ? colors.bullish : colors.caution,
                fontWeight: 600
              }}
            >
              {clearsGate
                ? `Clears ${minRr.toFixed(1)}:1 desk gate`
                : `Below ${minRr.toFixed(1)}:1 desk gate (${riskReward.toFixed(1)}:1)`}
              {environment.environment_tier !== "normal" ? ` · ${environment.environment_tier} session` : ""}
            </p>
          ) : null}
        </>
      ) : null}
      {hasLevels ? (
        <>
          <p style={{ margin: `${spacing[2]} 0 ${spacing[2]}`, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
            Key levels
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(7rem, 1fr))", gap: spacing[2] }}>
            {levels?.entry ? (
              <Level
                label="Entry zone"
                value={`$${levels.entry.low.toFixed(2)}–$${levels.entry.high.toFixed(2)}`}
                tone={colors.accent}
              />
            ) : null}
            {levels?.stop != null ? <Level label="Stop" value={`$${levels.stop.toFixed(2)}`} tone={colors.bearish} /> : null}
            {levels?.target1 != null ? <Level label="Target" value={`$${levels.target1.toFixed(2)}`} tone={colors.bullish} /> : null}
            {levels?.target2 != null ? <Level label="Target 2" value={`$${levels.target2.toFixed(2)}`} tone={colors.bullish} /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
