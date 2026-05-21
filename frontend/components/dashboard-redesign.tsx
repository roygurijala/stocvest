"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { DashboardDeskModePills } from "@/components/dashboard/dashboard-desk-mode-pills";
import { DashboardEdgeSync } from "@/components/dashboard-edge-sync";
import { DashboardInsightCallout } from "@/components/dashboard/dashboard-insight-callout";
import { DashboardLiveStatus } from "@/components/dashboard/dashboard-live-status";
import { DashboardMarketContextPanel } from "@/components/dashboard/dashboard-market-context-panel";
import { DashboardOpportunitiesOverview } from "@/components/dashboard/dashboard-opportunities-overview";
import { DashboardScannerLoadingStrip } from "@/components/dashboard/dashboard-scanner-suspense-fallback";
import { ScannerOverviewProvider, useScannerOverview } from "@/components/dashboard/scanner-overview-context";
import { DashboardEarningsProvider, useDashboardEarnings } from "@/components/dashboard/dashboard-earnings-context";
import { buildDashboardAssistantPageContext } from "@/lib/dashboard/dashboard-assistant-context";
import { buildLiveStatusCopy, type DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { EarningsCalendar } from "@/components/earnings-calendar";
import { InfoTip } from "@/components/info-tip";
import { type WeeklyIndexRow } from "@/components/weekly-market-context-widget";
import { buildMarketContextSnapshot } from "@/lib/market-context/snapshot";
import {
  regimeBadgeExplanation,
  regimeLabelIsDirectional,
  resolveRegimeLabel
} from "@/lib/market-context/regime";
import type { SectorRotationChip } from "@/lib/market-context/types";
import { useMacroContext } from "@/lib/hooks/use-macro-context";
import { useDashboardPayload } from "@/lib/hooks/use-dashboard-payload";
import { isStale } from "@/lib/api/dashboard";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import {
  isVixTickerSymbol,
  vixPulseDataAvailable,
  vixSnapshotDisplayLevel,
  vixSnapshotSessionChangePct
} from "@/lib/api/market-snapshot-helpers";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import {
  dayDeskPostureKind,
  type DayDeskPostureKind,
  dashboardSystemStateKind,
  dashboardSystemStateLabel
} from "@/lib/dashboard-posture";
import {
  VIX_BLANK_DATA_PENDING_TIP,
  VIX_BLANK_MARKET_CLOSED_TIP,
  VIX_BLANK_UPSTREAM_TIP
} from "@/lib/ui-tooltips";

export type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";
export type { SectorRotationChip } from "@/lib/market-context/types";

interface DashboardRedesignProps {
  marketOverview: MarketOverview;
  scannerOverview: ScannerOverview;
  earningsEvents: EarningsEvent[];
  earningsRecent: EarningsEvent[];
  weeklyIndexRows: WeeklyIndexRow[];
  sectorRotation: SectorRotationChip[];
  dayTradingSurfaces?: boolean;
  deferredEarningsSlot?: ReactNode;
  deferredScannerSlot?: ReactNode;
}

function toPrice(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "";
  return `$${n.toFixed(2)}`;
}

/** Session change % for pulse widgets (aligns with scanner `snapPct`: regular → pre → after → derived). */
function snapshotSessionChangePct(s: SnapshotPayload | null | undefined): number | null {
  if (!s) return null;
  const clean = (v: number | null | undefined): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v <= -99.5) return null;
    return v;
  };
  const c = s.change_percent;
  if (clean(c) != null) return clean(c);
  const pre = s.pre_market_change_percent;
  if (clean(pre) != null) return clean(pre);
  const ah = s.after_hours_change_percent;
  if (clean(ah) != null) return clean(ah);
  const last = s.last_trade_price;
  const prev = s.prev_close;
  if (
    typeof last === "number" &&
    typeof prev === "number" &&
    Number.isFinite(last) &&
    Number.isFinite(prev) &&
    prev !== 0
  ) {
    return clean(((last - prev) / prev) * 100);
  }
  return null;
}

