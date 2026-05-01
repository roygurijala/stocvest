"use client";

import { motion } from "framer-motion";
import { Brain } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { borderRadius, colorTokens, spacing, typography } from "@/lib/design-system";
import { layerFreshnessFromIso, type EvidenceLayer, type EvidenceStatus, type SignalEvidenceData } from "@/lib/signal-evidence";

interface SignalEvidenceCardProps {
  evidence: SignalEvidenceData;
}

function statusColor(status: EvidenceStatus): string {
  const colors = colorTokens.dark;
  if (status === "Bullish") return colors.bullish;
  if (status === "Bearish") return colors.bearish;
  if (status === "Neutral") return colors.caution;
  return colors.textMuted;
}

function formatLevel(n: number | null | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "-";
}

function conflictingLayers(layers: EvidenceLayer[], direction: SignalEvidenceData["direction"]): EvidenceLayer[] {
  if (direction === "neutral") {
    return layers.filter((l) => l.status !== "Neutral" && l.status !== "Unavailable");
  }
  const conflictStatus = direction === "bullish" ? "Bearish" : "Bullish";
  return layers.filter((l) => l.status === conflictStatus);
}

const MAX_UPDATED_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** If setup time is missing, invalid, in the future, or older than 30 days, avoid bogus "h ago" strings. */
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

export function SignalEvidenceCard({ evidence }: SignalEvidenceCardProps) {
  const colors = colorTokens.dark;
  const arcRadius = 44;
  const circumference = 2 * Math.PI * arcRadius;
  const pct = Math.max(0, Math.min(100, evidence.confidencePercent));
  const offset = circumference - (pct / 100) * circumference;
  const directionTone = evidence.direction === "bullish" ? colors.bullish : evidence.direction === "bearish" ? colors.bearish : colors.caution;
  const conflicts = conflictingLayers(evidence.layers, evidence.direction);

  return (
    <article style={{ display: "grid", gap: spacing[4] }}>
      <section style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[3] }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
          <h2 style={{ margin: 0 }}>{evidence.symbol}</h2>
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
        </div>
        <div style={{ display: "grid", justifyItems: "center", gap: spacing[1] }}>
          <svg width="108" height="108" viewBox="0 0 108 108">
            <circle cx="54" cy="54" r={arcRadius} stroke="rgba(148,163,184,0.25)" strokeWidth="10" fill="transparent" />
            <motion.circle
              cx="54"
              cy="54"
              r={arcRadius}
              stroke={directionTone}
              strokeWidth="10"
              fill="transparent"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1, ease: "easeOut" }}
              style={{ transformOrigin: "50% 50%", transform: "rotate(-90deg)" }}
            />
            <text x="54" y="60" textAnchor="middle" fill={colors.text} fontSize="20" fontWeight="700">
              {pct}%
            </text>
          </svg>
          <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{displayUpdatedLabel(evidence)}</span>
        </div>
      </section>

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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
                <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
                  <span>{layer.icon}</span>
                  <strong>{layer.name}</strong>
                </div>
                <span
                  style={{
                    borderRadius: borderRadius.full,
                    padding: "2px 8px",
                    background: "rgba(148,163,184,0.15)",
                    color: statusColor(layer.status),
                    fontSize: typography.scale.xs
                  }}
                >
                  {layer.status}
                </span>
              </div>
              <p style={{ margin: 0, color: colors.textMuted }}>{layer.explanation}</p>
              <div style={{ display: "flex", gap: spacing[2], flexWrap: "wrap" }}>
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

      <section style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3], display: "grid", gap: spacing[2] }}>
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: spacing[2] }}>
          <Brain size={18} />
          AI Verdict
        </h3>
        <p style={{ margin: 0, fontStyle: "italic" }}>"{evidence.aiVerdict}"</p>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>AI Analysis</span>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{evidence.aiFreshnessLabel}</span>
      </section>

      {conflicts.length > 0 ? (
        <section
          style={{
            border: `1px solid rgba(245,158,11,0.45)`,
            background: "rgba(245,158,11,0.12)",
            borderRadius: borderRadius.lg,
            padding: spacing[3]
          }}
        >
          <h3 style={{ marginTop: 0, color: colors.caution }}>Risk Factors</h3>
          <ul style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: spacing[1] }}>
            {conflicts.map((layer) => (
              <li key={layer.key}>
                <strong>{layer.name}:</strong> {layer.explanation}
              </li>
            ))}
          </ul>
          <span style={{ display: "block", marginTop: spacing[2], color: colors.textMuted, fontSize: typography.scale.xs }}>
            Updated 1m ago
          </span>
        </section>
      ) : null}

      <section style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3], display: "grid", gap: spacing[3] }}>
        <h3 style={{ margin: 0 }}>Key Levels</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: spacing[2] }}>
          {[
            ["VWAP", evidence.keyLevels.vwap],
            ["Support", evidence.keyLevels.support],
            ["Resistance", evidence.keyLevels.resistance],
            ["OR High", evidence.keyLevels.orHigh],
            ["OR Low", evidence.keyLevels.orLow]
          ].map(([label, value]) => (
            <div key={String(label)} style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing[2] }}>
              <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>{label}</p>
              <strong>{formatLevel(value as number | null | undefined)}</strong>
            </div>
          ))}
        </div>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>Updated 30s ago</span>
      </section>

      <section style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3], display: "grid", gap: spacing[2] }}>
        <h3 style={{ margin: 0 }}>Confidence Breakdown</h3>
        <div style={{ height: 200 }}>
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
                  <Cell key={l.key} fill={statusColor(l.status)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{evidence.newsFreshnessLabel}</span>
      </section>
    </article>
  );
}
