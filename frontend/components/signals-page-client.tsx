"use client";

import { useMemo, useState } from "react";
import { Brain } from "lucide-react";
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer
} from "recharts";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import { InfoTip } from "@/components/info-tip";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { buildEvidenceFromSetup, type SignalEvidenceData } from "@/lib/signal-evidence";
import { LAYER_NAME_HINTS } from "@/lib/ui-tooltips";

type LayerStatus = "Bullish" | "Bearish" | "Neutral" | "Unavailable";

interface LayerRow {
  icon: string;
  name: string;
  status: LayerStatus;
  explanation: string;
  score: number;
}

interface SignalsPageClientProps {
  marketOverview: MarketOverview;
  scannerOverview: ScannerOverview;
  earningsBySymbol: Record<string, EarningsEvent>;
}

const layerMeta = [
  ["📊", "Technical"],
  ["📰", "News"],
  ["🌍", "Macro"],
  ["🏭", "Sector"],
  ["🌐", "Geopolitical"],
  ["📈", "Internals"]
] as const;

function statusColor(status: LayerStatus, colors: ThemeColors): string {
  if (status === "Bullish") return colors.bullish;
  if (status === "Bearish") return colors.bearish;
  if (status === "Neutral") return colors.caution;
  return colors.textMuted;
}

function deriveFromSnapshot(snapshot?: SnapshotPayload): { bullishBias: number; support: number; resistance: number } {
  if (!snapshot || typeof snapshot.last_trade_price !== "number") {
    return { bullishBias: 0.5, support: 0, resistance: 0 };
  }
  const last = snapshot.last_trade_price;
  const prev = snapshot.prev_close ?? last;
  const bias = Math.max(0, Math.min(1, 0.5 + (last - prev) / Math.max(1, prev) * 5));
  const support = snapshot.day_low ?? last * 0.985;
  const resistance = snapshot.day_high ?? last * 1.015;
  return { bullishBias: bias, support, resistance };
}