/** Prefer a VIX row we can actually render (Polygon sometimes omits last trade on `I:VIX` while `^VIX` is usable). */
function findVixSnapshot(snapshots: SnapshotPayload[]): SnapshotPayload | undefined {
  const preferred = new Set(["I:VIX", "^VIX", "VIX"]);
  const bySym = new Map<string, SnapshotPayload>();
  const fringe: SnapshotPayload[] = [];
  for (const x of snapshots) {
    const u = (x.symbol || "").trim().toUpperCase();
    if (!u) continue;
    bySym.set(u, x);
    if (!preferred.has(u) && isVixTickerSymbol(u)) fringe.push(x);
  }
  const pickUsable = (hit: SnapshotPayload | undefined): SnapshotPayload | undefined => {
    if (!hit) return undefined;
    const pct = vixSnapshotSessionChangePct(hit);
    return vixPulseDataAvailable(hit, pct) ? hit : undefined;
  };
  for (const k of ["I:VIX", "^VIX", "VIX"]) {
    const ok = pickUsable(bySym.get(k));
    if (ok) return ok;
  }
  for (const x of fringe) {
    const ok = pickUsable(x);
    if (ok) return ok;
  }
  for (const k of ["I:VIX", "^VIX", "VIX"]) {
    const hit = bySym.get(k);
    if (hit) return hit;
  }
  return fringe[0];
}

type MarketPulseCacheData = {
  vix_level?: number | null;
};

function vixSnapshotFromPulseLevel(level: number): SnapshotPayload {
  return { symbol: "I:VIX", last_trade_price: level };
}

type VixBlankKind = "market_closed" | "upstream_gap" | "data_pending";

function resolveVixBlankKind(
  vixPulseOk: boolean,
  status: MarketOverview["status"],
  marketError: string | undefined,
  spyPct: number | null,
  qqqPct: number | null
): VixBlankKind | null {
  if (vixPulseOk) return null;
  if (marketError) return "upstream_gap";
  const m = status?.market?.trim().toLowerCase();
  if (m && m !== "open") return "market_closed";
  if (m === "open") {
    if (spyPct == null && qqqPct == null) return "data_pending";
    return "upstream_gap";
  }
  if (spyPct == null && qqqPct == null) return "data_pending";
  return "upstream_gap";
}

function vixBlankTag(kind: VixBlankKind): string {
  switch (kind) {
    case "market_closed":
      return "(market closed)";
    case "data_pending":
      return "(data pending)";
    default:
      return "(unavailable)";
  }
}

function VixDashExplained({ kind, colors }: { kind: VixBlankKind; colors: ReturnType<typeof useTheme>["colors"] }) {
  const tag = vixBlankTag(kind);
  const tip =
    kind === "market_closed"
      ? VIX_BLANK_MARKET_CLOSED_TIP
      : kind === "data_pending"
        ? VIX_BLANK_DATA_PENDING_TIP
        : VIX_BLANK_UPSTREAM_TIP;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
      <span>—</span>
      <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.textMuted }}>{tag}</span>
      <InfoTip text={tip} label="What the VIX dash means" maxWidth={320} />
    </span>
  );
}

function swingDeskStatusPhrase(posture: "active" | "monitor" | "suppressed"): string {
  if (posture === "active") return "Active";
  if (posture === "monitor") return "Monitor only";
  return "Suppressed";
}

function dayDeskStatusPhrase(kind: DayDeskPostureKind): string {
  switch (kind) {
    case "active":
      return "Active";
    case "monitor":
      return "Monitor only";
    case "suppressed_session_closed":
      return "Suppressed · session";
    case "suppressed_no_confirmation":
      return "Suppressed · no confirmation";
    case "suppressed_scanner_error":
      return "Suppressed · scanner";
    default:
      return "Suppressed";
  }
}

export function DashboardRedesign(props: DashboardRedesignProps) {
  return (
    <ScannerOverviewProvider initialOverview={props.scannerOverview}>
      <DashboardEarningsProvider initialUpcoming={props.earningsEvents} initialRecent={props.earningsRecent}>
        <DashboardRedesignBody {...props} />
      </DashboardEarningsProvider>
    </ScannerOverviewProvider>
  );
}

