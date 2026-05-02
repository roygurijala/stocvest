"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { fetchSymbolMinuteBars } from "@/lib/fetch-symbol-bars";
import { buildEvidenceFromSetup, type SignalEvidenceData } from "@/lib/signal-evidence";
import {
  CONFIDENCE_PERCENT_TIP,
  GAP_CANDIDATES_TIP,
  INTRADAY_SETUPS_TIP,
  NEWS_CATALYSTS_TIP,
  SETUP_RELATIVE_VOLUME_TIP
} from "@/lib/ui-tooltips";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { isUsRegularSessionOpenEt, isAfterOrbCloseEt, isoDateInNewYork } from "@/lib/market-hours-et";
import {
  catalystSentimentBadge,
  computePmhFromBars,
  entryZoneFromSnapshot,
  formatVolumeShort,
  gapDirectionContext,
  setupExpiryNote,
  setupPatternLabel
} from "@/lib/scanner-display-helpers";
import type { SnapshotPayload } from "@/lib/api/market";

interface ScannerPageClientProps {
  initialOverview: ScannerOverview;
  initialTimestampIso: string;
  earningsBySymbol: Record<string, EarningsEvent>;
}

const MONO = typography.fontFamilyMono;

function scoreColor(score: number, colors: ThemeColors): string {
  if (score >= 0.65) return colors.bullish;
  if (score <= 0.35) return colors.bearish;
  return colors.caution;
}

function isLongDirection(direction: string): boolean {
  return ["bullish", "long"].includes(direction.toLowerCase());
}

function formatSignalFiredTimeEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

