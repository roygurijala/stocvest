"use client";

import { Brain } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import {
  deriveEvidenceInsightFallback,
  layerFreshnessFromIso,
  type EvidenceLayer,
  type EvidenceStatus,
  type SignalEvidenceData,
  type SignalEvidenceInsight
} from "@/lib/signal-evidence";
import { AI_VERDICT_TIP, CONFIDENCE_PERCENT_TIP, LAYER_NAME_HINTS } from "@/lib/ui-tooltips";

interface SignalEvidenceCardProps {
  evidence: SignalEvidenceData;
}

function statusColor(status: EvidenceStatus, colors: ThemeColors): string {
  if (status === "Bullish") return colors.bullish;
  if (status === "Bearish") return colors.bearish;
  if (status === "Neutral") return colors.caution;
  return colors.textMuted;
}

function formatLevel(n: number | null | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "—";
}

const MAX_UPDATED_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function displayUpdatedLabel(evidence: SignalEvidenceData): string {
  const raw = evidence.updatedAtIso;
  if (raw == null || String(raw).trim() === "") {
    return "Just now";
  }
  const ms = Date.parse(String(raw));
  if (!Number.isFinite(ms)) {
    return "Just now";
  }
  const ageMs = Date.now() - ms;
  if (ageMs < 0 || ageMs > MAX_UPDATED_AGE_MS) {
    return "Just now";
  }
  return evidence.updatedLabel;
}

const MAX_REASONABLE_HOURS = 24 * 30;

function displayLayerFreshness(layer: EvidenceLayer, evidence: SignalEvidenceData): string {
  if (layer.key === "technical") {
    return layerFreshnessFromIso(evidence.updatedAtIso);
  }
  const m = /^Updated (\d+)h ago$/.exec(layer.freshnessLabel);
  if (m) {
    const hours = Number(m[1]);
    if (Number.isFinite(hours) && hours > MAX_REASONABLE_HOURS) {
      return "Just now";
    }
  }
  return layer.freshnessLabel;
}

function scoreHeaderColor(score: number, colors: ThemeColors): string {
  if (score >= 70) return colors.bullish;
  if (score >= 50) return colors.caution;
  return colors.bearish;
}

function trendStrengthColor(strength: string, colors: ThemeColors): string {
  const s = strength.toLowerCase();
  if (s === "strong") return colors.bullish;
  if (s === "moderate") return colors.caution;
  return colors.bearish;
}

function rrChipColor(rr: number, colors: ThemeColors): string {
  if (rr >= 4) return colors.bullish;
  if (rr >= 3) return "#86efac";
  if (rr >= 2) return colors.text;
  if (rr >= 1.5) return colors.caution;
  return colors.bearish;
}

function regimeColor(regime: string, colors: ThemeColors): string {
  const r = regime.toLowerCase();
  if (r === "bullish") return colors.bullish;
  if (r === "bearish") return colors.bearish;
  return colors.caution;
}

function rrMarkerPct(rr: number): number {
  const clamped = Math.max(0.5, Math.min(3.5, rr));
  return ((clamped - 0.5) / 3.0) * 100;
}

function confluenceChips(evidence: SignalEvidenceData, insight: SignalEvidenceInsight) {
  const yes =
    evidence.confluence?.confirming_signals?.length ? evidence.confluence.confirming_signals : insight.confirming_signals;
  const no =
    evidence.confluence?.conflicting_signals?.length ? evidence.confluence.conflicting_signals : insight.conflicting_signals;
  return { yes, no };
}