function DashboardRedesignBody({
  marketOverview,
  weeklyIndexRows,
  sectorRotation,
  dayTradingSurfaces = true,
  deferredEarningsSlot,
  deferredScannerSlot
}: DashboardRedesignProps) {
  const scannerOverview = useScannerOverview();
  const { upcoming: earningsEvents, recent: earningsRecent } = useDashboardEarnings();
  const { colors } = useTheme();
  const { data: macroPulse } = useMacroContext();
  const { data: edgeDashboard } = useDashboardPayload("swing");
  const [deskMode, setDeskMode] = useState<DashboardDeskMode>(
    dayTradingSurfaces ? "day" : "swing"
  );

  const snapshotsBySymbol = useMemo(
    () => new Map(marketOverview.snapshots.map((s) => [(s.symbol || "").toUpperCase(), s])),
    [marketOverview.snapshots]
  );
  const swingTopSignals = useMemo(
    () => scannerOverview.setups.filter((s) => s.scanner_mode === "swing_daily"),
    [scannerOverview.setups]
  );
  const daySignalsForRibbon = useMemo(
    () =>
      dayTradingSurfaces
        ? scannerOverview.setups.filter(
            (s) =>
              s.scanner_mode !== "swing_daily" &&
              typeof s.score === "number" &&
              Number.isFinite(s.score)
          )
        : [],
    [scannerOverview.setups, dayTradingSurfaces]
  );
  const dayTopScore = useMemo(() => {
    let best: number | null = null;
    for (const s of daySignalsForRibbon) {
      if (typeof s.score === "number" && Number.isFinite(s.score)) {
        if (best == null || s.score > best) best = s.score;
      }
    }
    return best;
  }, [daySignalsForRibbon]);

  const vixFromTape =
    findVixSnapshot(marketOverview.snapshots) ||
    snapshotsBySymbol.get("I:VIX") ||
    snapshotsBySymbol.get("VIX") ||
    snapshotsBySymbol.get("^VIX");

  const pulseVixLevel = useMemo(() => {
    const env = edgeDashboard?.market_pulse;
    if (!env || isStale(env)) return null;
    const raw = (env.data ?? {}) as MarketPulseCacheData;
    const v = raw.vix_level;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  }, [edgeDashboard?.market_pulse]);

  const [indicesVixSnap, setIndicesVixSnap] = useState<SnapshotPayload | null>(null);
  const tapeVixOk = useMemo(() => {
    const pct = vixSnapshotSessionChangePct(vixFromTape);
    return Boolean(vixFromTape && vixPulseDataAvailable(vixFromTape, pct));
  }, [vixFromTape]);

  useEffect(() => {
    if (tapeVixOk || pulseVixLevel != null) {
      setIndicesVixSnap(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/market/vix-snapshot", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { snapshot?: SnapshotPayload | null };
        if (!cancelled && json.snapshot) setIndicesVixSnap(json.snapshot);
      } catch {
        if (!cancelled) setIndicesVixSnap(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tapeVixOk, pulseVixLevel]);

  const vixSnapshot = useMemo(() => {
    const pct = vixSnapshotSessionChangePct(vixFromTape);
    if (vixFromTape && vixPulseDataAvailable(vixFromTape, pct)) return vixFromTape;
    if (pulseVixLevel != null) return vixSnapshotFromPulseLevel(pulseVixLevel);
    if (indicesVixSnap) {
      const ip = vixSnapshotSessionChangePct(indicesVixSnap);
      if (vixPulseDataAvailable(indicesVixSnap, ip)) return indicesVixSnap;
    }
    return vixFromTape;
  }, [vixFromTape, pulseVixLevel, indicesVixSnap]);

  const spyFromScanner =
    typeof scannerOverview.spyPct === "number" &&
    Number.isFinite(scannerOverview.spyPct) &&
    scannerOverview.spyPct > -99.5
      ? scannerOverview.spyPct
      : null;
  const qqqFromScanner =
    typeof scannerOverview.qqqPct === "number" &&
    Number.isFinite(scannerOverview.qqqPct) &&
    scannerOverview.qqqPct > -99.5
      ? scannerOverview.qqqPct
      : null;
  const spyPct = spyFromScanner ?? snapshotSessionChangePct(snapshotsBySymbol.get("SPY"));
  const qqqPct = qqqFromScanner ?? snapshotSessionChangePct(snapshotsBySymbol.get("QQQ"));
  const { label: regimeLabel } = resolveRegimeLabel({
    scannerError: scannerOverview.error,
    scannerRegimeLabel: scannerOverview.regimeLabel,
    spyPct: spyFromScanner,
    qqqPct: qqqFromScanner
  });
  const vixPct = vixSnapshotSessionChangePct(vixSnapshot);
  const vixPulseOk = vixPulseDataAvailable(vixSnapshot, vixPct);
  const vixBlankKind = resolveVixBlankKind(vixPulseOk, marketOverview.status, marketOverview.error, spyPct, qqqPct);
  const regimeBadgePriceBreadthOnly = !vixPulseOk && regimeLabelIsDirectional(regimeLabel);
  const regimeTip = useMemo(() => regimeBadgeExplanation(vixPulseOk), [vixPulseOk]);
  const vixLevel = vixSnapshot ? vixSnapshotDisplayLevel(vixSnapshot) : null;

  const dayDeskPosture: DayDeskPostureKind = useMemo(
    () =>
      dayDeskPostureKind({
        marketStatus: marketOverview.status,
        daySetupCount: daySignalsForRibbon.length,
        daySetupTopScore: dayTopScore,
        scannerError: scannerOverview.error
      }),
    [marketOverview.status, daySignalsForRibbon.length, dayTopScore, scannerOverview.error]
  );
  const swingDeskPosture: "active" | "monitor" | "suppressed" = useMemo(() => {
    if (scannerOverview.error) return "suppressed";
    if (swingTopSignals.length > 0) return "active";
    return "suppressed";
  }, [scannerOverview.error, swingTopSignals.length]);

  const scannerDataSettled = useMemo(
    () =>
      Boolean(scannerOverview.error) ||
      scannerOverview.swingUniverseSymbolCount != null ||
      scannerOverview.gapIntelligence.length > 0 ||
      scannerOverview.setups.length > 0,
    [
      scannerOverview.error,
      scannerOverview.swingUniverseSymbolCount,
      scannerOverview.gapIntelligence.length,
      scannerOverview.setups.length
    ]
  );

  const upcomingCatalystWeek = useMemo(
    () =>
      [...earningsEvents]
        .filter((e) => typeof e.report_date === "string" && e.report_date.length > 0)
        .sort((a, b) => a.report_date.localeCompare(b.report_date))
        .slice(0, 10),
    [earningsEvents]
  );

  const assistantPageContext = useMemo(
    () =>
      buildDashboardAssistantPageContext({
        regimeLabel,
        swingDeskPosture,
        dayDeskPosture: dayTradingSurfaces ? dayDeskPosture : undefined,
        daySetupsCount: daySignalsForRibbon.length,
        dayTradingSurfaces,
        swingTopSignals,
        gapIntelligence: scannerOverview.gapIntelligence,
        swingUniverseSymbolCount: scannerOverview.swingUniverseSymbolCount ?? null,
        gapSnapshotSymbolCount: scannerOverview.gapIntelligenceSnapshotSymbolCount ?? null,
        upcomingEarnings: upcomingCatalystWeek,
        scannerDataSettled,
        discoveryExpanded: false
      }),
    [
      regimeLabel,
      swingDeskPosture,
      dayDeskPosture,
      daySignalsForRibbon.length,
      dayTradingSurfaces,
      swingTopSignals,
      scannerOverview.gapIntelligence,
      scannerOverview.swingUniverseSymbolCount,
      scannerOverview.gapIntelligenceSnapshotSymbolCount,
      upcomingCatalystWeek,
      scannerDataSettled
    ]
  );
  usePublishAssistantContext(assistantPageContext);

  const marketContextSnapshot = useMemo(
    () =>
      buildMarketContextSnapshot({
        weeklyIndexRows,
        sectorRotation,
        upcomingEarnings: upcomingCatalystWeek,
        macro: macroPulse ?? null,
        regimeLabel,
        regimePriceBreadthOnly: regimeBadgePriceBreadthOnly,
        vixLevel,
        vixSessionPct: vixPct,
        vixPulseOk,
        spyPct,
        qqqPct
      }),
    [
      weeklyIndexRows,
      sectorRotation,
      upcomingCatalystWeek,
      macroPulse,
      regimeLabel,
      regimeBadgePriceBreadthOnly,
      vixLevel,
      vixPct,
      vixPulseOk,
      spyPct,
      qqqPct
    ]
  );

  const systemKind = dashboardSystemStateKind({
    swingDeskActive: swingDeskPosture === "active",
    dayDeskPosture,
    dayTradingSurfaces
  });
  const systemLabel = dashboardSystemStateLabel(systemKind);
  const systemSuppressed = systemKind === "suppressed";

  const activeDeskMode: DashboardDeskMode =
    dayTradingSurfaces && deskMode === "day" ? "day" : "swing";

  const liveStatus = useMemo(
    () =>
      buildLiveStatusCopy({
        mode: activeDeskMode,
        swingDeskActive: swingDeskPosture === "active",
        dayDeskPosture,
        scanSummary: scannerOverview.scanSummary,
        systemSuppressed
      }),
    [activeDeskMode, swingDeskPosture, dayDeskPosture, scannerOverview.scanSummary, systemSuppressed]
  );

  const nearReadyInMarket = useMemo(() => {
    const rows = scannerOverview.scanSummary?.near_qualification ?? [];
    return rows.filter((r) => r.desk === activeDeskMode).length;
  }, [scannerOverview.scanSummary, activeDeskMode]);

  return (
    <section className="stocvest-dashboard-v2" style={{ display: "grid", gap: spacing[4] }}>
      <DashboardDeskModePills
        mode={activeDeskMode}
        onModeChange={setDeskMode}
        showDay={dayTradingSurfaces}
      />

      {!scannerDataSettled ? <DashboardScannerLoadingStrip /> : null}
      {deferredScannerSlot}

      <div
        role="region"
        aria-label="System state"
        data-testid="dashboard-system-state-banner"
        className={surfaceGlowClassName}
        style={{
          borderRadius: borderRadius.lg,
          border: `1px solid color-mix(in srgb, ${colors.border} 85%, ${colors.accent} 15%)`,
          background: `color-mix(in srgb, ${colors.surface} 94%, ${colors.accent} 6%)`,
          padding: `${spacing[3]} ${spacing[4]}`
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          System state
        </p>
        <div
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"
          style={{ fontSize: typography.scale.sm, color: colors.text }}
        >
          <span>
            <strong>Regime:</strong>{" "}
            <span style={{ color: colors.accent, fontWeight: 600 }}>{regimeLabel}</span>
          </span>
          <span style={{ color: colors.textMuted }}>|</span>
          <span>
            <strong>Status:</strong> {systemLabel}
          </span>
          <InfoTip text={regimeTip} label="How regime is read" maxWidth={300} />
        </div>
        {!scannerDataSettled ? (
          <p
            data-testid="dashboard-system-state-pending"
            style={{
              margin: `${spacing[2]} 0 0`,
              fontSize: typography.scale.sm,
              color: colors.textMuted,
              lineHeight: 1.5
            }}
          >
            Scanner still loading — desk status may update when the universe finishes.
          </p>
        ) : systemSuppressed ? (
          <p
            data-testid="dashboard-system-suppressed-callout"
            style={{
              margin: `${spacing[2]} 0 0`,
              fontSize: typography.scale.sm,
              color: colors.textMuted,
              lineHeight: 1.5
            }}
          >
            <strong style={{ color: colors.text, fontWeight: 600 }}>Desk gated.</strong> No actionable
            setups on the {activeDeskMode} desk right now — normal when session or structure gates are
            closed, not a system error.
          </p>
        ) : null}
        <details style={{ marginTop: spacing[2] }}>
          <summary
            style={{
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              cursor: "pointer",
              listStylePosition: "outside"
            }}
          >
            Desk posture detail
          </summary>
          <ul
            style={{
              margin: `${spacing[2]} 0 0`,
              paddingLeft: spacing[4],
              color: colors.textMuted,
              fontSize: typography.scale.xs,
              lineHeight: 1.5
            }}
          >
            <li>
              Swing: {swingDeskStatusPhrase(swingDeskPosture)}
              {scannerOverview.error ? " — scanner incomplete" : ""}
            </li>
            {dayTradingSurfaces ? <li>Day: {dayDeskStatusPhrase(dayDeskPosture)}</li> : null}
            <li className="inline-flex flex-wrap items-center gap-1">
              VIX{" "}
              {vixPulseOk && vixLevel != null ? (
                <span style={{ color: colors.text }}>{toPrice(vixLevel)}</span>
              ) : vixBlankKind ? (
                <VixDashExplained kind={vixBlankKind} colors={colors} />
              ) : (
                "—"
              )}
            </li>
          </ul>
        </details>
      </div>

      <DashboardLiveStatus status={liveStatus} />

      <DashboardOpportunitiesOverview
        mode={activeDeskMode}
        dayTradingSurfaces={dayTradingSurfaces}
        scanSummary={scannerOverview.scanSummary}
        watchlistStatus={scannerOverview.watchlistStatus}
      />

      <DashboardMarketContextPanel snapshot={marketContextSnapshot} />

      <DashboardInsightCallout mode={activeDeskMode} nearReadyInMarket={nearReadyInMarket} />

      <nav
        data-testid="dashboard-desk-status"
        aria-label="Scanner shortcuts"
        className="sr-only"
      >
        <span>Scanner shortcuts moved to Opportunities and Live status</span>
      </nav>

      <EarningsCalendar events={earningsEvents} title="Upcoming Earnings (Next 7 Days)" maxDays={7} />

      {deferredEarningsSlot}
      <DashboardEdgeSync />
    </section>
  );
}
