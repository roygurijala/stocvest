"use client";

import { useMemo } from "react";
import { formatScenarioDollars } from "@/lib/scenario/compute";
import {
  formatScenarioRatio,
  resolveScenarioLevels,
  type ScenarioPresetId,
  type ScenarioVariantCatalog
} from "@/lib/scenario/scenario-variants";
import { scenarioClearsDeskRrGate } from "@/lib/scenario/scenario-verdict";
import type { ScenarioMode } from "@/lib/scenario/types";
import { minRiskRewardForVerdict } from "@/lib/trade-conviction-tier";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Row = {
  id: string;
  label: string;
  entry: number;
  stop: number;
  target: number;
  riskReward: number | null;
};

const PRESET_LABELS: Record<ScenarioPresetId, string> = {
  default: "System default",
  conservative: "Conservative",
  aggressive: "Aggressive"
};

function buildRows(
  catalog: ScenarioVariantCatalog,
  userEntry: number,
  userStop: number,
  userTarget: number
): Row[] {
  const rows: Row[] = [];
  for (const preset of ["default", "conservative", "aggressive"] as ScenarioPresetId[]) {
    const selection = catalog.presets[preset];
    const resolved = resolveScenarioLevels(catalog.source, selection);
    if (!resolved) continue;
    rows.push({
      id: preset,
      label: PRESET_LABELS[preset],
      entry: resolved.entry,
      stop: resolved.stop,
      target: resolved.target,
      riskReward: resolved.riskReward
    });
  }
  const userRr = (() => {
    if (!Number.isFinite(userEntry) || !Number.isFinite(userStop) || !Number.isFinite(userTarget)) {
      return null;
    }
    const dir = catalog.source.direction;
    if (dir === "bullish") {
      const risk = userEntry - userStop;
      const reward = userTarget - userEntry;
      if (risk <= 1e-6 || reward <= 1e-6) return null;
      return Math.round((reward / risk) * 100) / 100;
    }
    const risk = userStop - userEntry;
    const reward = userEntry - userTarget;
    if (risk <= 1e-6 || reward <= 1e-6) return null;
    return Math.round((reward / risk) * 100) / 100;
  })();

  rows.push({
    id: "your_plan",
    label: "Your plan",
    entry: userEntry,
    stop: userStop,
    target: userTarget,
    riskReward: userRr
  });
  return rows;
}

type Props = {
  catalog: ScenarioVariantCatalog;
  mode: ScenarioMode;
  entry: number;
  stop: number;
  target: number;
  onApplyPreset: (preset: ScenarioPresetId) => void;
};

export function ScenarioBuilderComparisonTable({
  catalog,
  mode,
  entry,
  stop,
  target,
  onApplyPreset
}: Props) {
  const { colors } = useTheme();
  const minRr = minRiskRewardForVerdict(mode);
  const rows = useMemo(() => buildRows(catalog, entry, stop, target), [catalog, entry, stop, target]);

  return (
    <section
      data-testid="scenario-comparison-table"
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
        Scenario comparison — R/R at each geometry
      </h3>
      <p style={{ margin: 0, marginBottom: spacing[3], color: colors.textMuted, fontSize: typography.scale.xs }}>
        Desk minimum {minRr.toFixed(1)} : 1 for {mode} mode. Click a preset to load its entry / stop / target into your plan.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-xs" style={{ color: colors.text }}>
          <thead>
            <tr style={{ color: colors.textMuted }}>
              <th className="pb-2 pr-2 font-semibold">Scenario</th>
              <th className="pb-2 pr-2 font-semibold">Entry</th>
              <th className="pb-2 pr-2 font-semibold">Stop</th>
              <th className="pb-2 pr-2 font-semibold">Target</th>
              <th className="pb-2 font-semibold">R/R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clears = row.riskReward != null && scenarioClearsDeskRrGate(row.riskReward, mode);
              const isPreset = row.id !== "your_plan";
              return (
                <tr key={row.id} data-testid={`scenario-comparison-row-${row.id}`}>
                  <td className="py-2 pr-2 align-top">
                    {isPreset ? (
                      <button
                        type="button"
                        className="border-0 bg-transparent p-0 text-left text-xs font-semibold underline-offset-2 hover:underline"
                        style={{ color: colors.accent, cursor: "pointer" }}
                        onClick={() => onApplyPreset(row.id as ScenarioPresetId)}
                      >
                        {row.label}
                      </button>
                    ) : (
                      <span className="font-semibold">{row.label}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 tabular-nums">{formatScenarioDollars(row.entry, { fractionDigits: 2 })}</td>
                  <td className="py-2 pr-2 tabular-nums">{formatScenarioDollars(row.stop, { fractionDigits: 2 })}</td>
                  <td className="py-2 pr-2 tabular-nums">{formatScenarioDollars(row.target, { fractionDigits: 2 })}</td>
                  <td
                    className="py-2 tabular-nums font-semibold"
                    style={{ color: clears ? colors.bullish : colors.caution }}
                  >
                    {row.riskReward != null ? formatScenarioRatio(row.riskReward) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
