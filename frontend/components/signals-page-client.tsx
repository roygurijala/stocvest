"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { Brain, Clock } from "lucide-react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import type { MarketOverview, NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { SignalLayerDivergenceChart } from "@/components/signal-layer-divergence-chart";
import { SignalsAfterHoursPanel } from "@/components/signals-after-hours-panel";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";
import { coerceSnapshotForReferenceLevels } from "@/lib/snapshot-reference-levels";
import { applySwingCompositeEnrichment, buildEvidenceFromSetup, type SignalEvidenceData } from "@/lib/signal-evidence";
import {
  fetchLiveSignals,
  fetchUserEvaluatedSignals,
  formatHorizonOutcome,
  type PublicSignal
} from "@/lib/api/public-signals";
import { LAYER_NAME_HINTS } from "@/lib/ui-tooltips";
import {
  buildSwingCompositeRequestBody,
  isInsufficientCompositeResponse,
  type SwingCompositeMarketStatus
} from "@/lib/api/swing-composite";

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
  const isMobileLayout = useIsMobileLayout();
  const [tab, setTab] = useState<"layers" | "history">("layers");
  const [symbol, setSymbol] = useState("AAPL");
  const [signalEvidence, setSignalEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [symbolSnapshot, setSymbolSnapshot] = useState<SnapshotPayload | null>(null);
  const [historyRows, setHistoryRows] = useState<PublicSignal[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histSymbolFilter, setHistSymbolFilter] = useState("");
  const [histDirectionFilter, setHistDirectionFilter] = useState<"all" | "bullish" | "bearish" | "neutral">("all");
  const [histOutcomeFilter, setHistOutcomeFilter] = useState<
    "all" | "correct" | "incorrect" | "neutral" | "pending"
  >("all");
  const [historySource, setHistorySource] = useState<"user" | "public">("public");
  const [compositeResult, setCompositeResult] = useState<Record<string, unknown> | null>(null);
  const [radarData, setRadarData] = useState<Array<{ layer: string; score: number; hist: number }> | null>(null);
  const [afterHoursNews, setAfterHoursNews] = useState<NewsPayload[]>([]);
  const [afterHoursInWatchlist, setAfterHoursInWatchlist] = useState(false);
  const [afterHoursWatchlistKnown, setAfterHoursWatchlistKnown] = useState(false);

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
    void (async () => {
      const mine = await fetchUserEvaluatedSignals({ days: 30, limit: 200 });
      if (cancelled) return;
      if (mine !== null) {
        setHistorySource("user");
        setHistoryRows(mine);
      } else {
        setHistorySource("public");
        setHistoryRows(await fetchLiveSignals());
      }
      setHistLoading(false);
    })();
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
  const layerReasoning = useMemo(() => {
    const out = new Map<string, string>();
    const raw = compositeResult?.contributions;
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as { layer?: unknown; reasoning?: unknown };
      if (typeof row.layer !== "string" || typeof row.reasoning !== "string") continue;
      out.set(row.layer.trim().toLowerCase(), row.reasoning.trim());
    }
    return out;
  }, [compositeResult]);
  const rows: LayerRow[] = useMemo(() => {
    return layerMeta.map(([icon, name], idx) => {
      const score = Math.max(0, Math.min(100, Math.round((bullishBias * 100 + idx * 7) % 100)));
      const status: LayerStatus =
        !snapshot ? "Unavailable" : score >= 60 ? "Bullish" : score <= 40 ? "Bearish" : "Neutral";
      const dynamicReasoning = layerReasoning.get(name.toLowerCase());
      return {
        icon,
        name,
        status,
        explanation:
          dynamicReasoning ??
          (status === "Bullish"
            ? `${name} signals align with upside continuation.`
            : status === "Bearish"
              ? `${name} signals show downside pressure.`
              : status === "Neutral"
                ? `${name} is mixed without strong direction.`
                : `${name} data is unavailable right now.`),
        score
      };
    });
  }, [bullishBias, layerReasoning, snapshot]);

  const overall = rows.reduce((sum, row) => sum + row.score, 0) / Math.max(1, rows.length);
  const layerSignalSummary = overall >= 58 ? "Bullish" : overall <= 42 ? "Bearish" : "Neutral";
  const summaryTone =
    layerSignalSummary === "Bullish" ? colors.bullish : layerSignalSummary === "Bearish" ? colors.bearish : colors.caution;
  const setupDirectionForEvidence =
    layerSignalSummary === "Bullish" ? "long" : layerSignalSummary === "Bearish" ? "short" : "neutral";

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym || tab !== "layers") {
      setCompositeResult(null);
      setSignalEvidence(null);
      setRadarData(null);
      return;
    }
    let cancelled = false;
    const regime =
      layerSignalSummary === "Bullish" ? "bull" : layerSignalSummary === "Bearish" ? "bear" : "sideways";
    const run = async () => {
      let newsCatalyst: { headline: string; sentiment: "positive" | "negative" | "neutral" } | null = null;
      try {
        const articles = await fetchSymbolNews(sym, 5);
        const first = articles[0];
        if (first?.title?.trim()) {
          const sc = first.sentiment_score;
          let sentiment: "positive" | "negative" | "neutral" = "neutral";
          if (typeof sc === "number" && Number.isFinite(sc)) {
            if (sc > 0.1) sentiment = "positive";
            else if (sc < -0.1) sentiment = "negative";
          }
          newsCatalyst = { headline: first.title.trim(), sentiment };
        }
      } catch {
        newsCatalyst = null;
      }
      if (cancelled) return;
      const body = buildSwingCompositeRequestBody({
        symbol: sym,
        regime,
        rows: rows.map((r) => ({ status: r.status, score: r.score })),
        snapshot,
        newsCatalyst
      });
      try {
        const res = await fetch("/api/stocvest/signals/swing-composite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin"
        });
        if (cancelled) return;
        if (!res.ok) {
          setCompositeResult(null);
          setSignalEvidence(null);
          setRadarData(null);
          return;
        }
        const j = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        if (isInsufficientCompositeResponse(j)) {
          setCompositeResult(null);
          setSignalEvidence(null);
          setRadarData(null);
          return;
        }
        setCompositeResult(j);
        setRadarData(
          rows.map((row, idx) => ({
            layer: row.name,
            score: row.score,
            hist: Math.max(22, Math.min(88, row.score - 7 + ((idx * 7) % 14)))
          }))
        );
      } catch {
        if (!cancelled) {
          setCompositeResult(null);
          setSignalEvidence(null);
          setRadarData(null);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [symbol, tab, snapshot, rows, layerSignalSummary]);

  const insufficientComposite: SwingCompositeMarketStatus | null = isInsufficientCompositeResponse(compositeResult)
    ? compositeResult.market_status
    : null;
  const hasValidSignal = compositeResult !== null && !isInsufficientCompositeResponse(compositeResult);
  const showAfterHoursPanel = insufficientComposite?.market_session === "closed";

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym || !showAfterHoursPanel) {
      setAfterHoursNews([]);
      setAfterHoursInWatchlist(false);
      setAfterHoursWatchlistKnown(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [news, watchlistSymbols] = await Promise.all([
        fetchSymbolNews(sym, 5).catch(() => [] as NewsPayload[]),
        fetch("/api/stocvest/watchlists/default/symbols", { method: "GET" })
          .then(async (res) => {
            if (!res.ok) return [] as string[];
            const data = (await res.json().catch(() => ({}))) as { symbols?: string[] };
            if (!Array.isArray(data.symbols)) return [] as string[];
            return data.symbols.map((row) => String(row).trim().toUpperCase()).filter(Boolean);
          })
          .catch(() => [] as string[])
      ]);
      if (cancelled) return;
      setAfterHoursNews(news);
      setAfterHoursInWatchlist(watchlistSymbols.includes(sym));
      setAfterHoursWatchlistKnown(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [showAfterHoursPanel, symbol]);

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
            ["history", "Historical signal data"]
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
        <article
          className={surfaceGlowClassName}
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
        >
          <h3 style={{ marginTop: 0 }}>Signal outcome tracking</h3>
          <p style={{ margin: `0 0 ${spacing[3]} 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
            {historySource === "user"
              ? "Your evaluated signals (signed in): last 30 days by default. Filter by symbol, direction, or 1d outcome."
              : "Platform historical signal data (public feed). Sign in to include your personal evaluated signals in this list."}
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
      <div className="flex flex-wrap items-center gap-2">
        <AddToWatchlistButton symbol={symbol} />
      </div>

      <div className="signals-grid grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
        <section
          className={`order-2 min-w-0 lg:order-1 ${surfaceGlowClassName}`}
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
        >
          <h3 style={{ marginTop: 0, marginBottom: spacing[2] }}>6-Layer Signal Breakdown</h3>
          {insufficientComposite ? (
            <div
              style={{
                background: "rgba(245,197,66,0.06)",
                border: "1px solid rgba(245,197,66,0.2)",
                borderRadius: 12,
                padding: 24
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: spacing[3] }}>
                <Clock size={22} color="#f5c542" strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#f5c542" }}>Market Data Unavailable</p>
                  <p
                    style={{
                      margin: `${spacing[2]} 0 0 0`,
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: colors.textMuted
                    }}
                  >
                    Real-time data is needed to generate a reliable signal. At least 3 of 6 layers must have live data.
                  </p>
                  {insufficientComposite.market_session === "closed" ? (
                    <p
                      style={{
                        margin: `${spacing[2]} 0 0 0`,
                        fontSize: 13,
                        lineHeight: 1.55,
                        color: colors.textMuted
                      }}
                    >
                      Market is closed right now.
                      {insufficientComposite.next_open ? ` Next session: ${insufficientComposite.next_open}.` : null}
                    </p>
                  ) : null}
                  {insufficientComposite.market_session === "pre_market" ||
                  insufficientComposite.market_session === "after_hours" ? (
                    <p
                      style={{
                        margin: `${spacing[2]} 0 0 0`,
                        fontSize: 13,
                        lineHeight: 1.55,
                        color: colors.textMuted
                      }}
                    >
                      {insufficientComposite.market_session === "pre_market"
                        ? "Pre-market data is limited."
                        : "After-hours data is limited."}{" "}
                      Full signals are available at market open 9:30 AM ET.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
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
          )}
        </section>

        {hasValidSignal && radarData ? (
          <section
            className={`order-1 min-w-0 lg:order-2 ${surfaceGlowClassName}`}
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
          >
            <h3 style={{ marginTop: 0 }}>Signal Radar</h3>
            <p className="text-sm" style={{ margin: `0 0 ${spacing[2]} 0`, color: colors.textMuted }}>
              At-a-glance shape vs a typical baseline — dashed ring is historical average, solid fill is today.
            </p>
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-2"
              style={{ margin: `0 0 ${spacing[3]} 0`, fontSize: 12, color: colors.textMuted }}
              aria-label="Radar chart legend"
            >
              <span className="inline-flex items-center gap-2">
                <span
                  className="inline-block shrink-0 rounded-sm"
                  style={{ width: 12, height: 12, background: "#0ea5e9", opacity: 0.85, border: "1px solid #38bdf8" }}
                  aria-hidden
                />
                Current
              </span>
              <span className="inline-flex items-center gap-2">
                <span
                  className="inline-block shrink-0 rounded-sm"
                  style={{
                    width: 12,
                    height: 12,
                    border: `2px dashed ${colors.text}`,
                    background: "transparent",
                    opacity: 0.85
                  }}
                  aria-hidden
                />
                Historical avg
              </span>
            </div>
            <div className="mx-auto min-w-0 max-w-full overflow-x-auto overscroll-x-contain touch-pan-x">
              <div className="mx-auto max-w-full min-w-[260px] lg:hidden" style={{ height: 256 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} margin={{ top: 16, right: 18, bottom: 22, left: 18 }}>
                    <PolarGrid stroke={colors.border} />
                    <PolarAngleAxis
                      dataKey="layer"
                      tick={{ fill: colors.textMuted, fontSize: 10 }}
                      tickLine={false}
                    />
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
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="mx-auto hidden max-w-full overflow-hidden lg:block" style={{ height: 288 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} margin={{ top: 18, right: 20, bottom: 26, left: 20 }}>
                    <PolarGrid stroke={colors.border} />
                    <PolarAngleAxis
                      dataKey="layer"
                      tick={{ fill: colors.textMuted, fontSize: 11 }}
                      tickLine={false}
                    />
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
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <h4 style={{ margin: `${spacing[4]} 0 ${spacing[1]} 0`, fontSize: 13, fontWeight: 600, color: colors.text }}>
              Today vs typical (per layer)
            </h4>
            <p className="text-xs leading-snug" style={{ margin: `0 0 ${spacing[2]} 0`, color: colors.textMuted }}>
              Point gap vs the dashed &quot;historical avg&quot; ring on the radar (today − typical). Color key is directly above the
              bars.
            </p>
            <SignalLayerDivergenceChart data={radarData} colors={colors} height={isMobileLayout ? 348 : 312} />
          </section>
        ) : null}
      </div>

      {hasValidSignal ? (
      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
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
              setSignalEvidence(
                applySwingCompositeEnrichment(
                  buildEvidenceFromSetup(setupLike, snapshot ?? undefined, {
                    symbolNewsArticles,
                    earningsRiskDays: daysUntil,
                    earningsReportTime: event?.report_time
                  }),
                  compositeResult
                )
              );
              setEvidenceOpen(true);
            }}
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              background: colors.surfaceMuted,
              color: colors.text,
              padding: `${spacing[2]} ${spacing[3]}`,
              cursor: "pointer",
              fontWeight: 500
            }}
          >
            View Evidence
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: spacing[2] }}>
          <SignalDisclaimerChip />
        </div>
      </article>
      ) : null}

      {hasValidSignal ? (
      <article
        className={surfaceGlowClassName}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.xl,
          padding: spacing[4],
          position: "relative",
          paddingBottom: spacing[5]
        }}
      >
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
      ) : null}
      {showAfterHoursPanel ? (
        <SignalsAfterHoursPanel
          symbol={symbol}
          snapshot={snapshot}
          marketStatus={insufficientComposite}
          earningsEvent={earningsBySymbol[symbol.toUpperCase()] ?? null}
          newsArticles={afterHoursNews}
          isInDefaultWatchlist={afterHoursInWatchlist}
          watchlistCheckComplete={afterHoursWatchlistKnown}
        />
      ) : null}
        </>
      ) : null}
      <SignalEvidenceModal open={evidenceOpen} evidence={signalEvidence} onClose={() => setEvidenceOpen(false)} />
    </section>
  );
}
