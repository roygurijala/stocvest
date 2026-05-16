"use client";

import { useMemo, type ReactNode } from "react";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { DashboardEdgeSync } from "@/components/dashboard-edge-sync";
import { ScannerOverviewProvider, useScannerOverview } from "@/components/dashboard/scanner-overview-context";
import { DashboardEarningsProvider, useDashboardEarnings } from "@/components/dashboard/dashboard-earnings-context";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { buildDashboardAssistantPageContext } from "@/lib/dashboard/dashboard-assistant-context";
import { EarningsCalendar } from "@/components/earnings-calendar";
import { InfoTip } from "@/components/info-tip";
import { type WeeklyIndexRow } from "@/components/weekly-market-context-widget";
import { SharedContextMasterCard } from "@/components/shared-context-master-card";
import { useMacroContext } from "@/lib/hooks/use-macro-context";
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
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";
import {
  dayDeskPostureKind,
  type DayDeskPostureKind,
  dashboardSystemStateKind,
  dashboardSystemStateLabel
} from "@/lib/dashboard-posture";
import Link from "next/link";
import {
  REGIME_BADGE_TIP,
  REGIME_WITHOUT_VIX_APPEND,
  VIX_BLANK_DATA_PENDING_TIP,
  VIX_BLANK_MARKET_CLOSED_TIP,
  VIX_BLANK_UPSTREAM_TIP
} from "@/lib/ui-tooltips";

export type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";

export type SectorRotationChip = { symbol: string; label: string; pct5d: number | null };

/** Watchlist dot legend — surfaced only via the (i) next to “Watchlist status”, not inline. */
const DASHBOARD_WATCHLIST_STATUS_DOT_HELP =
  "● Actionable — returned a setup row this scan.\n" +
  "● Developing — in the scan universe, no row yet.\n" +
  "● Inactive — not in this scan's capped universe.";

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

function regimeLabelIsDirectional(regimeLabel: string): boolean {
  const r = regimeLabel.trim().toLowerCase();
  return r.includes("bear") || r.includes("bull");
}

