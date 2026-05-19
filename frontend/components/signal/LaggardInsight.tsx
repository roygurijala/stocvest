"use client";

import type { CSSProperties } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import {
  DRIVER_CONFIG,
  LAGGARD_CONFIG,
  driverBadgeColor,
  driverBadgeLabel,
  type DriverType,
  type LaggardSignal,
  type LaggardType
} from "@/lib/laggard";
import { UpgradePrompt } from "@/components/upgrade-prompt";

type LaggardInsightProps = {
  signal: LaggardSignal | null | undefined;
  isPaid: boolean;
  mode: "day" | "swing" | undefined;
};

function badgeStyle(color: string, bg: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    borderRadius: borderRadius.full,
    padding: "2px 10px",
    fontSize: typography.scale.xs,
    fontWeight: 600,
    border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
    background: bg,
    color
  };
}

export function LaggardInsight({ signal, isPaid, mode }: LaggardInsightProps) {
  const { colors } = useTheme();

  if (mode === "day") return null;

  const shell: CSSProperties = {
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    display: "grid",
    gap: spacing[2]
  };

  if (!isPaid) {
    return (
      <section data-testid="laggard-insight-upgrade" style={shell}>
        <h3 style={{ margin: 0, fontSize: typography.scale.sm, letterSpacing: "0.06em" }}>RELATIVE STRENGTH DIVERGENCE</h3>
        <p className="m-0 text-sm" style={{ color: colors.textMuted, lineHeight: 1.5 }}>
          Context when a symbol lags peers that are already moving — display only, not scored into the signal.
        </p>
        <UpgradePrompt
          feature="Laggard intelligence"
          plan="Swing Pro"
          description="See peer divergence context on swing evidence cards."
        />
      </section>
    );
  }

  if (!signal?.has_laggard_signal) return null;

  const lagType = signal.laggard_type as LaggardType | undefined;
  const typeCfg = lagType ? LAGGARD_CONFIG[lagType] : null;
  const driverType = signal.driver_type as DriverType | undefined;
  const driverColor = driverBadgeColor(driverType);
  const driverIcon = driverType ? DRIVER_CONFIG[driverType].icon : "◆";
  const label = driverBadgeLabel(signal);
  const peers = signal.context?.peers_moving ?? [];
  const isDistribution = lagType === "distribution";

  return (
    <section data-testid="laggard-insight-panel" style={shell}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: spacing[2] }}>
        <h3 style={{ margin: 0, fontSize: typography.scale.sm, letterSpacing: "0.06em" }}>RELATIVE STRENGTH DIVERGENCE</h3>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>(not scored)</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        <span data-testid="laggard-driver-badge" style={badgeStyle(driverColor, `color-mix(in srgb, ${driverColor} 12%, transparent)`)}>
          <span aria-hidden>{driverIcon}</span>
          {label}
          {signal.trigger_entity ? (
            <span style={{ fontWeight: 500, opacity: 0.9 }} data-testid="laggard-trigger-entity">
              · {signal.trigger_entity}
            </span>
          ) : null}
        </span>
        {typeCfg ? (
          <span data-testid={`laggard-type-${lagType}`} style={badgeStyle(typeCfg.color, typeCfg.bgClass)}>
            {typeCfg.label}
            {typeCfg.isOpportunity ? null : (
              <span style={{ fontWeight: 500, marginLeft: 4 }}>· bearish divergence</span>
            )}
          </span>
        ) : null}
        {signal.confidence ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            {String(signal.confidence)} confidence
            {typeof signal.laggard_score === "number" ? ` · score ${signal.laggard_score.toFixed(1)}` : ""}
          </span>
        ) : null}
      </div>
      {signal.narrative?.explanation ? (
        <p className="m-0 text-sm leading-relaxed" style={{ color: colors.text }}>
          {signal.narrative.explanation}
        </p>
      ) : null}
      {peers.length > 0 ? (
        <div data-testid="laggard-peer-chips" style={{ display: "flex", flexWrap: "wrap", gap: spacing[1] }}>
          {peers.slice(0, 8).map((p) => (
            <span
              key={p.symbol}
              style={{
                fontFamily: typography.fontFamilyMono,
                fontSize: typography.scale.xs,
                padding: "2px 8px",
                borderRadius: borderRadius.md,
                background: colors.surfaceMuted,
                color: colors.text
              }}
            >
              {p.symbol} {p.move_1d >= 0 ? "+" : ""}
              {p.move_1d.toFixed(1)}%
            </span>
          ))}
        </div>
      ) : null}
      {signal.narrative?.what_to_watch ? (
        <div
          data-testid="laggard-what-to-watch"
          style={{
            borderRadius: borderRadius.md,
            padding: spacing[2],
            background: isDistribution ? "rgba(239,68,68,0.06)" : colors.surfaceMuted,
            border: `1px solid ${isDistribution ? "rgba(239,68,68,0.25)" : colors.border}`
          }}
        >
          <p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            What to watch
          </p>
          <p className="m-0 mt-1 text-sm leading-relaxed" style={{ color: colors.text }}>
            {signal.narrative.what_to_watch}
          </p>
        </div>
      ) : null}
      <p className="m-0 text-xs italic" style={{ color: colors.textMuted }}>
        Display context only — not scored into the swing signal.
        {isDistribution ? " Distribution reads as relative weakness, not a catch-up setup." : ""}
      </p>
    </section>
  );
}
