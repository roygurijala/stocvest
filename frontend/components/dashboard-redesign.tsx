"use client";

import { type ReactNode, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { DashboardRealtime } from "@/components/dashboard-realtime";
import { EarningsCalendar } from "@/components/earnings-calendar";
import { InfoTip } from "@/components/info-tip";
import { MarketSentimentScoreWidget } from "@/components/market-sentiment-score-widget";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { MorningBriefCollapse } from "@/components/morning-brief-collapse";
import { NewsPanel } from "@/components/news-panel";
import { PdtStatusPill } from "@/components/pdt-status-pill";
import { getChangeColor } from "@/components/market-sentiment-score-widget";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { topSignalStrengthPercent } from "@/lib/top-signal-strength";
import type { MarketOverview, NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { IntradayGeoPreview, IntradaySetupPayload, ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { buildEvidenceFromSetup, enrichEvidenceWithRealComposite, type SignalEvidenceData } from "@/lib/signal-evidence";
import { tickerNewsTriggerLine } from "@/lib/api/ticker-news-panel";
import { CONFIDENCE_PERCENT_TIP, TOP_SIGNALS_TIP } from "@/lib/ui-tooltips";

interface DashboardRedesignProps {
  marketOverview: MarketOverview;
  pdtStatus: PDTStatusPayload | null;
  scannerOverview: ScannerOverview;
  earningsEvents: EarningsEvent[];
  /** When set (e.g. Suspense-wrapped server fetch), shown in the morning-brief slot instead of `scannerOverview.morningBrief`. */
  morningBriefSlot?: ReactNode;
}

function SkeletonLine({ width = "100%", height = 14 }: { width?: string; height?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 8,
        background: "linear-gradient(90deg, rgba(148,163,184,0.15), rgba(148,163,184,0.28), rgba(148,163,184,0.15))",
        backgroundSize: "180% 100%",
        animation: "stocvest-skeleton 1.2s ease-in-out infinite"
      }}
    />
  );
}

function TopSignalGeoStrip({ preview, colors }: { preview: IntradayGeoPreview; colors: ThemeColors }) {
  const band = (preview.exposure_band || "low").toLowerCase();
  const bandStyles =
    band === "high"
      ? { fg: colors.bearish, bg: "rgba(239,68,68,0.11)", border: "rgba(239,68,68,0.38)" }
      : band === "moderate"
        ? { fg: colors.caution, bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.42)" }
        : { fg: colors.bullish, bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.38)" };
  const scoreStr =
    preview.weighted_score != null && Number.isFinite(preview.weighted_score)
      ? preview.weighted_score.toFixed(2)
      : null;
  return (
    <div
      style={{
        borderRadius: borderRadius.md,
        border: `1px solid ${bandStyles.border}`,
        background: bandStyles.bg,
        padding: `${spacing[2]} ${spacing[2]}`,
        display: "grid",
        gap: spacing[1]
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.text }}>{preview.impact_sector_label}</span>
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            textTransform: "capitalize",
            color: bandStyles.fg,
            padding: "2px 8px",
            borderRadius: borderRadius.full,
            border: `1px solid ${bandStyles.border}`,
            background: "rgba(255,255,255,0.04)"
          }}
        >
          Geo {band}
        </span>
      </div>
      {scoreStr ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
          Weighted exposure {scoreStr}
        </span>
      ) : null}
      {preview.theme_tags && preview.theme_tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {preview.theme_tags.map((t, ti) => (
            <span
              key={`${ti}-${t}`}
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: colors.textMuted,
                padding: "2px 6px",
                borderRadius: borderRadius.sm,
                border: `1px solid ${colors.border}`,
                background: "rgba(255,255,255,0.04)"
              }}
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {preview.summary ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>{preview.summary}</p>
      ) : null}
    </div>
  );
}

function toPrice(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "";
  return `$${n.toFixed(2)}`;
}

function isMorningBriefingWindowNow(): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  const minutes = hour * 60 + minute;
  return minutes >= 7 * 60 + 45 && minutes <= 10 * 60;
}

function findVixSnapshot(snapshots: SnapshotPayload[]): SnapshotPayload | undefined {
  const order = ["I:VIX", "^VIX", "VIX"];
  for (const k of order) {
    const hit = snapshots.find((x) => (x.symbol || "").toUpperCase() === k);
    if (hit) return hit;
  }
  return undefined;
}

/** Session change % for pulse widgets when API omits `change_percent` (e.g. some index snapshots). */
function snapshotSessionChangePct(s: SnapshotPayload | null | undefined): number | null {
  if (!s) return null;
  if (typeof s.change_percent === "number" && Number.isFinite(s.change_percent)) {
    return s.change_percent;
  }
  const last = s.last_trade_price;
  const prev = s.prev_close;
  if (
    typeof last === "number" &&
    typeof prev === "number" &&
    Number.isFinite(last) &&
    Number.isFinite(prev) &&
    prev !== 0
  ) {
    return ((last - prev) / prev) * 100;
  }
  return null;
}