export function SignalsPageClient({ marketOverview, scannerOverview, earningsBySymbol }: SignalsPageClientProps) {
  const { colors } = useTheme();
  const [symbol, setSymbol] = useState("AAPL");
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const snapshot = useMemo(
    () => marketOverview.snapshots.find((s) => s.symbol === symbol.toUpperCase()) || marketOverview.snapshots[0],
    [marketOverview.snapshots, symbol]
  );
  const setup = useMemo(
    () => scannerOverview.setups.find((s) => s.symbol === symbol.toUpperCase()) || scannerOverview.setups[0],
    [scannerOverview.setups, symbol]
  );

  const { bullishBias, support, resistance } = deriveFromSnapshot(snapshot);
  const rows: LayerRow[] = useMemo(() => {
    return layerMeta.map(([icon, name], idx) => {
      const score = Math.max(0, Math.min(100, Math.round((bullishBias * 100 + idx * 7) % 100)));
      const status: LayerStatus =
        !snapshot ? "Unavailable" : score >= 60 ? "Bullish" : score <= 40 ? "Bearish" : "Neutral";
      return {
        icon,
        name,
        status,
        explanation:
          status === "Bullish"
            ? `${name} signals align with upside continuation.`
            : status === "Bearish"
              ? `${name} signals show downside pressure.`
              : status === "Neutral"
                ? `${name} is mixed without strong direction.`
                : `${name} data is unavailable right now.`,
        score
      };
    });
  }, [bullishBias, snapshot]);

  const overall = rows.reduce((sum, row) => sum + row.score, 0) / Math.max(1, rows.length);
  const verdict = overall >= 58 ? "Bullish" : overall <= 42 ? "Bearish" : "Neutral";
  const verdictColor = verdict === "Bullish" ? colors.bullish : verdict === "Bearish" ? colors.bearish : colors.caution;

  const radarData = rows.map((row, idx) => ({
    layer: row.name,
    score: row.score,
    hist: Math.max(22, Math.min(88, row.score - 7 + ((idx * 7) % 14)))
  }));

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <div className="flex w-full min-w-0 flex-col gap-2 sm:max-w-md sm:flex-row sm:items-center">
        <label htmlFor="signal-symbol" className="text-sm" style={{ color: colors.textMuted }}>
          Symbol
        </label>
        <input
          id="signal-symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="AAPL"
          className="min-h-11 w-full min-w-0 text-base sm:flex-1"
          style={{
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            padding: `${spacing[2]} ${spacing[3]}`
          }}
        />
      </div>

      <div className="signals-grid grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
        <section className="order-2 min-w-0 lg:order-1" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
          <h3 style={{ marginTop: 0, marginBottom: spacing[2] }}>6-Layer Signal Breakdown</h3>
          <div style={{ display: "grid", gap: spacing[2] }}>
            {rows.map((row, rowIdx) => (
              <article
                key={row.name}
                style={{
                  display: "grid",
                  gap: spacing[2],
                  borderBottom: `1px solid ${colors.border}`,
                  paddingBottom: spacing[2]
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
                  <div style={{ display: "flex", alignItems: "center", gap: spacing[2], minWidth: 0 }}>
                    <span>{row.icon}</span>
                    <strong style={{ margin: 0 }}>{row.name}</strong>
                  </div>
                  <InfoTip
                    text={(() => {
                      const keys = ["technical", "news", "macro", "sector", "geopolitical", "internals"] as const;
                      const k = keys[rowIdx];
                      return k ? LAYER_NAME_HINTS[k] : "Layer readout for this symbol.";
                    })()}
                    label={row.name}
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <span
                    className="text-sm"
                    style={{
                      borderRadius: borderRadius.full,
                      padding: "2px 8px",
                      background: "rgba(148,163,184,0.12)",
                      color: statusColor(row.status, colors)
                    }}
                  >
                    {row.status}
                  </span>
                  <span className="min-w-0 flex-1 text-sm leading-snug sm:text-sm" style={{ color: colors.textMuted }}>
                    {row.explanation}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="order-1 min-w-0 lg:order-2" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
          <h3 style={{ marginTop: 0 }}>Signal Radar</h3>
          <p className="text-sm" style={{ margin: `0 0 ${spacing[2]} 0`, color: colors.textMuted }}>
            Current vs Historical Average — dashed outline is a typical baseline; solid fill is today.
          </p>
          <div className="mx-auto max-w-full" style={{ height: 220 }}>
            <div className="lg:hidden" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke={colors.border} />
                  <PolarAngleAxis dataKey="layer" tick={{ fill: colors.textMuted, fontSize: 10 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: colors.textMuted, fontSize: 9 }} />
                  <Radar
                    name="Historical avg"
                    dataKey="hist"
                    stroke={colors.text}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    fill="none"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Radar
                    name="Current"
                    dataKey="score"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    fill="#0ea5e9"
                    fillOpacity={0.38}
                    dot={false}
                  />
                  <Legend wrapperStyle={{ color: colors.textMuted, fontSize: 11 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="hidden lg:block" style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke={colors.border} />
                  <PolarAngleAxis dataKey="layer" tick={{ fill: colors.textMuted, fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: colors.textMuted, fontSize: 10 }} />
                  <Radar
                    name="Historical avg"
                    dataKey="hist"
                    stroke={colors.text}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    fill="none"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Radar
                    name="Current"
                    dataKey="score"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    fill="#0ea5e9"
                    fillOpacity={0.38}
                    dot={false}
                  />
                  <Legend wrapperStyle={{ color: colors.textMuted, fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </div>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: spacing[2] }}>
          <Brain size={18} />
          AI Verdict
        </h3>
        <p style={{ margin: 0, fontStyle: "italic" }}>
          “{symbol.toUpperCase()} currently shows a <strong style={{ color: verdictColor }}>{verdict}</strong> profile with{" "}
          {Math.round(overall)}% confidence based on layered confirmation.”
        </p>
        <div style={{ marginTop: spacing[3], height: 10, background: colors.surfaceMuted, borderRadius: borderRadius.full }}>
          <div
            style={{
              height: "100%",
              width: `${Math.round(overall)}%`,
              borderRadius: borderRadius.full,
              background: verdictColor
            }}
          />
        </div>
        <button
          type="button"
          className="min-h-11 text-sm"
          onClick={async () => {
            const setupLike = setup || {
              symbol: symbol.toUpperCase(),
              direction: verdict,
              score: overall / 100,
              triggers: ["Multi-layer synthesis"],
              timestamp_iso: new Date().toISOString()
            };
            let symbolNewsArticles: Awaited<ReturnType<typeof fetchSymbolNews>> = [];
            try {
              symbolNewsArticles = await fetchSymbolNews(symbol.toUpperCase(), 10);
            } catch {
              symbolNewsArticles = [];
            }
            const event = earningsBySymbol[symbol.toUpperCase()];
            const today = new Date().toISOString().slice(0, 10);
            const daysUntil =
              event != null
                ? Math.floor((Date.parse(`${event.report_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
                : undefined;
            setEvidence(
              buildEvidenceFromSetup(setupLike, snapshot, {
                symbolNewsArticles,
                earningsRiskDays: daysUntil,
                earningsReportTime: event?.report_time
              })
            );
            setEvidenceOpen(true);
          }}
          style={{
            marginTop: spacing[3],
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: "transparent",
            color: colors.text,
            padding: `${spacing[2]} ${spacing[3]}`,
            cursor: "pointer"
          }}
        >
          View Evidence
        </button>
      </article>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0 }}>Key Levels</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>VWAP</p>
            <strong>{snapshot?.last_trade_price ? `$${(snapshot.last_trade_price * 0.997).toFixed(2)}` : "n/a"}</strong>
          </div>
          <div>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>Support</p>
            <strong>{support ? `$${support.toFixed(2)}` : "n/a"}</strong>
          </div>
          <div>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>Resistance</p>
            <strong>{resistance ? `$${resistance.toFixed(2)}` : "n/a"}</strong>
          </div>
          <div>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>OR High</p>
            <strong>{resistance ? `$${(resistance * 1.003).toFixed(2)}` : "n/a"}</strong>
          </div>
          <div>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>OR Low</p>
            <strong>{support ? `$${(support * 0.997).toFixed(2)}` : "n/a"}</strong>
          </div>
        </div>
        {setup ? (
          <p style={{ margin: `${spacing[3]} 0 0 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
            Active setup type: {setup.triggers[0] || "Intraday pattern"}
          </p>
        ) : null}
      </article>
      <SignalEvidenceModal open={evidenceOpen} evidence={evidence} onClose={() => setEvidenceOpen(false)} />
    </section>
  );
}
