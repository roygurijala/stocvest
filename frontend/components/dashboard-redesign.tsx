"use client";

import { useEffect, useMemo, useState } from "react";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { motion } from "framer-motion";
import { DashboardActiveSignalRibbon } from "@/components/dashboard-active-signal-ribbon";
import { DashboardCard } from "@/components/dashboard-card";
import { DashboardEdgeSync } from "@/components/dashboard-edge-sync";
import { DashboardHeroStrip } from "@/components/dashboard-hero-strip";
import { DashboardRealtime } from "@/components/dashboard-realtime";
import { DecisionMetric } from "@/components/decision-metric";
import { SwingDeskSignature } from "@/components/desk-visual-signatures";
import { EarningsCalendar } from "@/components/earnings-calendar";
import { InfoTip } from "@/components/info-tip";
import { type WeeklyIndexRow } from "@/components/weekly-market-context-widget";
import { SharedContextMasterCard } from "@/components/shared-context-master-card";
import { DayDeskPanel } from "@/components/day-desk-panel";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { NewsPanel } from "@/components/news-panel";
import { getChangeColor } from "@/components/market-sentiment-score-widget";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchMacroContext } from "@/lib/api/fetch-macro-context";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { topSignalStrengthPercent } from "@/lib/top-signal-strength";
import type { MarketOverview, NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { IntradayGeoPreview, IntradaySetupPayload, ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import { earningsTimingLabel } from "@/lib/earnings-timing";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, cardSurfaceStyle, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";
import { buildEvidenceFromSetup, enrichEvidenceWithComposite, type SignalEvidenceData } from "@/lib/signal-evidence";
import { tickerNewsTriggerLine } from "@/lib/api/ticker-news-panel";
import {
  CONFIDENCE_PERCENT_TIP,
  CONFLUENCE_COUNT_DECISION_TIP,
  GEO_WEIGHTED_EXPOSURE_TIP,
  LAST_PRICE_SIGNAL_CARD_TIP,
  MARKET_PULSE_CARD_TIP,
  SIGNAL_VALIDATION_LEDGER_CARD_TIP,
  QQQ_PULSE_NUMBER_TIP,
  REGIME_BADGE_TIP,
  REGIME_WITHOUT_VIX_APPEND,
  VIX_BLANK_DATA_PENDING_TIP,
  VIX_BLANK_MARKET_CLOSED_TIP,
  VIX_BLANK_UPSTREAM_TIP,
  SECTOR_ROTATION_CARD_TIP,
  SESSION_STATUS_STRIP_TIP,
  SPY_PULSE_NUMBER_TIP,
  TOP_SIGNAL_ROW_CARD_TIP,
  TOP_SIGNALS_CARD_TIP,
  ALIGNMENT_LADDER_TIP,
  PRIMARY_READ_SWING_CONTEXT_TIP,
  SWING_REENABLE_CALLOUT_TIP,
  WATCHLIST_READINESS_DETAIL_INTRO,
  WATCHLIST_READINESS_TIP,
  UPCOMING_CATALYSTS_CARD_TIP,
  VIX_PULSE_NUMBER_TIP,
  WEEKLY_MARKET_CONTEXT_CARD_TIP
} from "@/lib/ui-tooltips";
import { buildDashboardSignalCardStrip } from "@/lib/dashboard-signal-card-strip";
import {
  buildAlignmentLadder,
  buildDayReenableBulletsShort,
  buildSwingReenableBulletsShort,
  dayDeskPostureKind,
  type DayDeskPostureKind,
  macroRiskStateHeadline,
  macroRiskStateTip,
  sectorTapeKindFromPct5d,
  watchlistReadinessLine,
  watchlistReadinessShortLine
} from "@/lib/dashboard-posture";
import Link from "next/link";

export type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";

export type SectorRotationChip = { symbol: string; label: string; pct5d: number | null };

interface DashboardRedesignProps {
  marketOverview: MarketOverview;
  scannerOverview: ScannerOverview;
  earningsEvents: EarningsEvent[];
  earningsRecent: EarningsEvent[];
  weeklyIndexRows: WeeklyIndexRow[];
  sectorRotation: SectorRotationChip[];
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
          Weighted exposure{" "}
          <DecisionMetric explanation={GEO_WEIGHTED_EXPOSURE_TIP} label="How weighted geo exposure is used" maxWidth={280}>
            <span>{scoreStr}</span>
          </DecisionMetric>
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

function findVixSnapshot(snapshots: SnapshotPayload[]): SnapshotPayload | undefined {
  const order = ["I:VIX", "^VIX", "VIX"];
  for (const k of order) {
    const hit = snapshots.find((x) => (x.symbol || "").toUpperCase() === k);
    if (hit) return hit;
  }
  return undefined;
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

/** True when the pulse can show a usable VIX session % or last index level (matches Market pulse row). */
function vixPulseDataAvailable(snapshot: SnapshotPayload | undefined, sessionPct: number | null): boolean {
  if (sessionPct != null && Number.isFinite(sessionPct)) return true;
  if (!snapshot) return false;
  const p = snapshot.last_trade_price;
  return typeof p === "number" && Number.isFinite(p);
}

function regimeLabelIsDirectional(regimeLabel: string): boolean {
  const r = regimeLabel.trim().toLowerCase();
  return r.includes("bear") || r.includes("bull");
}

/** Same thresholds as `frontend/lib/api/scanner.ts` regime label. */
function regimeFromSpyQqq(spyPct: number | null, qqqPct: number | null, fallback: string): string {
  if (spyPct != null && qqqPct != null) {
    if (spyPct > 0.2 && qqqPct > 0.15) return "Bullish";
    if (spyPct < -0.2 || qqqPct < -0.25) return "Bearish";
    return "Neutral";
  }
  return fallback;
}

function pulseRegimeColor(regime: string, colors: ThemeColors): string {
  const r = regime.trim().toLowerCase();
  if (r === "bullish") return colors.bullish;
  if (r === "bearish") return colors.bearish;
  return colors.caution;
}

/** Regime pill in Market pulse — slightly desaturated vs raw tape colors so it does not fight macro rails nearby. */
function pulseRegimeBadgeColor(regime: string, colors: ThemeColors): string {
  const raw = pulseRegimeColor(regime, colors);
  return `color-mix(in srgb, ${raw} 76%, ${colors.text})`;
}

/** Institutional one-liner for empty swing list — no tooltip (story lives in posture + ladder below). */
function emptySwingSuppressionStatusLine(regimeLabel: string): string {
  const r = regimeLabel.trim().toLowerCase();
  if (r.includes("bear")) return "Signal suppressed — regime not cleared";
  if (r.includes("bull")) return "Signal suppressed — filters not cleared";
  return "Signal suppressed — alignment not cleared";
}

function emptySwingPostureHeadline(): string {
  return "System posture: Waiting for alignment";
}

function emptySwingOneLiner(regimeLabel: string): string {
  const r = regimeLabel.trim().toLowerCase();
  if (r.includes("bear")) {
    return "Swing suppressed — risk-off tape; desk idle until structure aligns.";
  }
  if (r.includes("bull")) {
    return "Swing suppressed — symbol-level confirmations still missing on the daily scanner.";
  }
  return "Swing suppressed — neutral chop; tape clarity and per-symbol gates still apply.";
}

type SectorTapeTone = "defensive" | "risk_on" | "mixed" | "narrow" | "unknown";

function classifySectorTapeTone(sectors: SectorRotationChip[]): SectorTapeTone {
  const pcts = sectors.map((s) => s.pct5d).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (pcts.length === 0) return "unknown";
  const up = pcts.filter((x) => x > 0.2).length;
  const down = pcts.filter((x) => x < -0.2).length;
  if (up >= 2 && down >= 2) return "mixed";
  if (down >= 3 && up <= 1) return "defensive";
  if (up >= 3 && down <= 1) return "risk_on";
  return "narrow";
}

function weeklyIndexAvgPct5d(rows: WeeklyIndexRow[]): number | null {
  const vals = rows.map((r) => r.pct5d).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const SECTOR_FRAME_TIMING_TIP =
  "These percentages roll up the last ~5 trading sessions of daily closes on each ETF—the same swing-style window as Weekly market context. Market pulse Regime instead uses SPY/QQQ session change for today. A green sector chip does not cancel a bearish regime; it timestamps a different question.";

type SectorRotationFrame = {
  narrative: string | null;
  chip: { label: string; tip: string } | null;
  chipKind: "confirming" | "nonconfirming" | "mixed" | null;
};

function sectorRotationFrame(
  regimeLabel: string,
  sectors: SectorRotationChip[],
  weeklyRows: WeeklyIndexRow[],
  noSwingSetups: boolean
): SectorRotationFrame {
  const tone = classifySectorTapeTone(sectors);
  const r = regimeLabel.trim().toLowerCase();
  const bear = r.includes("bear");
  const bull = r.includes("bull");
  const wAvg = weeklyIndexAvgPct5d(weeklyRows);
  const baseTip =
    "Sector chips use ~5 sessions of ETF daily closes. Regime in Market pulse uses SPY/QQQ session change. They are different layers—divergence is expected when leadership rotates without benchmark follow-through.";

  if (tone === "unknown") {
    return { narrative: null, chip: null, chipKind: null };
  }

  let narrative: string | null = null;
  let chip: { label: string; tip: string } | null = null;
  let chipKind: SectorRotationFrame["chipKind"] = null;

  if (bear) {
    if (tone === "risk_on") {
      narrative =
        wAvg != null && wAvg < -0.25
          ? "Cyclical-led gains last week did not lift the cap-weighted tape on average — leadership rotation without index follow-through."
          : "Lopsided sector leadership to the upside while the session regime reads risk-off — often isolated bounce or late-cycle chop before benchmarks turn.";
      chip = {
        label: "Leadership: Non-confirming",
        tip: `${baseTip} Here, sector skew looks risk-on versus a bearish headline—does not imply the engine ignored the tape.`
      };
      chipKind = "nonconfirming";
    } else if (tone === "mixed") {
      narrative = noSwingSetups
        ? "Bearish regime with a mixed week — rotation under the surface without a clean tape bid (see Weekly context + Evidence for depth)."
        : "Winners and losers both printed over the week — choppy rotation under a bearish session regime. Sector gains here did not have to lift SPY/QQQ the same day you read Regime.";
      chip = {
        label: "Leadership: Mixed / fading",
        tip: `${baseTip} Mixed buckets mean money swaps groups without a broad thrust—pairs with selective scanners even when a few ETFs look strong.`
      };
      chipKind = "mixed";
    } else if (tone === "defensive") {
      narrative = "Sector skew over the week leans defensive — closer to what a bearish tape label implies.";
      chip = { label: "Leadership: Confirming", tip: `${baseTip} More sector buckets are weak than strong on this window.` };
      chipKind = "confirming";
    } else {
      narrative =
        "Narrow leadership last week — a few groups moved while breadth stayed thin. That can coexist with a bearish headline until indexes broaden.";
      chip = {
        label: "Leadership: Isolated",
        tip: `${baseTip} Narrow prints mean one or two themes drove the tape; watch whether SPY/QQQ catch up or mean-revert.`
      };
      chipKind = "mixed";
    }
  } else if (bull) {
    if (tone === "defensive") {
      narrative =
        "Session regime reads risk-on, but sector buckets over the week skew soft — leadership not fully backing the headline yet.";
      chip = {
        label: "Leadership: Non-confirming",
        tip: `${baseTip} Defensive skew versus a bullish regime often flags late-cycle chop or megacap-led tape.`
      };
      chipKind = "nonconfirming";
    } else if (tone === "mixed") {
      narrative = "Mixed week under the surface while tape reads bullish — rotation without a single clean leadership story.";
      chip = {
        label: "Leadership: Mixed",
        tip: `${baseTip} Use weekly indexes + Evidence when the story under the hood disagrees with the headline label.`
      };
      chipKind = "mixed";
    } else if (tone === "risk_on") {
      narrative = "Risk-on skew in sectors aligns with the headline regime on this window.";
      chip = { label: "Leadership: Confirming", tip: `${baseTip}` };
      chipKind = "confirming";
    } else {
      narrative = "Narrow leadership — watch whether cyclicals broaden or stall.";
      chip = { label: "Leadership: Narrow", tip: `${baseTip}` };
      chipKind = "mixed";
    }
  } else {
    if (tone === "mixed") {
      narrative = "Mixed sector impulses over the week sit naturally next to a neutral headline regime.";
      chip = { label: "Leadership: Mixed", tip: `${baseTip}` };
      chipKind = "mixed";
    } else if (tone === "risk_on" || tone === "defensive") {
      narrative =
        tone === "risk_on"
          ? "Cyclical skew on the week while headline regime is neutral — watch whether indexes adopt the same story."
          : "Defensive skew on the week while headline regime is neutral — hedging rotation without a decisive benchmark break.";
      chip = { label: "Leadership: Drift", tip: `${baseTip}` };
      chipKind = "mixed";
    } else {
      narrative = "Narrow sector moves — little conviction versus a neutral headline.";
      chip = { label: "Leadership: Narrow", tip: `${baseTip}` };
      chipKind = "mixed";
    }
  }

  return { narrative, chip, chipKind };
}

function sectorLeadershipChipColors(kind: NonNullable<SectorRotationFrame["chipKind"]>, colors: ThemeColors) {
  if (kind === "confirming") {
    return {
      border: `color-mix(in srgb, ${colors.bullish} 55%, ${colors.border})`,
      background: "rgba(34,197,94,0.10)",
      color: colors.bullish
    };
  }
  if (kind === "nonconfirming") {
    return {
      border: `color-mix(in srgb, ${colors.caution} 55%, ${colors.border})`,
      background: "rgba(245,158,11,0.12)",
      color: colors.caution
    };
  }
  return {
    border: `color-mix(in srgb, ${colors.textMuted} 45%, ${colors.border})`,
    background: "rgba(148,163,184,0.08)",
    color: colors.textMuted
  };
}

/** When VIX shows “—” on the dashboard tape (never silent). */
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

function VixDashExplained({ kind, colors }: { kind: VixBlankKind; colors: ThemeColors }) {
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

export function DashboardRedesign({
  marketOverview,
  scannerOverview,
  earningsEvents,
  earningsRecent,
  weeklyIndexRows,
  sectorRotation
}: DashboardRedesignProps) {
  const { colors } = useTheme();
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [newsPanelSymbol, setNewsPanelSymbol] = useState("");
  const [newsPanelOpen, setNewsPanelOpen] = useState(false);
  const [newsUiTick, setNewsUiTick] = useState(0);
  const [macroPulse, setMacroPulse] = useState<Awaited<ReturnType<typeof fetchMacroContext>>>(null);
  // Tier 1 → Layer 4: warm `/dashboard/scanner?mode=swing` only when
  // the user signals intent (hover / focus / pointer-down on the
  // footer link). The link still carries `prefetch={false}` so the
  // mount-time prefetch storm (Tier 1.A) stays disabled.
  const swingScannerHoverPrefetch = useHoverPrefetch("/dashboard/scanner?mode=swing");

  useEffect(() => {
    let cancelled = false;
    void fetchMacroContext().then((ctx) => {
      if (!cancelled) {
        setMacroPulse(ctx);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const snapshotsBySymbol = useMemo(
    () => new Map(marketOverview.snapshots.map((s) => [(s.symbol || "").toUpperCase(), s])),
    [marketOverview.snapshots]
  );
  const swingTopSignals = useMemo(
    () => scannerOverview.setups.filter((s) => s.scanner_mode === "swing_daily"),
    [scannerOverview.setups]
  );
  const topSignals = swingTopSignals.slice(0, 3);
  // Day Desk data partition — the OTHER half of the same scanner payload. Setups
  // whose `scanner_mode` is undefined or anything other than "swing_daily" are
  // intraday (ORB / VWAP / momentum / gap-with-catalyst). Mode Separation rule:
  // the two partitions never share a row, a score, or a verdict — they feed two
  // independent decision surfaces on the dashboard.
  const dayTopSignals = useMemo(
    () =>
      scannerOverview.setups.filter(
        (s) =>
          s.scanner_mode !== "swing_daily" &&
          typeof s.score === "number" &&
          Number.isFinite(s.score)
      ),
    [scannerOverview.setups]
  );
  const dayTopScore = useMemo(() => {
    let best: number | null = null;
    for (const s of dayTopSignals) {
      if (typeof s.score === "number" && Number.isFinite(s.score)) {
        if (best == null || s.score > best) best = s.score;
      }
    }
    return best;
  }, [dayTopSignals]);
  const vixSnapshot =
    findVixSnapshot(marketOverview.snapshots) ||
    snapshotsBySymbol.get("I:VIX") ||
    snapshotsBySymbol.get("VIX") ||
    snapshotsBySymbol.get("^VIX");
  const earningsBySymbol = useMemo(() => {
    const m = new Map<string, EarningsEvent>();
    for (const e of earningsRecent) {
      m.set(e.symbol.trim().toUpperCase(), e);
    }
    for (const e of earningsEvents) {
      m.set(e.symbol.trim().toUpperCase(), e);
    }
    return m;
  }, [earningsEvents, earningsRecent]);
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
  const vixPct = snapshotSessionChangePct(vixSnapshot);
  const vixPulseOk = vixPulseDataAvailable(vixSnapshot, vixPct);
  const vixBlankKind = resolveVixBlankKind(vixPulseOk, marketOverview.status, marketOverview.error, spyPct, qqqPct);
  const regimeBadgePriceBreadthOnly = !vixPulseOk && regimeLabelIsDirectional(regimeLabel);
  const regimeBadgeExplanation = useMemo(() => {
    if (vixPulseOk) return REGIME_BADGE_TIP;
    return `${REGIME_BADGE_TIP}${REGIME_WITHOUT_VIX_APPEND}`;
  }, [vixPulseOk]);

  // Day Desk posture for the assistant page-context. This is the input the LLM
  // routing's PRIORITY 3 (ambiguous question + both desks visible → structured
  // dual answer) reads on the dashboard. Posture is computed deterministically
  // from the same scanner data the Day Desk panel renders — there is no
  // separate posture computation that could drift from what the user sees.
  const dayDeskPosture: DayDeskPostureKind = useMemo(
    () =>
      dayDeskPostureKind({
        marketStatus: marketOverview.status,
        daySetupCount: dayTopSignals.length,
        daySetupTopScore: dayTopScore,
        scannerError: scannerOverview.error
      }),
    [marketOverview.status, dayTopSignals.length, dayTopScore, scannerOverview.error]
  );
  const swingDeskPosture: "active" | "monitor" | "suppressed" = useMemo(() => {
    if (scannerOverview.error) return "suppressed";
    if (swingTopSignals.length > 0) return "active";
    return "suppressed";
  }, [scannerOverview.error, swingTopSignals.length]);

  // Publish a qualitative summary of the home dashboard to the STOCVEST Assistant.
  // Dashboard is now a TWO-DESK surface (Mode Separation B28 Phase 1): the assistant
  // sees both `swing_desk_posture` and `day_desk_posture` side-by-side and must use
  // the Priority 3 STRUCTURED DUAL ANSWER template when an ambiguous question lands
  // here. `trading_mode` is deliberately OMITTED so the LLM does not inherit a
  // single mode via Priority 1 — the dashboard is the canonical multi-mode surface.
  usePublishAssistantContext({
    page: "dashboard",
    market_regime: regimeLabel,
    ranked_setups_count: topSignals.length,
    swing_desk_posture: swingDeskPosture,
    day_desk_posture: dayDeskPosture,
    day_setups_count: dayTopSignals.length
  });

  const emptySwingSuppressionLine = useMemo(() => emptySwingSuppressionStatusLine(regimeLabel), [regimeLabel]);
  const sectorFrame = useMemo(
    () => sectorRotationFrame(regimeLabel, sectorRotation, weeklyIndexRows, swingTopSignals.length === 0),
    [regimeLabel, sectorRotation, weeklyIndexRows, swingTopSignals.length]
  );
  const sectorTapePoster = useMemo(
    () => sectorTapeKindFromPct5d(sectorRotation.map((s) => s.pct5d)),
    [sectorRotation]
  );
  const weeklyAvgPct5dVal = useMemo(() => weeklyIndexAvgPct5d(weeklyIndexRows), [weeklyIndexRows]);
  const swingReenableBulletsShort = useMemo(
    () => buildSwingReenableBulletsShort({ regimeLabel, sectorTape: sectorTapePoster, weeklyAvgPct5d: weeklyAvgPct5dVal }),
    [regimeLabel, sectorTapePoster, weeklyAvgPct5dVal]
  );
  const alignmentLadder = useMemo(
    () =>
      buildAlignmentLadder({
        macro: macroPulse,
        regimeLabel,
        regimePriceBreadthOnly: regimeBadgePriceBreadthOnly,
        sectorTape: sectorTapePoster,
        sectorChipKind: sectorFrame.chipKind,
        weeklyAvgPct5d: weeklyAvgPct5dVal,
        swingSetupCount: swingTopSignals.length,
        scannerError: scannerOverview.error
      }),
    [
      macroPulse,
      regimeLabel,
      regimeBadgePriceBreadthOnly,
      sectorTapePoster,
      sectorFrame.chipKind,
      weeklyAvgPct5dVal,
      swingTopSignals.length,
      scannerOverview.error
    ]
  );
  const watchlistReadinessOpts = useMemo(
    () => ({
      scannerError: scannerOverview.error,
      swingSetupCount: swingTopSignals.length,
      swingUniverseSymbolCount: scannerOverview.swingUniverseSymbolCount
    }),
    [scannerOverview.error, scannerOverview.swingUniverseSymbolCount, swingTopSignals.length]
  );
  const watchlistReadinessShort = useMemo(() => watchlistReadinessShortLine(watchlistReadinessOpts), [watchlistReadinessOpts]);
  const watchlistReadinessFull = useMemo(() => watchlistReadinessLine(watchlistReadinessOpts), [watchlistReadinessOpts]);
  const newsLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of swingTopSignals.slice(0, 3)) {
      m.set(s.symbol.trim().toUpperCase(), tickerNewsTriggerLine(s.symbol, 120));
    }
    return m;
  }, [swingTopSignals, newsUiTick]);

  const upcomingCatalystWeek = useMemo(
    () => [...earningsEvents].sort((a, b) => a.report_date.localeCompare(b.report_date)).slice(0, 10),
    [earningsEvents]
  );

  const macroWarnings = macroPulse?.warnings ?? [];

  // Hero strip absorbs Sections B / C-summary / D-summary / E of the Shared
  // Context master card into a one-row "glance" surface above the master
  // cards. The four cells share their classifiers with Shared Context
  // (classifyVolatility / classifyParticipation / classifyRiskHorizon)
  // so the two surfaces can NEVER drift — they are projections of the
  // same derivation. The hero strip carries NO `data-card-role`, so the
  // dashboard "exactly 3 master cards" invariant is preserved.
  const vixBlankTagForHero = vixBlankKind
    ? vixBlankKind === "market_closed"
      ? "(market closed)"
      : vixBlankKind === "data_pending"
        ? "(data pending)"
        : "(unavailable)"
    : null;

  return (
    <section className="stocvest-dashboard-v2" style={{ display: "grid", gap: spacing[8] }}>
      <article
        style={{
          borderBottom: `1px solid color-mix(in srgb, ${colors.border} 80%, ${colors.accent} 20%)`,
          paddingBottom: spacing[4],
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: spacing[3],
          background: `linear-gradient(90deg, color-mix(in srgb, ${colors.accent} 5%, transparent) 0%, transparent 55%)`
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
              ) : marketOverview.error ? (
                <span style={{ color: colors.caution }} title={marketOverview.error}>
                  unavailable
                </span>
              ) : (
                <SkeletonLine width="64px" />
              )}
            </span>
            <span style={{ color: colors.textMuted }} className="inline-flex items-center gap-1">
              <strong style={{ color: colors.text }}>VIX</strong>
              {vixPulseOk && vixSnapshot && toPrice(vixSnapshot.last_trade_price) ? (
                <span>{toPrice(vixSnapshot.last_trade_price)}</span>
              ) : vixPct != null ? (
                <span>{`${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(2)}%`}</span>
              ) : vixBlankKind ? (
                <VixDashExplained kind={vixBlankKind} colors={colors} />
              ) : (
                <span>—</span>
              )}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <InfoTip text={SESSION_STATUS_STRIP_TIP} label="About the session status strip" maxWidth={300} />
        </div>
      </article>

      {/*
       * HERO STRIP — Phase A1 of the dashboard redesign. Sits above the
       * three master cards and provides a one-row glance answer to
       * "what's the market doing right now?". It is a PROJECTION of the
       * Shared Context master card's data (uses the same classifiers),
       * not a new source of truth. Strictly environment-only — no
       * swing-/day-coded language, no rankings, no cross-mode score.
       * The realtime WS pulse dot is promoted into the regime cell so
       * users see live-data state without scanning the top of the page.
       */}
      <DashboardHeroStrip
        regimeLabel={regimeLabel}
        vixPulseOk={vixPulseOk}
        regimeBadgePriceBreadthOnly={regimeBadgePriceBreadthOnly}
        vixSnapshot={vixSnapshot}
        vixSessionPct={vixPct}
        sectorRotation={sectorRotation}
        weeklyIndexRows={weeklyIndexRows}
        upcomingEarnings={upcomingCatalystWeek}
        macroWarningHeadline={macroWarnings[0] ?? null}
        vixBlankTag={vixBlankTagForHero}
      />

      {/* Phase 2b layout — three master cards STACKED full-width, equal visual weight.
          (1) SHARED CONTEXT master card absorbs the four previous shared cards
              (Short-Horizon Market State, Market Pulse, Sector Rotation, Upcoming
              Earnings) as sub-sections A-E. Nothing else lives at the same
              hierarchy level — per the user directive: "No shared context
              scattered elsewhere. This creates a mental model users can learn
              once."
          (2) SWING DESK master card — multi-day decision engine.
          (3) DAY DESK master card — intraday decision engine.
          The Signal Validation Ledger is rendered BELOW the three master cards
          as a low-prominence tertiary link surface (it is tracked outcomes,
          not market context, so it cannot live inside Shared Context; it is
          also not a decision engine, so it cannot be a peer master card). */}
      <div className="dashboard-stack grid grid-cols-1 gap-7 [&>*]:min-w-0">
          {/*
           * SHARED CONTEXT — full-width regardless of viewport.
           * Phase A2 made this card collapsible by default, so it
           * presents a slim summary line + chevron most of the time
           * and only opens to the full A–E ladder on demand. Anchoring
           * the dashboard with the context surface before the desks
           * preserves the "read environment first, then act" reading
           * flow that the Mode Separation prompt encodes.
           */}
          <SharedContextMasterCard
            weeklyIndexRows={weeklyIndexRows}
            marketStatus={marketOverview.status}
            vixSnapshot={vixSnapshot}
            vixSessionPct={vixPct}
            sectorRotation={sectorRotation}
            upcomingEarnings={upcomingCatalystWeek}
            macroWarningHeadline={macroWarnings[0] ?? null}
            dataIssue={
              weeklyIndexRows.every((r) => r.pct5d == null) && weeklyIndexRows.every((r) => r.lastPrice == null)
                ? marketOverview.error || null
                : null
            }
          />

          {/*
           * Phase C — ACTIVE SIGNAL RIBBON. Surfaces the top firing
           * signals from BOTH desks as a single horizontal scroll
           * strip; on empty it folds into a thoughtful "watching N
           * tickers" line. The ribbon DOES NOT cross-mode rank —
           * it interleaves swing and day to give equal visual weight
           * to both engines. Mode Separation discipline preserved.
           */}
          <DashboardActiveSignalRibbon
            swingSignals={swingTopSignals.slice(0, 4)}
            daySignals={dayTopSignals.slice(0, 4)}
            emptyContext={{
              swingUniverseSymbolCount: scannerOverview.swingUniverseSymbolCount ?? null,
              scannerError: scannerOverview.error
            }}
          />

          {/*
           * Phase B1 — DECISION-DESK GRID. The two decision engines
           * now sit side-by-side on `lg+` (≥1024px) and stack on
           * narrower viewports. DOM order is preserved (Swing first,
           * Day second) so the existing
           * `day_desk_follows_swing_desk_in_dom_order_stacked` test
           * stays green: `compareDocumentPosition` is DOM-order
           * dependent, not CSS-order dependent. The grid uses
           * `items-stretch` so both cards reach the same height
           * regardless of which one has a longer empty-state block.
           */}
          <div
            data-testid="dashboard-desks-grid"
            className="dashboard-desks-grid grid grid-cols-1 items-stretch gap-7 lg:grid-cols-2 [&>*]:min-w-0"
          >
          <DashboardCard
            role="swing"
            className={`flex h-full w-full min-h-[200px] flex-col overflow-hidden`}
            title="Swing Desk"
            eyebrow="Multi-day · evaluated on daily closes"
            subtitle="Multi-day engine — evaluates daily closes. Independent of the Day Desk. Posture (Active / Monitor / Suppressed) reflects regime + sector + structure + per-symbol DailyBarScanner gates."
            cardTip={TOP_SIGNALS_CARD_TIP}
            headerRight={<SwingDeskSignature />}
            data-testid="swing-desk-panel"
            data-swing-desk-posture={swingDeskPosture}
          >
            <div className="flex flex-col gap-3">
              {topSignals.length === 0 ? (
                <div className="flex flex-col justify-center gap-4 py-2" style={{ padding: spacing[1] }}>
                  {scannerOverview.error ? (
                    <p style={{ margin: 0, color: colors.textMuted }}>{scannerOverview.error}</p>
                  ) : (
                    <>
                      <p
                        style={{
                          margin: 0,
                          color: colors.textMuted,
                          lineHeight: 1.5,
                          fontSize: typography.scale.sm,
                          fontWeight: 400,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: spacing[2]
                        }}
                      >
                        {/* Phase D — subtle "still scanning" pulse next to the
                            empty-state line. Communicates that the engine is
                            actively watching, not stuck. Honors
                            prefers-reduced-motion via globals.css. */}
                        <span
                          aria-hidden
                          className="stocvest-pulse-dot"
                          style={{ background: colors.textMuted }}
                        />
                        No active swing setups right now — engine still scanning.
                      </p>
                      {/*
                       * "Primary read" card — the swing desk's dominant
                       * decision surface when no setups are firing. Shell
                       * delegates to {@link cardSurfaceStyle} so it shares
                       * the canonical visual contract with every other card
                       * in the app; the swing role is anchored by the parent
                       * Swing Desk panel's 4px borderLeft accent + role
                       * pill, so this child card doesn't need to repeat the
                       * role hue.
                       *
                       * Phase 2c shipped a 1.5px violet border + 6% gradient
                       * here; that loud treatment was retired when the user
                       * asked for uniform look-and-feel across the app.
                       */}
                      <motion.div
                        key={`${regimeLabel}-${emptySwingSuppressionLine}`}
                        initial={{ opacity: 0.88, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.38, ease: "easeOut" }}
                        data-testid="swing-desk-primary-read-card"
                        style={{
                          borderRadius: borderRadius.lg,
                          ...cardSurfaceStyle(colors, "neutral"),
                          padding: spacing[4],
                          display: "grid",
                          gap: spacing[3]
                        }}
                      >
                        <div className="inline-flex flex-wrap items-center gap-2">
                          <p
                            style={{
                              margin: 0,
                              fontSize: 10,
                              letterSpacing: "0.18em",
                              textTransform: "uppercase",
                              fontWeight: 600,
                              color: colors.textMuted
                            }}
                          >
                            Primary read
                          </p>
                          <InfoTip
                            text={PRIMARY_READ_SWING_CONTEXT_TIP}
                            label="What this primary read means"
                            maxWidth={340}
                          />
                        </div>
                        <p style={{ margin: 0, fontSize: typography.scale.base, fontWeight: 600, color: colors.text, lineHeight: 1.35 }}>
                          {emptySwingPostureHeadline()}
                        </p>
                        <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 500, color: colors.textMuted, lineHeight: 1.5 }}>
                          {emptySwingOneLiner(regimeLabel)}
                        </p>
                        <p
                          style={{
                            margin: 0,
                            fontSize: typography.scale.sm,
                            fontWeight: 500,
                            color: colors.textMuted,
                            lineHeight: 1.45,
                            letterSpacing: "0.02em"
                          }}
                        >
                          {emptySwingSuppressionLine}
                        </p>
                      </motion.div>
                      <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.5, fontSize: typography.scale.xs, fontWeight: 400 }}>
                        Scanner runs each morning; full lists and intraday work live on Scanner.
                      </p>
                      {/*
                       * The redundant inline `Open Scanner ->` CTA used
                       * to live here, but the persistent footer link
                       * `View swing scanner ->` (rendered just below
                       * this card, outside the empty-state branch) now
                       * carries the exact same destination
                       * (`/dashboard/scanner?mode=swing`). Keeping both
                       * gave the empty state two near-identical CTAs
                       * stacked vertically; the footer wins because
                       * it's also visible when the desk is populated,
                       * so users see one consistent affordance.
                       */}
                    </>
                  )}
                </div>
              ) : (
                topSignals.map((signal, idx) => {
                  const snapRow = snapshotsBySymbol.get(signal.symbol.trim().toUpperCase());
                  const strip = buildDashboardSignalCardStrip(signal, snapRow, {
                    upcoming: earningsEvents,
                    recent: earningsRecent
                  });
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
                      position: "relative",
                      background: `linear-gradient(160deg, color-mix(in srgb, ${colors.accent} 6%, ${colors.surfaceMuted}) 0%, ${colors.surfaceMuted} 100%)`,
                      border: `1px solid color-mix(in srgb, ${colors.border} 88%, ${colors.accent} 12%)`,
                      borderRadius: borderRadius.lg,
                      padding: spacing[3],
                      paddingTop: `calc(${spacing[3]} + 4px)`,
                      paddingRight: `calc(${spacing[3]} + 28px)`
                    }}
                  >
                    <div style={{ position: "absolute", top: spacing[2], right: spacing[2], zIndex: 1 }}>
                      <InfoTip text={TOP_SIGNAL_ROW_CARD_TIP} label="About this signal row" maxWidth={300} />
                    </div>
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
                          {/*
                           * Phase B+ — "Multi-day" pill, symmetric to the
                           * Day Desk's "Intraday" tag. Reinforces mode
                           * language at a glance so two rows with the
                           * same symbol on the two desks read as clearly
                           * different machines. Color = neutral muted
                           * (NOT the role accent) so the pill works as
                           * a label, not a verdict.
                           */}
                          <span
                            data-testid="swing-row-multiday-tag"
                            style={{
                              background: "rgba(148,163,184,0.14)",
                              color: colors.textMuted,
                              borderRadius: borderRadius.full,
                              padding: "2px 8px",
                              fontSize: typography.scale.xs,
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em"
                            }}
                            title="Multi-day swing setup; cadence differs from the Day Desk."
                          >
                            Multi-day
                          </span>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <DecisionMetric explanation={CONFIDENCE_PERCENT_TIP} label="How signal strength is used" maxWidth={300}>
                            <span style={{ color: colors.text, fontSize: typography.scale.sm, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                              {topSignalStrengthPercent(signal)}%
                            </span>
                          </DecisionMetric>
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
                          Last{" "}
                          <DecisionMetric explanation={LAST_PRICE_SIGNAL_CARD_TIP} label="How last price is used" maxWidth={280}>
                            <span style={{ color: colors.text, fontWeight: 600 }}>${signal.last_price.toFixed(2)}</span>
                          </DecisionMetric>
                        </p>
                      ) : null}
                      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.45, fontWeight: 600 }}>
                        {strip.patternLine}
                      </p>
                      {strip.swingDailyDetailLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
                          {strip.swingDailyDetailLine}
                        </p>
                      ) : null}
                      {strip.entryZoneLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.text, fontVariantNumeric: "tabular-nums" }}>
                          {strip.entryZoneLine}
                        </p>
                      ) : null}
                      {strip.stopTargetLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
                          {strip.stopTargetLine}
                        </p>
                      ) : null}
                      {strip.maturityLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>{strip.maturityLine}</p>
                      ) : null}
                      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.45 }}>
                        <strong>Catalyst:</strong> {strip.catalystLine}
                      </p>
                      {signal.geo_preview ? <TopSignalGeoStrip preview={signal.geo_preview} colors={colors} /> : null}
                      {tier || nConf != null || nConfl != null ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
                          {tier ? (
                            <>
                              <span style={{ textTransform: "capitalize", color: colors.text }}>{tier}</span> confluence
                            </>
                          ) : (
                            <span style={{ color: colors.text }}>Confluence</span>
                          )}
                          {nConf != null || (nConfl != null && nConfl > 0) ? (
                            <>
                              {" "}
                              <DecisionMetric explanation={CONFLUENCE_COUNT_DECISION_TIP} label="How confluence counts are used" maxWidth={300}>
                                <span style={{ color: colors.textMuted }}>
                                  {nConf != null ? <>· {nConf} aligning</> : null}
                                  {nConfl != null && nConfl > 0 ? (
                                    <>
                                      {" "}
                                      · {nConfl} conflict{nConfl === 1 ? "" : "s"}
                                    </>
                                  ) : null}
                                </span>
                              </DecisionMetric>
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
                              symbolNewsArticles = await fetchSymbolNews(signal.symbol, 10, {
                                newsTradingMode: "swing"
                              });
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
                            setEvidence(await enrichEvidenceWithComposite(base, "swing"));
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
              <div
                style={{
                  borderTop: `1px solid ${colors.border}`,
                  paddingTop: spacing[3],
                  marginTop: spacing[1],
                  display: "grid",
                  gap: spacing[3]
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
                  <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.textMuted }}>
                    Alignment (system posture)
                  </span>
                  <InfoTip text={ALIGNMENT_LADDER_TIP} label="How to read the alignment ladder" maxWidth={300} />
                </div>
                <div
                  className="grid w-full max-w-md gap-y-2 font-mono text-xs"
                  style={{ fontVariantNumeric: "tabular-nums", color: colors.text }}
                >
                  {alignmentLadder.map((row) => {
                    const emphasis = row.key === "regime" || row.key === "setups";
                    return (
                      <div
                        key={row.key}
                        className="grid w-full gap-x-3"
                        style={{ gridTemplateColumns: "minmax(0,7.5rem) minmax(0,1fr)", alignItems: "baseline" }}
                      >
                        <span style={{ color: colors.textMuted, fontWeight: 400 }}>{row.label}</span>
                        <span style={{ color: colors.text, fontWeight: emphasis ? 700 : 500 }}>{row.state}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "grid", gap: spacing[1] }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
                    <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.textMuted }}>
                      Watchlist readiness
                    </span>
                    <InfoTip text={WATCHLIST_READINESS_TIP} label="What watchlist readiness means" maxWidth={300} />
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: typography.scale.sm,
                      color: colors.textMuted,
                      lineHeight: 1.55,
                      fontWeight: 400
                    }}
                    className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1"
                  >
                    <span style={{ color: colors.text, fontWeight: 500 }}>{watchlistReadinessShort}</span>
                    <InfoTip
                      text={`${WATCHLIST_READINESS_DETAIL_INTRO}\n\n${watchlistReadinessFull}`}
                      label="Watchlist readiness — full criteria"
                      maxWidth={320}
                    />
                  </p>
                </div>
                <div style={{ display: "grid", gap: spacing[2] }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
                    <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.textMuted }}>
                      What would re-enable swing setups
                    </span>
                    <InfoTip
                      text={`${SWING_REENABLE_CALLOUT_TIP}\n\n${swingReenableBulletsShort.map((b) => `• ${b}`).join("\n")}`}
                      label="What would bring swing rows back"
                      maxWidth={340}
                    />
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: spacing[4],
                      color: colors.textMuted,
                      fontSize: typography.scale.sm,
                      lineHeight: 1.55,
                      fontWeight: 400,
                      display: "grid",
                      gap: spacing[2]
                    }}
                  >
                    {swingReenableBulletsShort.map((b, idx) => (
                      <li key={idx} style={{ color: colors.text }}>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/*
               * Swing Desk footer — symmetric to the Day Desk's
               * "View day scanner →" link. Always rendered (regardless
               * of empty / populated state) so the path to the full
               * swing scanner is one click away no matter what the
               * desk is showing. The link carries `?mode=swing` so the
               * scanner page's URL-priority mode resolver lands the
               * user on the Swing tab every time (the matching fix
               * for "View day scanner takes me to swing scanner").
               */}
              <div
                data-testid="swing-desk-scanner-footer"
                style={{
                  borderTop: `1px solid ${colors.border}`,
                  paddingTop: spacing[3],
                  marginTop: spacing[1]
                }}
              >
                {/* Perf invariant — see docs/PERFORMANCE.md §3.1.
                    `/dashboard/scanner` is a heavy SSR page. The
                    desk footer is rendered on every dashboard
                    mount, so the default `prefetch="auto"` would
                    fire a full scanner SSR prefetch up to two more
                    times here (once for swing, again from the Day
                    Desk for day). `prefetch={false}` removes the
                    speculative drain; clicking still routes
                    normally. */}
                <Link
                  href="/dashboard/scanner?mode=swing"
                  prefetch={false}
                  data-hover-prefetch="true"
                  onMouseEnter={swingScannerHoverPrefetch.onMouseEnter}
                  onFocus={swingScannerHoverPrefetch.onFocus}
                  onPointerDown={swingScannerHoverPrefetch.onPointerDown}
                  className="inline-flex min-h-11 items-center font-semibold"
                  style={{ color: colors.accent, fontSize: typography.scale.sm }}
                >
                  View swing scanner →
                </Link>
              </div>
            </div>
          </DashboardCard>

          {/* Day Desk — third master card. On `lg+` it sits to the
              right of the Swing Desk inside the desks grid above; on
              narrower viewports it stacks below. Equal visual weight
              regardless of either desk's posture. Mode Separation
              B28: posture, signals (or suppression copy), re-enable
              language, and footer link are all owned by the day-side
              helpers in lib/dashboard-posture.ts; no swing-side
              state flows in. */}
          <DayDeskPanel
            setups={scannerOverview.setups}
            marketStatus={marketOverview.status}
            scannerError={scannerOverview.error}
          />
          </div>
          {/* /Phase B1 desks grid */}

          {/* Phase 2c — the Signal Validation Ledger has been MOVED off the
              dashboard and onto the Performance page. Tracked outcomes describe
              "did past signals work?" — that's a performance question, not a
              market-environment question, so per the user's directive ("a data
              element belongs in Shared Context if and only if it answers what
              kind of market environment are all traders operating in right
              now") it no longer belongs on this surface at all. The link from
              the dashboard chrome (sidebar / nav) still reaches the full ledger
              at /dashboard/signal-validation. */}

          <EarningsCalendar
            events={earningsEvents}
            title="Upcoming Earnings (Next 7 Days)"
            maxDays={7}
          />
      </div>

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
        newsTradingMode="swing"
        onClose={() => {
          setNewsPanelOpen(false);
          setNewsUiTick((t) => t + 1);
        }}
        onLoaded={() => setNewsUiTick((t) => t + 1)}
      />
      <DashboardEdgeSync />
    </section>
  );
}