export function ScannerPageClient({ initialOverview, initialTimestampIso, earningsBySymbol }: ScannerPageClientProps) {
  const { colors } = useTheme();
  const [isPending, startTransition] = useTransition();
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const router = useRouter();
  const [, forceTick] = useState(0);
  const nextScanRef = useRef(0);

  const [snapBySymbol, setSnapBySymbol] = useState<Record<string, SnapshotPayload | null>>({});
  const [pmhBySymbol, setPmhBySymbol] = useState<Record<string, number | null>>({});

  const symbolsKey = useMemo(
    () =>
      [
        ...new Set([
          ...initialOverview.gaps.map((g) => g.symbol),
          ...initialOverview.setups.map((s) => s.symbol)
        ])
      ]
        .sort()
        .join(","),
    [initialOverview.gaps, initialOverview.setups]
  );

  const gapMeanVolume = useMemo(() => {
    const vs = initialOverview.gaps.map((g) => g.day_volume || 0).filter((v) => v > 0);
    if (!vs.length) return 1;
    return vs.reduce((a, b) => a + b, 0) / vs.length;
  }, [initialOverview.gaps]);

  const gapMaxVolume = useMemo(
    () => Math.max(1, ...initialOverview.gaps.map((g) => g.day_volume || 0)),
    [initialOverview.gaps]
  );

  const gapMaxAbsPct = useMemo(
    () => Math.max(1, ...initialOverview.gaps.map((g) => Math.abs(g.gap_percent || 0))),
    [initialOverview.gaps]
  );

  const dayVolBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of initialOverview.gaps) {
      m.set(g.symbol, g.day_volume || 0);
    }
    return m;
  }, [initialOverview.gaps]);

  const rankedSetups = useMemo(() => {
    return [...initialOverview.setups]
      .filter((s) => typeof s.score === "number" && Number.isFinite(s.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [initialOverview.setups]);

  const gapSymbolsKey = useMemo(() => initialOverview.gaps.map((g) => g.symbol).join(","), [initialOverview.gaps]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const syms = symbolsKey.split(",").filter(Boolean);
      const entries = await Promise.all(syms.map(async (sym) => [sym, await fetchSymbolSnapshot(sym)] as const));
      if (cancelled) return;
      setSnapBySymbol(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [symbolsKey]);

  useEffect(() => {
    let cancelled = false;
    const ny = isoDateInNewYork();
    (async () => {
      const map: Record<string, number | null> = {};
      await Promise.all(
        initialOverview.gaps.map(async (g) => {
          const bars = await fetchSymbolMinuteBars(g.symbol, ny, ny, 500);
          if (cancelled) return;
          map[g.symbol] = computePmhFromBars(bars, ny);
        })
      );
      if (cancelled) return;
      setPmhBySymbol(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [gapSymbolsKey]);

  useEffect(() => {
    const id = window.setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    if (isUsRegularSessionOpenEt()) {
      nextScanRef.current = Date.now() + 5 * 60 * 1000;
    }
  }, [initialTimestampIso]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!isUsRegularSessionOpenEt()) return;
      if (nextScanRef.current <= 0) {
        nextScanRef.current = Date.now() + 5 * 60 * 1000;
        return;
      }
      if (Date.now() >= nextScanRef.current) {
        nextScanRef.current = Date.now() + 5 * 60 * 1000;
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [router]);

  const onManualRefresh = useCallback(() => {
    startTransition(() => {
      if (isUsRegularSessionOpenEt()) {
        nextScanRef.current = Date.now() + 5 * 60 * 1000;
      }
      router.refresh();
    });
  }, [router, startTransition]);

  const marketOpen = isUsRegularSessionOpenEt();
  const secondsToScan = Math.max(0, Math.ceil((nextScanRef.current - Date.now()) / 1000));
  const scanCountdownLabel = `${Math.floor(secondsToScan / 60)}:${String(secondsToScan % 60).padStart(2, "0")}`;

  const earningsBadgeFor = (symbol: string): { label: string; tip: string } | null => {
    const event = earningsBySymbol[symbol.toUpperCase()];
    if (!event) return null;
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 10);
    if (event.report_date !== today && event.report_date !== tomorrow) return null;
    const when = event.report_date === today ? "today" : "tomorrow";
    const timing =
      event.report_time === "before_market"
        ? "before market"
        : event.report_time === "after_market"
          ? "after market"
          : "during market";
    return {
      label: "📊 Earnings",
      tip: `This stock reports earnings ${when} ${timing}. Gaps and setups around earnings carry higher risk and reward.`
    };
  };
  const earningsRiskFor = (symbol: string): { daysUntil: number; reportTime: EarningsEvent["report_time"] } | null => {
    const event = earningsBySymbol[symbol.toUpperCase()];
    if (!event) return null;
    const today = new Date().toISOString().slice(0, 10);
    const dayDelta = Math.floor(
      (Date.parse(`${event.report_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
    );
    if (dayDelta < 0 || dayDelta > 3) return null;
    return { daysUntil: dayDelta, reportTime: event.report_time };
  };

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0" style={{ display: "grid", gap: spacing[1] }}>
          <p className="text-sm sm:text-base" style={{ margin: 0, color: colors.textMuted }}>
            Last scan: {new Date(initialTimestampIso).toLocaleString()}
          </p>
          <p className="text-xs sm:text-sm" style={{ margin: 0, color: colors.textMuted }}>
            {marketOpen ? (
              <>
                Next scan in <strong style={{ color: colors.text }}>{scanCountdownLabel}</strong>
              </>
            ) : (
              <>Market closed — showing last scan</>
            )}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 sm:w-auto"
          onClick={onManualRefresh}
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: colors.surface,
            color: colors.text,
            padding: `${spacing[2]} ${spacing[3]}`,
            cursor: "pointer"
          }}
        >
          <RefreshCw size={14} style={{ animation: isPending ? "spin 1s linear infinite" : undefined }} />
          {isPending ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div className="scanner-grid grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className="min-w-0" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], marginBottom: spacing[2] }}>
            <h3 style={{ margin: 0 }}>Gap Candidates</h3>
            <InfoTip text={GAP_CANDIDATES_TIP} label="About gap candidates" />
          </div>
          <div style={{ display: "grid", gap: spacing[3] }}>
            {initialOverview.gaps.length === 0 ? (
              <p style={{ margin: 0, color: colors.textMuted }}>No gap candidates right now.</p>
            ) : (
              initialOverview.gaps.map((gap, idx) => {
                const snap = snapBySymbol[gap.symbol] ?? null;
                const pmh = pmhBySymbol[gap.symbol];
                const ctx = gapDirectionContext(gap, snap);
                const vol = gap.day_volume || 0;
                const volRatio = gapMeanVolume > 0 ? vol / gapMeanVolume : 1;
                return (
                  <motion.article
                    key={`${gap.symbol}-${idx}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3] }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
                      <strong>{gap.symbol}</strong>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: spacing[1] }}>
                        {(() => {
                          const b = earningsBadgeFor(gap.symbol);
                          if (!b) return null;
                          return (
                            <span
                              style={{
                                borderRadius: borderRadius.full,
                                padding: "2px 8px",
                                background: "rgba(245,158,11,.18)",
                                color: colors.caution,
                                fontSize: typography.scale.xs,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4
                              }}
                            >
                              {b.label}
                              <InfoTip text={b.tip} label="Earnings risk" />
                            </span>
                          );
                        })()}
                        <span
                          style={{
                            borderRadius: borderRadius.full,
                            padding: "2px 8px",
                            fontSize: typography.scale.xs,
                            ...(gap.gap_percent > 0
                              ? { background: "rgba(34,197,94,0.18)", color: colors.bullish }
                              : gap.gap_percent < 0
                                ? { background: "rgba(239,68,68,0.18)", color: colors.bearish }
                                : { background: colors.surfaceMuted, color: colors.textMuted })
                          }}
                        >
                          {gap.gap_percent > 0 ? "+" : ""}
                          {gap.gap_percent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    {typeof pmh === "number" && Number.isFinite(pmh) ? (
                      <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.xs, fontFamily: MONO }}>
                        PMH: ${pmh.toFixed(2)}
                      </p>
                    ) : null}
                    {ctx ? (
                      <p style={{ margin: `${spacing[1]} 0 0`, color: colors.text, fontSize: typography.scale.xs }}>{ctx}</p>
                    ) : null}
                    <div style={{ marginTop: spacing[2], display: "grid", gap: spacing[2] }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: spacing[2],
                          fontSize: typography.scale.xs,
                          color: colors.textMuted
                        }}
                      >
                        <span>Prev close</span>
                        <span style={{ color: gap.gap_percent >= 0 ? colors.bullish : colors.bearish, fontSize: 14 }}>
                          {gap.gap_percent >= 0 ? "→" : "←"}
                        </span>
                        <span>Today / gap</span>
                      </div>
                      <div style={{ height: 10, background: colors.surfaceMuted, borderRadius: borderRadius.full, overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.min(100, (Math.abs(gap.gap_percent) / gapMaxAbsPct) * 100)}%`,
                            marginLeft: gap.gap_percent < 0 ? "auto" : 0,
                            borderRadius: borderRadius.full,
                            background: gap.gap_percent >= 0 ? colors.bullish : colors.bearish,
                            minWidth: "8%"
                          }}
                        />
                      </div>
                      <div style={{ height: 6, background: colors.surfaceMuted, borderRadius: borderRadius.full }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.max(8, (gap.day_volume / gapMaxVolume) * 100)}%`,
                            borderRadius: borderRadius.full,
                            background: colors.accent
                          }}
                        />
                      </div>
                      <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs, fontFamily: MONO }}>
                        {formatVolumeShort(vol)} ({volRatio.toFixed(1)}x avg)
                      </p>
                    </div>
                  </motion.article>
                );
              })
            )}
          </div>
        </section>

        <section className="min-w-0" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], marginBottom: spacing[2] }}>
            <h3 style={{ margin: 0 }}>News Catalysts</h3>
            <InfoTip text={NEWS_CATALYSTS_TIP} label="About news catalysts" />
          </div>
          <div style={{ display: "grid", gap: spacing[3] }}>
            {initialOverview.catalysts.length === 0 ? (
              <p style={{ margin: 0, color: colors.textMuted }}>No catalysts right now.</p>
            ) : (
              initialOverview.catalysts.map((c, idx) => {
                const sent = catalystSentimentBadge(c.catalyst_score);
                const badgeBg =
                  sent.tone === "bull"
                    ? "rgba(34,197,94,.15)"
                    : sent.tone === "bear"
                      ? "rgba(239,68,68,.15)"
                      : "rgba(245,158,11,.18)";
                const badgeFg = sent.tone === "bull" ? colors.bullish : sent.tone === "bear" ? colors.bearish : colors.caution;
                return (
                  <motion.article
                    key={`${c.article_id}-${idx}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3] }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}>
                      <strong>{c.symbol}</strong>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: spacing[2] }}>
                        <span style={{ color: scoreColor(c.catalyst_score, colors), fontSize: typography.scale.xs, fontFamily: MONO }}>
                          {Math.round(c.catalyst_score * 100)}
                        </span>
                        <span
                          style={{
                            borderRadius: borderRadius.full,
                            padding: "2px 8px",
                            fontSize: typography.scale.xs,
                            background: badgeBg,
                            color: badgeFg,
                            fontWeight: 600
                          }}
                        >
                          {sent.label}
                        </span>
                      </div>
                    </div>
                    <p style={{ margin: `${spacing[1]} 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
                      <span
                        style={{
                          background: "rgba(59,130,246,0.12)",
                          color: colors.accent,
                          borderRadius: borderRadius.full,
                          padding: "2px 8px"
                        }}
                      >
                        {c.catalyst_type}
                      </span>
                    </p>
                    <p style={{ margin: 0, fontSize: typography.scale.sm }}>
                      {c.title.length > 90 ? `${c.title.slice(0, 87)}...` : c.title}
                    </p>
                  </motion.article>
                );
              })
            )}
          </div>
        </section>

        <section className="min-w-0" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], marginBottom: spacing[2] }}>
            <h3 style={{ margin: 0 }}>Intraday Setups</h3>
            <InfoTip text={INTRADAY_SETUPS_TIP} label="About intraday setups" />
          </div>
          <div
            style={{
              display: "grid",
              gap: spacing[3],
              maxHeight: "min(70vh, 820px)",
              overflowY: "auto",
              paddingRight: spacing[1]
            }}
          >
            {rankedSetups.length === 0 ? (
              <p style={{ margin: 0, color: colors.textMuted }}>No setups right now.</p>
            ) : (
              rankedSetups.map((setup, idx) => {
                const snap = snapBySymbol[setup.symbol] ?? null;
                const zone = entryZoneFromSnapshot(snap);
                const vwap = snap?.day_vwap;
                const dv = dayVolBySymbol.get(setup.symbol);
                const volNum = snap?.day_volume ?? dv ?? null;
                const ratio =
                  volNum != null && gapMeanVolume > 0
                    ? Math.min(3.5, Math.max(0.35, volNum / gapMeanVolume))
                    : 0.85 + setup.score * 2.2;
                const fillPct = Math.min(100, (ratio / 3.5) * 100);
                const d = setup.direction.toLowerCase();
                const up = d === "long" || d === "bullish";
                const patternRaw = setup.triggers?.[0] ?? "";
                const patternLabel = setupPatternLabel(setup.triggers);
                const expiryNote = setupExpiryNote(patternRaw);
                const orbExpired = patternRaw.toLowerCase().startsWith("orb_") && isAfterOrbCloseEt();
                const longOrShort = isLongDirection(setup.direction) ? "Long" : "Short";

                return (
                  <motion.article
                    key={`${setup.symbol}-${setup.timestamp_iso}-${idx}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    style={{
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.lg,
                      padding: spacing[3],
                      display: "grid",
                      gap: spacing[2],
                      position: "relative",
                      paddingBottom: spacing[5],
                      opacity: orbExpired ? 0.7 : 1,
                      transition: "opacity 0.15s ease"
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: spacing[2],
                          flexWrap: "wrap",
                          minWidth: 0
                        }}
                      >
                        <strong style={{ fontSize: typography.scale.base }}>{setup.symbol}</strong>
                        {setup.company_name ? (
                          <span style={{ color: colors.textMuted, fontSize: "13px" }}>{setup.company_name}</span>
                        ) : null}
                      </div>
                      <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>{patternLabel}</span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                          width: "100%"
                        }}
                      >
                        {(() => {
                          const b = earningsBadgeFor(setup.symbol);
                          if (!b) return null;
                          return (
                            <span
                              style={{
                                borderRadius: borderRadius.full,
                                padding: "2px 8px",
                                background: "rgba(245,158,11,.18)",
                                color: colors.caution,
                                fontSize: typography.scale.xs,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4
                              }}
                            >
                              {b.label}
                              <InfoTip text={b.tip} label="Earnings risk" />
                            </span>
                          );
                        })()}
                        <span
                          style={{
                            borderRadius: borderRadius.full,
                            padding: "2px 8px",
                            background: isLongDirection(setup.direction) ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.15)",
                            color: isLongDirection(setup.direction) ? colors.bullish : colors.bearish,
                            fontSize: typography.scale.xs,
                            fontWeight: 600
                          }}
                        >
                          {longOrShort}
                        </span>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: typography.scale.sm,
                            color: colors.textMuted,
                            fontFamily: MONO
                          }}
                        >
                          {Math.round(setup.score * 100)}%
                          <InfoTip text={CONFIDENCE_PERCENT_TIP} label="About signal strength" />
                        </span>
                        {orbExpired ? (
                          <span
                            style={{
                              marginLeft: "auto",
                              fontSize: typography.scale.xs,
                              fontWeight: 700,
                              color: colors.caution,
                              background: "rgba(245,158,11,.2)",
                              borderRadius: borderRadius.md,
                              padding: "2px 8px"
                            }}
                          >
                            ORB EXPIRED
                          </span>
                        ) : null}
                      </div>
                      {orbExpired ? (
                        <p
                          style={{
                            margin: 0,
                            fontSize: "11px",
                            color: "var(--color-text-tertiary)",
                            fontStyle: "italic"
                          }}
                        >
                          Signal fired at {formatSignalFiredTimeEt(setup.timestamp_iso) || "—"} — window closed 10:00 AM ET
                        </p>
                      ) : null}
                    </div>
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
                      Vol: {volNum != null ? `${formatVolumeShort(volNum)} (${ratio.toFixed(1)}x avg)` : `${ratio.toFixed(1)}x avg`}
                      {typeof vwap === "number" && Number.isFinite(vwap) ? (
                        <>
                          {" "}
                          | VWAP:{" "}
                          <span style={{ fontFamily: MONO, color: colors.text }}>${vwap.toFixed(2)}</span>
                        </>
                      ) : null}
                    </p>
                    {zone ? (
                      <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs, fontFamily: MONO }}>
                        Historical entry zone: ${zone.lo.toFixed(2)}–${zone.hi.toFixed(2)}
                      </p>
                    ) : null}
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>{expiryNote}</p>
                    <div style={{ height: 10, background: colors.surfaceMuted, borderRadius: borderRadius.full, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${fillPct}%`,
                          borderRadius: borderRadius.full,
                          background: up ? colors.bullish : colors.bearish,
                          opacity: 0.92
                        }}
                      />
                    </div>
                    <div style={{ display: "inline-flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
                      <span
                        title={orbExpired ? "ORB window has closed for today" : undefined}
                        style={{ display: "inline-flex", cursor: orbExpired ? "not-allowed" : undefined }}
                      >
                        <button
                          type="button"
                          disabled={orbExpired}
                          onClick={() => {
                            if (orbExpired) return;
                            setSelectedSymbol(setup.symbol);
                          }}
                          style={{
                            border: `1px solid ${orbExpired ? "var(--color-border)" : colors.accent}`,
                            borderRadius: borderRadius.md,
                            background: orbExpired ? "var(--color-background-secondary)" : "rgba(59,130,246,0.15)",
                            color: orbExpired ? "var(--color-text-tertiary)" : colors.accent,
                            padding: `${spacing[1]} ${spacing[2]}`,
                            cursor: orbExpired ? "not-allowed" : "pointer",
                            fontSize: typography.scale.xs,
                            opacity: orbExpired ? 0.4 : 1
                          }}
                        >
                          Open order entry
                        </button>
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          let symbolNewsArticles: Awaited<ReturnType<typeof fetchSymbolNews>> = [];
                          try {
                            symbolNewsArticles = await fetchSymbolNews(setup.symbol, 10);
                          } catch {
                            symbolNewsArticles = [];
                          }
                          const risk = earningsRiskFor(setup.symbol);
                          const sym = setup.symbol.trim().toUpperCase();
                          const s = (await fetchSymbolSnapshot(sym)) ?? undefined;
                          setEvidence(
                            buildEvidenceFromSetup(setup, s, {
                              symbolNewsArticles,
                              earningsRiskDays: risk?.daysUntil,
                              earningsReportTime: risk?.reportTime
                            })
                          );
                          setEvidenceOpen(true);
                        }}
                        style={{
                          border: `1px solid ${colors.border}`,
                          borderRadius: borderRadius.md,
                          background: "transparent",
                          color: colors.text,
                          padding: `${spacing[1]} ${spacing[2]}`,
                          cursor: "pointer",
                          fontSize: typography.scale.xs
                        }}
                      >
                        View Evidence
                      </button>
                      <InfoTip text={SETUP_RELATIVE_VOLUME_TIP} label="Relative volume" />
                    </div>
                    <div style={{ position: "absolute", right: spacing[3], bottom: spacing[3] }}>
                      <SignalDisclaimerChip />
                    </div>
                  </motion.article>
                );
              })
            )}
          </div>
        </section>
      </div>

      {selectedSymbol ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "grid",
            placeItems: "center",
            zIndex: 60
          }}
        >
          <div style={{ width: "min(460px, 92vw)", background: colors.surface, borderRadius: borderRadius.xl, padding: spacing[5] }}>
            <h3 style={{ marginTop: 0 }}>Order modal placeholder</h3>
            <p style={{ margin: `${spacing[2]} 0`, color: colors.textMuted }}>
              Trade flow for <strong>{selectedSymbol}</strong> will be wired in a later phase.
            </p>
            <button
              type="button"
              onClick={() => setSelectedSymbol(null)}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                background: "transparent",
                color: colors.text,
                padding: `${spacing[2]} ${spacing[3]}`,
                cursor: "pointer"
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      <SignalEvidenceModal open={evidenceOpen} evidence={evidence} onClose={() => setEvidenceOpen(false)} />
    </section>
  );
}
