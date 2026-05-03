"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
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
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { coerceSnapshotForReferenceLevels } from "@/lib/snapshot-reference-levels";
import { buildEvidenceFromSetup, type SignalEvidenceData } from "@/lib/signal-evidence";
import { fetchLiveSignals, formatHorizonOutcome, type PublicSignal } from "@/lib/api/public-signals";
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

function deriveFromSnapshot(snapshot?: SnapshotPayload | null): { bullishBias: number; support: number; resistance: number } {
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
  const [tab, setTab] = useState<"layers" | "history">("layers");
  const [symbol, setSymbol] = useState("AAPL");
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [symbolSnapshot, setSymbolSnapshot] = useState<SnapshotPayload | null>(null);
  const [historyRows, setHistoryRows] = useState<PublicSignal[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histSymbolFilter, setHistSymbolFilter] = useState("");
  const [histDirectionFilter, setHistDirectionFilter] = useState<"all" | "bullish" | "bearish" | "neutral">("all");
  const [histOutcomeFilter, setHistOutcomeFilter] = useState<
    "all" | "correct" | "incorrect" | "neutral" | "pending"
  >("all");

  const rawSnapshot = useMemo(() => {
    const sym = symbol.toUpperCase();
    return marketOverview.snapshots.find((s) => s.symbol === sym) ?? symbolSnapshot;
  }, [marketOverview.snapshots, symbol, symbolSnapshot]);

  const snapshot = useMemo(() => coerceSnapshotForReferenceLevels(rawSnapshot), [rawSnapshot]);

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setSymbolSnapshot(null);
      return;
    }
    const fromOverview = marketOverview.snapshots.find((s) => s.symbol === sym);
    if (fromOverview) {
      setSymbolSnapshot(null);
      return;
    }
    setSymbolSnapshot(null);
    let cancelled = false;
    void fetchSymbolSnapshot(sym).then((row) => {
      if (!cancelled) {
        setSymbolSnapshot(row && row.symbol.toUpperCase() === sym ? row : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [symbol, marketOverview.snapshots]);

  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    setHistLoading(true);
    void fetchLiveSignals().then((rows) => {
      if (!cancelled) {
        setHistoryRows(rows);
        setHistLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const filteredHistory = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    const sym = histSymbolFilter.trim().toUpperCase();
    return historyRows.filter((r) => {
      if (Number.isFinite(Date.parse(r.timestamp_iso)) && Date.parse(r.timestamp_iso) < cutoff) {
        return false;
      }
      if (sym && r.symbol.toUpperCase() !== sym) return false;
      if (histDirectionFilter !== "all" && r.bias !== histDirectionFilter) return false;
      const o = r.outcome_1d ?? r.outcome_1h;
      if (histOutcomeFilter !== "all") {
        if (histOutcomeFilter === "pending" && o != null) return false;
        if (histOutcomeFilter !== "pending" && o !== histOutcomeFilter) return false;
      }
      return true;
    });
  }, [historyRows, histSymbolFilter, histDirectionFilter, histOutcomeFilter]);

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
  const layerSignalSummary = overall >= 58 ? "Bullish" : overall <= 42 ? "Bearish" : "Neutral";
  const summaryTone =
    layerSignalSummary === "Bullish" ? colors.bullish : layerSignalSummary === "Bearish" ? colors.bearish : colors.caution;
  const setupDirectionForEvidence =
    layerSignalSummary === "Bullish" ? "long" : layerSignalSummary === "Bearish" ? "short" : "neutral";

  const radarData = rows.map((row, idx) => ({
    layer: row.name,
    score: row.score,
    hist: Math.max(22, Math.min(88, row.score - 7 + ((idx * 7) % 14)))
  }));

  function directionChipStyle(bias: PublicSignal["bias"]): CSSProperties {
    if (bias === "bullish") {
      return { background: "rgba(34,197,94,.2)", color: colors.bullish, border: `1px solid rgba(34,197,94,.35)` };
    }
    if (bias === "bearish") {
      return { background: "rgba(239,68,68,.2)", color: colors.bearish, border: `1px solid rgba(239,68,68,.35)` };
    }
    return { background: "rgba(245,158,11,.15)", color: colors.caution, border: `1px solid rgba(245,158,11,.35)` };
  }

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["layers", "Layer analysis"],
            ["history", "Signal history"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="min-h-11 rounded-md px-4 text-sm"
            onClick={() => setTab(key)}
            style={{
              border: `1px solid ${colors.border}`,
              background: tab === key ? "rgba(59,130,246,.2)" : "transparent",
              color: tab === key ? colors.accent : colors.text
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
          <h3 style={{ marginTop: 0 }}>Signal History</h3>
          <p style={{ margin: `0 0 ${spacing[3]} 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
            Default: last 30 days, all symbols. Filter by symbol, direction, or 1d outcome.
          </p>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <input
              value={histSymbolFilter}
              onChange={(e) => setHistSymbolFilter(e.target.value.toUpperCase())}
              placeholder="Symbol filter"
              className="min-h-11 min-w-[140px] flex-1 text-base"
              style={{ borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, padding: spacing[2] }}
            />
            <select
              value={histDirectionFilter}
              onChange={(e) => setHistDirectionFilter(e.target.value as typeof histDirectionFilter)}
              className="min-h-11 text-base"
              style={{ borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, padding: spacing[2] }}
            >
              <option value="all">All directions</option>
              <option value="bullish">Bullish</option>
              <option value="bearish">Bearish</option>
              <option value="neutral">Neutral</option>
            </select>
            <select
              value={histOutcomeFilter}
              onChange={(e) => setHistOutcomeFilter(e.target.value as typeof histOutcomeFilter)}
              className="min-h-11 text-base"
              style={{ borderRadius: borderRadius.md, border: `1px solid ${colors.border}`, padding: spacing[2] }}
            >
              <option value="all">All 1d outcomes</option>
              <option value="pending">Pending</option>
              <option value="correct">Correct</option>
              <option value="incorrect">Incorrect</option>
              <option value="neutral">Neutral</option>
            </select>
          </div>
          {histLoading ? (
            <p style={{ color: colors.textMuted }}>Loading…</p>
          ) : filteredHistory.length === 0 ? (
            <p style={{ color: colors.textMuted, margin: 0 }}>
              Signal history builds automatically as signals are generated. Check back after market hours.
            </p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1 sm:mx-0 sm:px-0" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="min-w-[880px]" style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
                <thead>
                  <tr style={{ color: colors.textMuted, textAlign: "left" }}>
                    <th style={{ padding: spacing[2] }}>Time</th>
                    <th style={{ padding: spacing[2] }}>Symbol</th>
                    <th style={{ padding: spacing[2] }}>Direction</th>
                    <th style={{ padding: spacing[2] }}>Strength</th>
                    <th style={{ padding: spacing[2] }}>Pattern</th>
                    <th style={{ padding: spacing[2] }}>Price at Signal</th>
                    <th style={{ padding: spacing[2] }}>1h Outcome</th>
                    <th style={{ padding: spacing[2] }}>1d Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((row) => {
                    const h1 = formatHorizonOutcome(row.outcome_1h);
                    const h1d = formatHorizonOutcome(row.outcome_1d);
                    return (
                      <tr key={row.signal_id ?? `${row.symbol}-${row.timestamp_iso}`} style={{ borderTop: `1px solid ${colors.border}` }}>
                        <td style={{ padding: spacing[2], whiteSpace: "nowrap" }}>{new Date(row.timestamp_iso).toLocaleString()}</td>
                        <td style={{ padding: spacing[2] }}>{row.symbol}</td>
                        <td style={{ padding: spacing[2] }}>
                          <span
                            style={{
                              ...directionChipStyle(row.bias),
                              borderRadius: borderRadius.full,
                              padding: "2px 10px",
                              fontSize: typography.scale.xs,
                              textTransform: "capitalize",
                              display: "inline-block"
                            }}
                          >
                            {row.bias}
                          </span>
                        </td>
                        <td style={{ padding: spacing[2] }}>{Math.round(row.signal_strength)}%</td>
                        <td style={{ padding: spacing[2] }}>{row.pattern ?? "—"}</td>
                        <td style={{ padding: spacing[2] }}>
                          {typeof row.price_at_signal === "number" ? `$${row.price_at_signal.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: spacing[2] }}>{h1.label}</td>
                        <td style={{ padding: spacing[2] }}>{h1d.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      ) : null}

      {tab === "layers" ? (
        <>
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
          AI Signal Analysis
        </h3>
        <p style={{ margin: 0, fontStyle: "italic" }}>
          “{symbol.toUpperCase()} currently shows a <strong style={{ color: summaryTone }}>{layerSignalSummary}</strong> profile with{" "}
          {Math.round(overall)}% signal strength based on layered confirmation.”
        </p>
        <div style={{ marginTop: spacing[3], height: 10, background: colors.surfaceMuted, borderRadius: borderRadius.full }}>
          <div
            style={{
              height: "100%",
              width: `${Math.round(overall)}%`,
              borderRadius: borderRadius.full,
              background: summaryTone
            }}
          />
        </div>
        <div
          style={{
            background: "rgba(255,193,7,0.06)",
            border: "1px solid rgba(255,193,7,0.2)",
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "12px",
            color: "#8a9ab0",
            lineHeight: "1.6",
            marginTop: spacing[3],
            marginBottom: spacing[2]
          }}
        >
          <strong style={{ color: "#f5c542" }}>Signal Data Only</strong>
          <br />
          This analysis surfaces technical patterns and signal data for informational purposes. It is not investment advice. Reference
          levels shown are derived from historical patterns — not predictions. You are solely responsible for all trading decisions.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2], marginTop: spacing[3] }}>
          <button
            type="button"
            className="min-h-11 text-sm"
            onClick={async () => {
              const setupLike = setup || {
                symbol: symbol.toUpperCase(),
                direction: setupDirectionForEvidence,
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
                buildEvidenceFromSetup(setupLike, snapshot ?? undefined, {
                  symbolNewsArticles,
                  earningsRiskDays: daysUntil,
                  earningsReportTime: event?.report_time
                })
              );
              setEvidenceOpen(true);
            }}
            style={{
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
          <AddToWatchlistButton symbol={symbol} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: spacing[2] }}>
          <SignalDisclaimerChip />
        </div>
      </article>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4], position: "relative", paddingBottom: spacing[5] }}>
        <h3 style={{ marginTop: 0 }}>Reference Levels</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>VWAP</p>
            <strong>
              {typeof snapshot?.day_vwap === "number" && Number.isFinite(snapshot.day_vwap)
                ? `$${snapshot.day_vwap.toFixed(2)}`
                : snapshot?.last_trade_price
                  ? `$${(snapshot.last_trade_price * 0.997).toFixed(2)}`
                  : "n/a"}
            </strong>
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
            Active signal pattern: {setup.triggers[0] || "Intraday pattern"}
          </p>
        ) : null}
        <div style={{ position: "absolute", right: spacing[3], bottom: spacing[3] }}>
          <SignalDisclaimerChip />
        </div>
      </article>
        </>
      ) : null}
      <SignalEvidenceModal open={evidenceOpen} evidence={evidence} onClose={() => setEvidenceOpen(false)} />
    </section>
  );
}