function pulseRegimeColor(regime: string, colors: ThemeColors): string {
  const r = regime.trim().toLowerCase();
  if (r === "bullish") return colors.bullish;
  if (r === "bearish") return colors.bearish;
  return colors.caution;
}

export function DashboardRedesign({
  marketOverview,
  pdtStatus,
  scannerOverview,
  earningsEvents,
  morningBriefSlot
}: DashboardRedesignProps) {
  const { colors } = useTheme();
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [newsPanelSymbol, setNewsPanelSymbol] = useState("");
  const [newsPanelOpen, setNewsPanelOpen] = useState(false);
  const [newsUiTick, setNewsUiTick] = useState(0);
  const snapshotsBySymbol = new Map(marketOverview.snapshots.map((s) => [s.symbol, s]));
  const morningVisible =
    isMorningBriefingWindowNow() && (!!scannerOverview.morningBrief || morningBriefSlot != null);
  const topSignals = scannerOverview.setups.slice(0, 3);
  const pdt = pdtStatus?.assessment;
  const vixSnapshot =
    findVixSnapshot(marketOverview.snapshots) || snapshotsBySymbol.get("VIX") || snapshotsBySymbol.get("^VIX");
  const earningsBySymbol = new Map(earningsEvents.map((e) => [e.symbol.toUpperCase(), e] as const));
  const spyPct = scannerOverview.spyPct ?? null;
  const qqqPct = scannerOverview.qqqPct ?? null;
  const regimeLabel = scannerOverview.regimeLabel ?? "Neutral";
  const vixPct = snapshotSessionChangePct(vixSnapshot);

  const newsLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of scannerOverview.setups.slice(0, 3)) {
      m.set(s.symbol.trim().toUpperCase(), tickerNewsTriggerLine(s.symbol));
    }
    return m;
  }, [scannerOverview.setups, newsUiTick]);

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <article
        style={{
          borderBottom: `1px solid ${colors.border}`,
          paddingBottom: spacing[3],
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: spacing[3]
        }}
      >
        <div className="min-w-0" style={{ display: "grid", gap: spacing[3] }}>
          <div
            className="min-w-0 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ display: "flex", gap: spacing[3], flexWrap: "nowrap", alignItems: "center", fontSize: typography.scale.sm }}
          >
            <span style={{ color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Market</strong>{" "}
              {marketOverview.status ? (
                <span
                  style={{
                    color:
                      marketOverview.status.market?.toLowerCase() === "open" ? colors.bullish : colors.textMuted
                  }}
                >
                  {marketOverview.status.market?.toLowerCase() === "open" ? "Open" : "Closed"}
                </span>
              ) : !marketOverview.error ? (
                <SkeletonLine width="64px" />
              ) : null}
            </span>
            {vixSnapshot ? (
              <span style={{ color: colors.textMuted }}>
                <strong style={{ color: colors.text }}>VIX</strong> {toPrice(vixSnapshot.last_trade_price)}
              </span>
            ) : null}
            <PdtStatusPill assessment={pdt ?? null} />
          </div>
        </div>
        <DashboardRealtime />
      </article>

      <div className="dashboard-grid grid grid-cols-1 gap-4 lg:grid-cols-[7fr_13fr] lg:items-stretch [&>*]:min-w-0">
          <div className="order-1 min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <MarketSentimentScoreWidget marketOverview={marketOverview} />
            <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
              Blend of tape tone from SPY, QQQ, and IWM snapshots. Use as a quick pulse, not trade advice.
            </p>
          </div>

          <article
            className={`order-2 flex w-full min-h-[200px] flex-col overflow-hidden lg:self-start lg:col-start-1 lg:row-start-2 ${surfaceGlowClassName}`}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4]
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: spacing[2],
                flexShrink: 0,
                marginBottom: spacing[2]
              }}
            >
              <h3 style={{ margin: 0 }}>Top Signals</h3>
              <InfoTip text={TOP_SIGNALS_TIP} label="About top signals" />
            </div>
            <div className="flex flex-col gap-3">
              {topSignals.length === 0 ? (
                <div className="flex flex-col justify-center py-4" style={{ padding: spacing[2] }}>
                  {scannerOverview.error ? (
                    <p style={{ margin: 0, color: colors.textMuted }}>{scannerOverview.error}</p>
                  ) : (
                    <p style={{ margin: 0, color: colors.textMuted }}>
                      Intelligence engine is warming up. Check back at market open.
                    </p>
                  )}
                </div>
              ) : (
                topSignals.map((signal, idx) => {
                  const triggersLine = signal.triggers
                    .map((t) => String(t).trim())
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(" · ");
                  const tier = (signal.confluence_tier || "").trim().toLowerCase();
                  const nConf = typeof signal.n_confirming === "number" ? signal.n_confirming : signal.confirming_signals?.length;
                  const nConfl =
                    typeof signal.n_conflicting === "number" ? signal.n_conflicting : signal.conflicting_signals?.length;

                  return (
                  <motion.article
                    key={`${signal.symbol}-${idx}`}
                    className={`flex flex-col gap-2 ${surfaceGlowClassName}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    style={{
                      background: colors.surfaceMuted,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.lg,
                      padding: spacing[3]
                    }}
                  >
                    <div className="flex flex-col gap-2">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: spacing[2] }}>
                        <div style={{ display: "flex", alignItems: "center", gap: spacing[2], minWidth: 0, flexWrap: "wrap" }}>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: typography.scale.base }}>{signal.symbol}</p>
                          <span
                            style={{
                              background: ["bullish", "long"].includes(signal.direction.toLowerCase())
                                ? "rgba(34,197,94,.2)"
                                : "rgba(239,68,68,.2)",
                              color: ["bullish", "long"].includes(signal.direction.toLowerCase()) ? colors.bullish : colors.bearish,
                              borderRadius: borderRadius.full,
                              padding: "2px 8px",
                              fontSize: typography.scale.xs,
                              fontWeight: 600,
                              textTransform: "lowercase"
                            }}
                          >
                            {signal.direction}
                          </span>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <span style={{ color: colors.text, fontSize: typography.scale.sm, fontWeight: 600 }}>
                            {topSignalStrengthPercent(signal)}%
                          </span>
                          <InfoTip text={CONFIDENCE_PERCENT_TIP} label="About signal strength" />
                        </div>
                      </div>
                      {signal.company_name?.trim() ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.35 }}>
                          {signal.company_name.trim()}
                        </p>
                      ) : null}
                      {typeof signal.last_price === "number" && Number.isFinite(signal.last_price) ? (
                        <p
                          style={{
                            margin: 0,
                            fontSize: typography.scale.xs,
                            color: colors.textMuted,
                            fontVariantNumeric: "tabular-nums"
                          }}
                        >
                          Last <span style={{ color: colors.text, fontWeight: 600 }}>${signal.last_price.toFixed(2)}</span>
                        </p>
                      ) : null}
                      {signal.geo_preview ? <TopSignalGeoStrip preview={signal.geo_preview} colors={colors} /> : null}
                      {triggersLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.45 }}>{triggersLine}</p>
                      ) : null}
                      {tier || nConf != null || nConfl != null ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
                          {tier ? (
                            <>
                              <span style={{ textTransform: "capitalize", color: colors.text }}>{tier}</span> confluence
                            </>
                          ) : (
                            <span style={{ color: colors.text }}>Confluence</span>
                          )}
                          {nConf != null ? (
                            <>
                              {" "}
                              · {nConf} aligning
                            </>
                          ) : null}
                          {nConfl != null && nConfl > 0 ? (
                            <>
                              {" "}
                              · {nConfl} conflict{nConfl === 1 ? "" : "s"}
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="w-full text-left"
                        style={{
                          margin: 0,
                          padding: `${spacing[1]} 0`,
                          fontSize: typography.scale.xs,
                          color: colors.textMuted,
                          cursor: "pointer",
                          background: "none",
                          border: "none"
                        }}
                        onClick={() => {
                          setNewsPanelSymbol(signal.symbol.trim().toUpperCase());
                          setNewsPanelOpen(true);
                        }}
                      >
                        {newsLabels.get(signal.symbol.trim().toUpperCase()) ?? tickerNewsTriggerLine(signal.symbol)}
                      </button>
                      <div
                        className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"
                        style={{ borderTopColor: colors.border }}
                      >
                        <button
                          type="button"
                          className="min-h-11 w-full text-sm font-semibold sm:w-auto"
                          onClick={async () => {
                            const sym = signal.symbol.trim().toUpperCase();
                            let snapshot = snapshotsBySymbol.get(sym);
                            if (!snapshot) {
                              snapshot = (await fetchSymbolSnapshot(sym)) ?? undefined;
                            }
                            let symbolNewsArticles: NewsPayload[] = [];
                            try {
                              symbolNewsArticles = await fetchSymbolNews(signal.symbol, 10);
                            } catch {
                              symbolNewsArticles = [];
                            }
                            const event = earningsBySymbol.get(signal.symbol.toUpperCase());
                            const today = new Date().toISOString().slice(0, 10);
                            const daysUntil =
                              event != null
                                ? Math.floor(
                                    (Date.parse(`${event.report_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
                                  )
                                : undefined;
                            const base = buildEvidenceFromSetup(signal, snapshot, {
                              symbolNewsArticles,
                              earningsRiskDays: typeof daysUntil === "number" ? daysUntil : undefined,
                              earningsReportTime: event?.report_time
                            });
                            setEvidence(await enrichEvidenceWithRealComposite(base));
                            setEvidenceOpen(true);
                          }}
                          style={{
                            border: `1px solid color-mix(in srgb, ${colors.accent} 55%, ${colors.border})`,
                            borderRadius: borderRadius.md,
                            background: `linear-gradient(135deg, color-mix(in srgb, ${colors.accent} 28%, transparent), color-mix(in srgb, ${colors.accent} 12%, transparent))`,
                            color: colors.accent,
                            padding: `${spacing[2]} ${spacing[3]}`,
                            cursor: "pointer",
                            alignSelf: "flex-start",
                            boxShadow: `0 0 0 1px color-mix(in srgb, ${colors.accent} 18%, transparent)`
                          }}
                        >
                          View Evidence
                        </button>
                        <div className="flex flex-wrap items-center justify-start sm:justify-end">
                          <SignalDisclaimerChip />
                        </div>
                      </div>
                    </div>
                  </motion.article>
                  );
                })
              )}
            </div>
          </article>
          <EarningsCalendar
            className="order-5 lg:col-start-1 lg:row-start-3"
            events={earningsEvents}
            title="Upcoming Earnings (Next 7 Days)"
            maxDays={7}
          />

          <article
            className={`order-3 flex min-h-[200px] flex-col overflow-hidden lg:col-start-2 lg:row-start-2 lg:self-start ${surfaceGlowClassName}`}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4]
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: spacing[2],
                flexShrink: 0,
                marginBottom: spacing[2]
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <h3 style={{ margin: 0 }}>Market Pulse</h3>
                <p style={{ margin: 0, fontSize: 10, color: colors.textMuted, fontStyle: "italic" }}>
                  SPY · QQQ · VIX direction and regime from the same tape context as day setups (no extra API calls)
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 text-sm" style={{ color: colors.text }}>
              <div
                className="flex flex-wrap gap-x-4 gap-y-2 font-semibold"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <span>
                  SPY{" "}
                  <span style={{ color: spyPct != null ? getChangeColor(spyPct, colors) : colors.textMuted }}>
                    {spyPct != null ? `${spyPct >= 0 ? "+" : ""}${spyPct.toFixed(2)}%` : "—"}
                  </span>
                </span>
                <span>
                  QQQ{" "}
                  <span style={{ color: qqqPct != null ? getChangeColor(qqqPct, colors) : colors.textMuted }}>
                    {qqqPct != null ? `${qqqPct >= 0 ? "+" : ""}${qqqPct.toFixed(2)}%` : "—"}
                  </span>
                </span>
                <span>
                  VIX{" "}
                  <span style={{ color: vixPct != null ? getChangeColor(vixPct, colors) : colors.textMuted }}>
                    {vixPct != null
                      ? `${vixPct > 0.05 ? "▲" : vixPct < -0.05 ? "▼" : "→"} ${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(2)}%`
                      : vixSnapshot?.last_trade_price != null
                        ? `→ ${Number(vixSnapshot.last_trade_price).toFixed(2)}`
                        : "—"}
                  </span>
                </span>
              </div>
              <div
                className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide"
                style={{
                  borderColor: colors.border,
                  background: "rgba(148,163,184,0.08)",
                  color: pulseRegimeColor(regimeLabel, colors)
                }}
              >
                Regime: {regimeLabel}
              </div>
              <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
                Per-symbol headlines are in the news drawer on each signal card (opens on demand — not prefetched).
              </p>
            </div>
          </article>
      </div>

      {morningVisible ? (
        morningBriefSlot ?? (scannerOverview.morningBrief ? (
          <MorningBriefCollapse mb={scannerOverview.morningBrief} pdt={pdt} />
        ) : null)
      ) : null}
      <SignalEvidenceModal
        open={evidenceOpen}
        evidence={evidence}
        onClose={() => setEvidenceOpen(false)}
        onOpenNewsPanel={(sym) => {
          setNewsPanelSymbol(sym.trim().toUpperCase());
          setNewsPanelOpen(true);
        }}
      />
      <NewsPanel
        symbol={newsPanelSymbol}
        isOpen={newsPanelOpen}
        onClose={() => {
          setNewsPanelOpen(false);
          setNewsUiTick((t) => t + 1);
        }}
        onLoaded={() => setNewsUiTick((t) => t + 1)}
      />
    </section>
  );
}