function regimeFromSpyQqq(spyPct: number | null, qqqPct: number | null, fallback: string): string {
  if (spyPct != null && qqqPct != null) {
    if (spyPct > 0.2 && qqqPct > 0.15) return "Bullish";
    if (spyPct < -0.2 || qqqPct < -0.25) return "Bearish";
    return "Neutral";
  }
  return fallback;
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
  const swingScannerHoverPrefetch = useHoverPrefetch("/dashboard/scanner?mode=swing");
  const dayScannerHoverPrefetch = useHoverPrefetch("/dashboard/scanner?mode=day");
  const watchlistHoverPrefetch = useHoverPrefetch("/dashboard/watchlists");
  const signalsHubHoverPrefetch = useHoverPrefetch("/dashboard/signals");

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

  const vixSnapshot =
    findVixSnapshot(marketOverview.snapshots) ||
    snapshotsBySymbol.get("I:VIX") ||
    snapshotsBySymbol.get("VIX") ||
    snapshotsBySymbol.get("^VIX");

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
  const useScannerRegime =
    !scannerOverview.error && spyFromScanner != null && qqqFromScanner != null;
  const regimeLabel = useScannerRegime
    ? (scannerOverview.regimeLabel ?? "Neutral")
    : regimeFromSpyQqq(spyPct, qqqPct, scannerOverview.regimeLabel ?? "Neutral");
  const vixPct = vixSnapshotSessionChangePct(vixSnapshot);
  const vixPulseOk = vixPulseDataAvailable(vixSnapshot, vixPct);
  const vixBlankKind = resolveVixBlankKind(vixPulseOk, marketOverview.status, marketOverview.error, spyPct, qqqPct);
  const regimeBadgePriceBreadthOnly = !vixPulseOk && regimeLabelIsDirectional(regimeLabel);
  const regimeBadgeExplanation = useMemo(() => {
    if (vixPulseOk) return REGIME_BADGE_TIP;
    return `${REGIME_BADGE_TIP}${REGIME_WITHOUT_VIX_APPEND}`;
  }, [vixPulseOk]);

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
    () => [...earningsEvents].sort((a, b) => a.report_date.localeCompare(b.report_date)).slice(0, 10),
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

  const macroWarnings = macroPulse?.warnings ?? [];

  const sharedContextPayload = {
    weeklyIndexRows,
    marketStatus: marketOverview.status,
    vixSnapshot,
    vixSessionPct: vixPct,
    sectorRotation,
    upcomingEarnings: upcomingCatalystWeek,
    macroWarningHeadline: macroWarnings[0] ?? null,
    dataIssue:
      weeklyIndexRows.every((r) => r.pct5d == null) && weeklyIndexRows.every((r) => r.lastPrice == null)
        ? marketOverview.error || null
        : null
  };

  const systemKind = dashboardSystemStateKind({
    swingDeskActive: swingDeskPosture === "active",
    dayDeskPosture,
    dayTradingSurfaces
  });
  const systemLabel = dashboardSystemStateLabel(systemKind);
  const desksActionable = swingDeskPosture === "active" || dayDeskPosture === "active";
  const watchlistStrip = scannerOverview.watchlistStatus;
  const showWatchlistStrip =
    watchlistStrip != null && typeof watchlistStrip.monitored === "number" && watchlistStrip.monitored > 0;

  return (
    <section className="stocvest-dashboard-v2" style={{ display: "grid", gap: spacing[4] }}>
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
            fontSize: typography.scale.sm,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          System state ·{" "}
          <span style={{ color: colors.text, letterSpacing: "0.06em" }}>{systemLabel}</span>
        </p>
        <ul
          style={{
            margin: `${spacing[2]} 0 0`,
            paddingLeft: `calc(${spacing[4]} + 4px)`,
            color: colors.text,
            fontSize: typography.scale.sm,
            lineHeight: 1.55,
            fontWeight: 500
          }}
        >
          <li style={{ marginBottom: spacing[1] }}>
            Swing Desk: {swingDeskStatusPhrase(swingDeskPosture)}
            {scannerOverview.error ? (
              <span style={{ color: colors.caution, fontWeight: 400 }}> — scanner incomplete</span>
            ) : null}
          </li>
          {dayTradingSurfaces ? (
            <li style={{ marginBottom: spacing[1] }}>Day Desk: {dayDeskStatusPhrase(dayDeskPosture)}</li>
          ) : null}
          <li style={{ color: colors.textMuted, fontWeight: 400 }}>
            {desksActionable
              ? "At least one desk has qualifying rows this load — open Scanner for full detail."
              : "No actionable signals right now."}
          </li>
        </ul>
        <div className="mt-2 inline-flex flex-wrap items-center gap-2" style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          <span>
            Tape regime: <strong style={{ color: colors.text }}>{regimeLabel}</strong>
          </span>
          <InfoTip text={regimeBadgeExplanation} label="How regime is read" maxWidth={300} />
          <span className="inline-flex items-center gap-1">
            · VIX{" "}
            {vixPulseOk && vixSnapshot && vixSnapshotDisplayLevel(vixSnapshot) ? (
              <span style={{ color: colors.text, fontWeight: 600 }}>{toPrice(vixSnapshotDisplayLevel(vixSnapshot))}</span>
            ) : vixPct != null ? (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{`${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(2)}%`}</span>
            ) : vixBlankKind ? (
              <VixDashExplained kind={vixBlankKind} colors={colors} />
            ) : (
              <span>—</span>
            )}
          </span>
          {regimeBadgePriceBreadthOnly ? (
            <span style={{ fontStyle: "italic" }}>Regime uses price breadth; VIX pulse unavailable.</span>
          ) : null}
        </div>
      </div>

      {showWatchlistStrip && watchlistStrip ? (
        <div
          role="region"
          aria-label="Watchlist status"
          data-testid="dashboard-watchlist-status"
          className={surfaceGlowClassName}
          style={{
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            padding: spacing[3]
          }}
        >
          <div
            className="flex flex-wrap items-center gap-2"
            style={{ margin: 0, alignItems: "center" }}
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
              Watchlist status
            </p>
            <InfoTip
              text={DASHBOARD_WATCHLIST_STATUS_DOT_HELP}
              label="What the watchlist status dots mean"
              maxWidth={320}
            />
          </div>
          <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text, fontWeight: 600 }}>
            {watchlistStrip.monitored} symbol{watchlistStrip.monitored === 1 ? "" : "s"} monitored ·{" "}
            <span style={{ color: colors.bullish }}>● {watchlistStrip.actionable} actionable</span>
            {" · "}
            <span style={{ color: colors.caution }}>● {watchlistStrip.developing} developing</span>
            {" · "}
            <span style={{ color: colors.textMuted }}>● {watchlistStrip.inactive} inactive</span>
          </p>
          <Link
            href="/dashboard/watchlists"
            prefetch={false}
            data-hover-prefetch="true"
            {...interactionLevelProps("deep")}
            onMouseEnter={watchlistHoverPrefetch.onMouseEnter}
            onFocus={watchlistHoverPrefetch.onFocus}
            onPointerDown={watchlistHoverPrefetch.onPointerDown}
            className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold"
            style={{ color: colors.accent }}
          >
            View watchlist →
          </Link>
        </div>
      ) : null}

      <nav
        data-testid="dashboard-desk-status"
        aria-label="Scanner shortcuts"
        className="flex flex-wrap items-center gap-x-6 gap-y-1"
      >
        <Link
          href="/dashboard/scanner?mode=swing"
          prefetch={false}
          data-hover-prefetch="true"
          {...interactionLevelProps("deep")}
          onMouseEnter={swingScannerHoverPrefetch.onMouseEnter}
          onFocus={swingScannerHoverPrefetch.onFocus}
          onPointerDown={swingScannerHoverPrefetch.onPointerDown}
          className="inline-flex min-h-10 items-center text-sm font-semibold"
          style={{ color: colors.accent }}
        >
          Swing scanner →
        </Link>
        {dayTradingSurfaces ? (
          <Link
            href="/dashboard/scanner?mode=day"
            prefetch={false}
            data-hover-prefetch="true"
            {...interactionLevelProps("deep")}
            onMouseEnter={dayScannerHoverPrefetch.onMouseEnter}
            onFocus={dayScannerHoverPrefetch.onFocus}
            onPointerDown={dayScannerHoverPrefetch.onPointerDown}
            className="inline-flex min-h-10 items-center text-sm font-semibold"
            style={{ color: colors.accent }}
          >
            Day scanner →
          </Link>
        ) : null}
      </nav>

      {dayTradingSurfaces ? (
        <SharedContextMasterCard {...sharedContextPayload} layout="strip" />
      ) : (
        <article data-testid="swing-desk-panel" style={{ margin: 0 }}>
          <SharedContextMasterCard {...sharedContextPayload} layout="embedded" />
        </article>
      )}

      <div
        data-testid="dashboard-next-actions"
        className={surfaceGlowClassName}
        style={{
          borderRadius: borderRadius.lg,
          border: `1px dashed color-mix(in srgb, ${colors.border} 80%, transparent)`,
          background: "rgba(148,163,184,0.04)",
          padding: spacing[3]
        }}
      >
        <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 600, color: colors.text }}>
          {desksActionable ? "Review firing rows on Scanner or Signals." : "No actionable setups right now."}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          <Link
            href="/dashboard/scanner?mode=swing"
            prefetch={false}
            data-hover-prefetch="true"
            {...interactionLevelProps("deep")}
            onMouseEnter={swingScannerHoverPrefetch.onMouseEnter}
            onFocus={swingScannerHoverPrefetch.onFocus}
            onPointerDown={swingScannerHoverPrefetch.onPointerDown}
            className="inline-flex min-h-10 items-center text-sm font-semibold"
            style={{ color: colors.accent }}
          >
            Open Scanner →
          </Link>
          <Link
            href="/dashboard/watchlists"
            prefetch={false}
            data-hover-prefetch="true"
            {...interactionLevelProps("deep")}
            onMouseEnter={watchlistHoverPrefetch.onMouseEnter}
            onFocus={watchlistHoverPrefetch.onFocus}
            onPointerDown={watchlistHoverPrefetch.onPointerDown}
            className="inline-flex min-h-10 items-center text-sm font-semibold"
            style={{ color: colors.accent }}
          >
            View Watchlist →
          </Link>
          <Link
            href="/dashboard/signals"
            prefetch={false}
            data-hover-prefetch="true"
            {...interactionLevelProps("medium")}
            onMouseEnter={signalsHubHoverPrefetch.onMouseEnter}
            onFocus={signalsHubHoverPrefetch.onFocus}
            onPointerDown={signalsHubHoverPrefetch.onPointerDown}
            className="inline-flex min-h-10 items-center text-sm font-semibold"
            style={{ color: colors.textMuted }}
          >
            Signals →
          </Link>
        </div>
      </div>

      <EarningsCalendar events={earningsEvents} title="Upcoming Earnings (Next 7 Days)" maxDays={7} />

      {deferredEarningsSlot}
      {deferredScannerSlot}
      <DashboardEdgeSync />
    </section>
  );
}