export function SignalEvidenceCard({ evidence }: SignalEvidenceCardProps) {
  const { colors } = useTheme();
  const insight = evidence.insight ?? deriveEvidenceInsightFallback(evidence);
  const directionTone =
    evidence.direction === "bullish" ? colors.bullish : evidence.direction === "bearish" ? colors.bearish : colors.caution;
  const { yes: confYes, no: confNo } = confluenceChips(evidence, insight);
  const showConfluencePanel = confYes.length > 0 || confNo.length > 0;
  const entryZone =
    insight.historical_entry_zone ??
    (typeof evidence.keyLevels.support === "number" && typeof evidence.keyLevels.resistance === "number"
      ? { low: evidence.keyLevels.support, high: evidence.keyLevels.resistance }
      : null);
  const rt1 = insight.reference_target_1 ?? evidence.keyLevels.resistance ?? null;
  const rt2 = insight.reference_target_2 ?? (typeof evidence.keyLevels.resistance === "number" ? evidence.keyLevels.resistance * 1.012 : null);
  const stopLvl = insight.reference_stop_level ?? evidence.keyLevels.support ?? null;
  const vwap = insight.vwap ?? evidence.keyLevels.vwap ?? null;
  const levelsComplete = Boolean(entryZone && rt1 != null && stopLvl != null && vwap != null);

  return (
    <article style={{ display: "grid", gap: spacing[4], position: "relative", paddingBottom: spacing[4] }}>
      {evidence.earningsRisk ? (
        <section
          style={{
            border: "1px solid rgba(245,158,11,0.5)",
            background: "rgba(245,158,11,0.14)",
            borderRadius: borderRadius.lg,
            padding: spacing[3]
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, color: colors.caution }}>
            ⚠️ Earnings Risk: {evidence.symbol} reports earnings in {evidence.earningsRisk.daysUntil} day
            {evidence.earningsRisk.daysUntil === 1 ? "" : "s"} (
            {evidence.earningsRisk.reportTime === "before_market"
              ? "before market"
              : evidence.earningsRisk.reportTime === "after_market"
                ? "after market close"
                : evidence.earningsRisk.reportTime === "during_market"
                  ? "during market"
                  : "timing TBD"}
            )
          </p>
          <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.textMuted }}>
            All signals carry additional uncertainty until after the earnings report. Signal parameters show elevated event risk —
            size and timing are solely your decision.
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-xl sm:text-2xl" style={{ margin: 0 }}>
            {evidence.symbol}
          </h2>
          <span
            style={{
              borderRadius: borderRadius.full,
              padding: "4px 10px",
              fontSize: typography.scale.xs,
              fontWeight: 700,
              background: "rgba(148,163,184,0.14)",
              color: directionTone
            }}
          >
            {evidence.directionBadgeLabel}
          </span>
          <span
            style={{
              borderRadius: borderRadius.full,
              padding: "4px 10px",
              fontSize: typography.scale.xs,
              fontWeight: 700,
              letterSpacing: "0.04em",
              background: "rgba(59,130,246,0.12)",
              color: colors.textMuted
            }}
          >
            NOT INVESTMENT ADVICE
          </span>
        </div>
        <span className="text-sm" style={{ color: colors.textMuted }}>
          {displayUpdatedLabel(evidence)}
        </span>
      </section>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[1]
          }}
        >
          <span style={{ fontSize: typography.scale.xs, fontWeight: 700, letterSpacing: "0.06em", color: colors.textMuted }}>
            SIGNAL SCORE
          </span>
          <span
            className="text-3xl font-bold tabular-nums sm:text-4xl"
            style={{ color: scoreHeaderColor(insight.signal_score, colors), lineHeight: 1.1 }}
          >
            {insight.signal_score}
            <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, fontWeight: 600 }}> / 100</span>
          </span>
          <span className="inline-flex items-center gap-1 text-xs" style={{ color: colors.textMuted }}>
            Composite read
            <InfoTip text={CONFIDENCE_PERCENT_TIP} label="About signal score" />
          </span>
          {insight.is_complete === false ? (
            <span style={{ color: colors.caution, fontSize: typography.scale.xs, fontWeight: 700 }}>Incomplete</span>
          ) : null}
        </div>
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[1]
          }}
        >
          <span style={{ fontSize: typography.scale.xs, fontWeight: 700, letterSpacing: "0.06em", color: colors.textMuted }}>
            TREND STRENGTH
          </span>
          <span className="text-xl font-bold sm:text-2xl" style={{ color: trendStrengthColor(insight.trend_strength, colors) }}>
            {insight.trend_strength}
          </span>
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{insight.trend_direction}</span>
        </div>
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[1]
          }}
        >
          <span style={{ fontSize: typography.scale.xs, fontWeight: 700, letterSpacing: "0.06em", color: colors.textMuted }}>
            RISK / REWARD
          </span>
          <span className="text-xl font-bold tabular-nums sm:text-2xl" style={{ color: rrChipColor(insight.risk_reward, colors) }}>
            {insight.risk_reward.toFixed(1)}:1
          </span>
          {insight.rr_warning ? (
            <span style={{ color: colors.caution, fontSize: typography.scale.xs, fontWeight: 700 }}>Low R/R - below 2:1</span>
          ) : null}
          {insight.rr_quality ? (
            <span style={{ color: colors.textMuted, fontSize: typography.scale.xs, textTransform: "capitalize" }}>
              R/R quality: {insight.rr_quality}
            </span>
          ) : null}
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Entry R/R</span>
          <div
            style={{
              position: "relative",
              height: 8,
              borderRadius: borderRadius.full,
              background: "linear-gradient(90deg, rgba(239,68,68,0.85), rgba(245,158,11,0.7), rgba(34,197,94,0.9))",
              marginTop: 4
            }}
          >
            <span
              style={{
                position: "absolute",
                top: -2,
                width: 4,
                height: 12,
                borderRadius: 2,
                background: colors.text,
                left: `calc(${rrMarkerPct(insight.risk_reward)}% - 2px)`,
                boxShadow: "0 0 0 2px rgba(15,23,42,0.35)"
              }}
            />
          </div>
        </div>
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[1]
          }}
        >
          <span style={{ fontSize: typography.scale.xs, fontWeight: 700, letterSpacing: "0.06em", color: colors.textMuted }}>
            MARKET REGIME
          </span>
          <span className="text-xl font-bold sm:text-2xl" style={{ color: regimeColor(insight.market_regime, colors) }}>
            {insight.market_regime}
          </span>
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Macro / regime layer</span>
        </div>
      </section>

      {(insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio)) ||
      (insight.conflicted_layers != null && insight.conflicted_layers.length > 0) ? (
        <section
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[2]
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: typography.scale.sm,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: colors.textMuted
            }}
          >
            LAYER ALIGNMENT
          </h3>
          {insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio) ? (
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text }}>
              <strong style={{ color: colors.text }}>Agreement:</strong>{" "}
              {Math.round(insight.alignment_ratio * 100)}% of weighted layers align with the composite direction.
            </p>
          ) : null}
          {insight.conflicted_layers && insight.conflicted_layers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {insight.conflicted_layers.map((key) => (
                <span
                  key={key}
                  style={{
                    borderRadius: borderRadius.full,
                    padding: "4px 10px",
                    fontSize: typography.scale.xs,
                    border: `1px solid ${colors.caution}`,
                    background: "rgba(245,158,11,0.1)",
                    color: colors.caution,
                    fontWeight: 600,
                    textTransform: "lowercase"
                  }}
                >
                  {key}: divergent
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 style={{ marginTop: 0 }}>Signal Layer Breakdown</h3>
        <div style={{ display: "grid", gap: spacing[3] }}>
          {evidence.layers.map((layer) => (
            <article
              key={layer.key}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.lg,
                padding: spacing[3],
                display: "grid",
                gap: spacing[2]
              }}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span>{layer.icon}</span>
                  <strong className="inline-flex items-center gap-1.5 text-sm sm:text-base">
                    {layer.name}
                    <InfoTip text={LAYER_NAME_HINTS[layer.key] || "Signal layer readout."} label={layer.name} />
                  </strong>
                </div>
                <span
                  className="w-fit text-sm"
                  style={{
                    borderRadius: borderRadius.full,
                    padding: "2px 8px",
                    background: "rgba(148,163,184,0.15)",
                    color: statusColor(layer.status, colors)
                  }}
                >
                  {layer.status}
                </span>
              </div>
              <p className="text-sm leading-relaxed sm:text-base" style={{ margin: 0, color: colors.textMuted }}>
                {layer.explanation}
              </p>
              <div className="flex flex-wrap gap-2">
                {layer.keyPoints.map((point, idx) => (
                  <span
                    key={`${layer.key}-${idx}`}
                    style={{
                      borderRadius: borderRadius.full,
                      padding: "2px 8px",
                      fontSize: typography.scale.xs,
                      border: `1px solid ${colors.border}`,
                      color: colors.textMuted
                    }}
                  >
                    {point}
                  </span>
                ))}
              </div>
              <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{displayLayerFreshness(layer, evidence)}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div style={{ display: "grid", gap: spacing[3] }}>
          <div
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              display: "grid",
              gap: spacing[2]
            }}
          >
            <h3 style={{ margin: 0 }}>Reference Levels</h3>
            {!levelsComplete ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.caution }}>
                Signal data incomplete - levels unavailable
              </p>
            ) : null}
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Historical Entry Zone: </strong>
              {entryZone ? `${formatLevel(entryZone.low)}–${formatLevel(entryZone.high)}` : "—"}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Reference Target 1: </strong>
              {formatLevel(rt1)}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Reference Target 2: </strong>
              {formatLevel(rt2)}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Reference Stop Level: </strong>
              {formatLevel(stopLvl)}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>VWAP: </strong>
              {formatLevel(vwap)}
            </p>
            <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{displayUpdatedLabel(evidence)}</span>
          </div>

          {showConfluencePanel ? (
            <div
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.lg,
                padding: spacing[3],
                display: "grid",
                gap: spacing[2]
              }}
            >
              <h3 style={{ margin: 0 }}>Confirming Signals</h3>
              <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>
                From confluence — signal data only, not investment advice.
              </p>
              <div className="flex flex-wrap gap-2">
                {confYes.map((c, i) => (
                  <span
                    key={`cf-yes-${i}-${c.label}`}
                    style={{
                      borderRadius: borderRadius.full,
                      padding: "4px 10px",
                      fontSize: typography.scale.xs,
                      fontWeight: 600,
                      border: `1px solid rgba(34,197,94,0.45)`,
                      background: "rgba(34,197,94,0.12)",
                      color: colors.bullish
                    }}
                  >
                    {c.label} ✓
                  </span>
                ))}
                {confNo.map((c, i) => (
                  <span
                    key={`cf-no-${i}-${c.label}`}
                    style={{
                      borderRadius: borderRadius.full,
                      padding: "4px 10px",
                      fontSize: typography.scale.xs,
                      fontWeight: 600,
                      border: `1px solid rgba(239,68,68,0.45)`,
                      background: "rgba(239,68,68,0.12)",
                      color: colors.bearish
                    }}
                  >
                    {c.label} ✗
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: spacing[3] }}>
          <div
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              display: "grid",
              gap: spacing[2]
            }}
          >
            <h3 style={{ margin: 0 }}>Catalysts &amp; Context</h3>
            {insight.catalysts.length === 0 ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>No significant catalysts detected</p>
            ) : (
              <ul style={{ margin: 0, paddingInlineStart: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
                {insight.catalysts.slice(0, 3).map((c, i) => {
                  const dot =
                    c.sentiment === "positive"
                      ? colors.bullish
                      : c.sentiment === "negative"
                        ? colors.bearish
                        : colors.caution;
                  return (
                    <li key={`cat-${i}`} className="flex gap-2 text-sm" style={{ color: colors.text }}>
                      <span style={{ marginTop: 6, width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                      <span>{c.text.slice(0, 80)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              display: "grid",
              gap: spacing[2]
            }}
          >
            <h3 style={{ margin: 0 }}>Risk Factors</h3>
            {insight.risk_factors.length === 0 ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>No significant risk factors detected</p>
            ) : (
            <ul style={{ margin: 0, paddingInlineStart: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
              {insight.risk_factors.slice(0, 6).map((r, i) => (
                <li key={`risk-${i}`} className="flex gap-2 text-sm" style={{ color: colors.text }}>
                  <span
                    style={{
                      marginTop: 6,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: colors.bearish,
                      flexShrink: 0
                    }}
                  />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            )}
          </div>
        </div>
      </section>

      <section style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3], display: "grid", gap: spacing[2] }}>
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: spacing[2] }}>
          <Brain size={18} />
          AI Signal Analysis
          <InfoTip text={AI_VERDICT_TIP} label="About AI signal analysis" />
        </h3>
        <p style={{ margin: 0, fontStyle: "italic" }}>&ldquo;{evidence.aiVerdict}&rdquo;</p>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>Signal summary</span>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{evidence.aiFreshnessLabel}</span>
      </section>

      <section
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.lg,
          padding: spacing[3],
          display: "grid",
          gap: spacing[2]
        }}
      >
        <h3 style={{ margin: 0 }}>Signal Parameters</h3>
        <p
          style={{
            margin: 0,
            borderLeft: "2px solid rgba(0,180,255,0.3)",
            paddingLeft: 16,
            fontSize: 13,
            lineHeight: 1.8,
            color: colors.text
          }}
        >
          {insight.signal_parameters}
        </p>
      </section>

      <div
        style={{
          background: "rgba(255,193,7,0.06)",
          border: "1px solid rgba(255,193,7,0.2)",
          borderRadius: "8px",
          padding: "12px 16px",
          fontSize: "12px",
          color: "#8a9ab0",
          lineHeight: "1.6",
          marginBottom: "4px"
        }}
      >
        <strong style={{ color: "#f5c542" }}>Signal Data Only</strong>
        <br />
        This analysis surfaces technical patterns and signal data for informational purposes. It is not investment advice. Reference
        levels shown are derived from historical patterns — not predictions. You are solely responsible for all trading decisions.
      </div>

      <section style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3], display: "grid", gap: spacing[2] }}>
        <h3 style={{ margin: 0 }}>Signal Strength Breakdown</h3>
        <div className="h-[160px] w-full max-w-full lg:h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={evidence.layers.map((l) => ({
                layer: l.name,
                score: Math.round(l.contributionScore),
                status: l.status
              }))}
              layout="vertical"
            >
              <XAxis type="number" />
              <YAxis type="category" dataKey="layer" width={90} />
              <Bar dataKey="score" radius={[0, 6, 6, 0]}>
                {evidence.layers.map((l) => (
                  <Cell key={l.key} fill={statusColor(l.status, colors)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{evidence.newsFreshnessLabel}</span>
      </section>

      <footer style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing[2] }}>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{displayUpdatedLabel(evidence)}</span>
        <SignalDisclaimerChip />
      </footer>
    </article>
  );
}
