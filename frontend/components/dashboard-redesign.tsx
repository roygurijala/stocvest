"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { DashboardCard } from "@/components/dashboard-card";
import { DashboardRealtime } from "@/components/dashboard-realtime";
import { DecisionMetric } from "@/components/decision-metric";
import { EarningsCalendar } from "@/components/earnings-calendar";
import { InfoTip } from "@/components/info-tip";
import { WeeklyMarketContextWidget, type WeeklyIndexRow } from "@/components/weekly-market-context-widget";
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
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { buildEvidenceFromSetup, enrichEvidenceWithRealComposite, type SignalEvidenceData } from "@/lib/signal-evidence";
import { tickerNewsTriggerLine } from "@/lib/api/ticker-news-panel";
import {
  CONFIDENCE_PERCENT_TIP,
  CONFLUENCE_COUNT_DECISION_TIP,
  GEO_WEIGHTED_EXPOSURE_TIP,
  LAST_PRICE_SIGNAL_CARD_TIP,
  MARKET_PULSE_CARD_TIP,
  PORTFOLIO_ACTIVE_CARD_TIP,
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
  SWING_REENABLE_CALLOUT_TIP,
  WATCHLIST_READINESS_TIP,
  UPCOMING_CATALYSTS_CARD_TIP,
  VIX_PULSE_NUMBER_TIP,
  WEEKLY_MARKET_CONTEXT_CARD_TIP
} from "@/lib/ui-tooltips";
import { buildDashboardSignalCardStrip } from "@/lib/dashboard-signal-card-strip";
import {
  buildAlignmentLadder,
  buildSwingReenableBullets,
  macroRiskStateHeadline,
  macroRiskStateTip,
  sectorTapeKindFromPct5d,
  watchlistReadinessLine
} from "@/lib/dashboard-posture";
import Link from "next/link";

export type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";

export type SectorRotationChip = { symbol: string; label: string; pct5d: number | null };

export type PortfolioActiveRow = {
  symbol: string;
  side: string;
  entry: number;
  last: number | null;
  pnlDollars: number | null;
};

interface DashboardRedesignProps {
  marketOverview: MarketOverview;
  scannerOverview: ScannerOverview;
  earningsEvents: EarningsEvent[];
  earningsRecent: EarningsEvent[];
  weeklyIndexRows: WeeklyIndexRow[];
  sectorRotation: SectorRotationChip[];
  portfolioActive: PortfolioActiveRow[];
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

/** Dashboard Top signals empty state: explains “no list” vs “broken API”. */
function emptySwingTopSignalsDiagnostic(regimeLabel: string, sectors: SectorRotationChip[]): string {
  const r = regimeLabel.trim().toLowerCase();
  let macro: string;
  if (r.includes("bear")) macro = "macro regime bearish";
  else if (r.includes("bull")) macro = "macro regime bullish";
  else macro = "macro regime neutral";

  const pcts = sectors.map((s) => s.pct5d).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  let sectorW: string;
  if (pcts.length === 0) {
    sectorW = "sector leadership unclear until rotation data fills in";
  } else {
    const up = pcts.filter((x) => x > 0.2).length;
    const down = pcts.filter((x) => x < -0.2).length;
    if (up >= 2 && down >= 2) sectorW = "sector leadership mixed";
    else if (down >= 3 && up <= 1) sectorW = "sector leadership defensive";
    else if (up >= 3 && down <= 1) sectorW = "sector leadership risk-on";
    else sectorW = "sector leadership narrow";
  }

  return `No swing setups — ${macro} and ${sectorW}.`;
}

function emptySwingTopSignalsChip(regimeLabel: string): { label: string; tip: string } {
  const r = regimeLabel.trim().toLowerCase();
  if (r.includes("bear")) {
    return {
      label: "Signal suppressed: Regime",
      tip: "Tape regime reads bearish; the swing desk stays idle until trend and structure meet the scanner’s rules."
    };
  }
  if (r.includes("bull")) {
    return {
      label: "Signal suppressed: Filters",
      tip: "Tape can be risk-on, but no symbol passed daily swing structure, volume, and momentum gates today."
    };
  }
  return {
    label: "Signal context: Neutral tape",
    tip: "Regime is neutral or mixed; swing rows only appear when price structure and weekly momentum align with the desk rules."
  };
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
        ? "Winners and losers both printed over the week while Regime is bearish and swing setups are quiet — classic non-confirmation: rotation under the surface without a clean tape bid."
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

/** Why VIX shows “—” on the dashboard tape (never silent). */
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
      <InfoTip text={tip} label="Why VIX is blank" maxWidth={320} />
    </span>
  );
}

export function DashboardRedesign({
  marketOverview,
  scannerOverview,
  earningsEvents,
  earningsRecent,
  weeklyIndexRows,
  sectorRotation,
  portfolioActive
}: DashboardRedesignProps) {
  const { colors } = useTheme();
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [newsPanelSymbol, setNewsPanelSymbol] = useState("");
  const [newsPanelOpen, setNewsPanelOpen] = useState(false);
  const [newsUiTick, setNewsUiTick] = useState(0);
  const [macroPulse, setMacroPulse] = useState<Awaited<ReturnType<typeof fetchMacroContext>>>(null);

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

  const emptySwingTeaching = useMemo(
    () => ({
      sentence: emptySwingTopSignalsDiagnostic(regimeLabel, sectorRotation),
      chip: emptySwingTopSignalsChip(regimeLabel)
    }),
    [regimeLabel, sectorRotation]
  );
  const sectorFrame = useMemo(
    () => sectorRotationFrame(regimeLabel, sectorRotation, weeklyIndexRows, swingTopSignals.length === 0),
    [regimeLabel, sectorRotation, weeklyIndexRows, swingTopSignals.length]
  );
  const sectorTapePoster = useMemo(
    () => sectorTapeKindFromPct5d(sectorRotation.map((s) => s.pct5d)),
    [sectorRotation]
  );
  const weeklyAvgPct5dVal = useMemo(() => weeklyIndexAvgPct5d(weeklyIndexRows), [weeklyIndexRows]);
  const swingReenableBullets = useMemo(
    () => buildSwingReenableBullets({ regimeLabel, sectorTape: sectorTapePoster, weeklyAvgPct5d: weeklyAvgPct5dVal }),
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
  const watchlistReadiness = useMemo(
    () =>
      watchlistReadinessLine({
        scannerError: scannerOverview.error,
        swingSetupCount: swingTopSignals.length,
        swingUniverseSymbolCount: scannerOverview.swingUniverseSymbolCount
      }),
    [scannerOverview.error, scannerOverview.swingUniverseSymbolCount, swingTopSignals.length]
  );
  const regimeChipCore = pulseRegimeColor(regimeLabel, colors);
  const regimeChipAccent = pulseRegimeBadgeColor(regimeLabel, colors);

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

  return (
    <section className="stocvest-dashboard-v2" style={{ display: "grid", gap: spacing[5] }}>
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
          <DashboardRealtime />
          <InfoTip text={SESSION_STATUS_STRIP_TIP} label="About the session status strip" maxWidth={300} />
        </div>
      </article>

      <div className="dashboard-grid grid grid-cols-1 gap-5 lg:grid-cols-[7fr_13fr] lg:items-stretch [&>*]:min-w-0">
          <div className="order-1 min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <DashboardCard
              eyebrow="Swing desk"
              title="Weekly market context"
              subtitle="SPY, QQQ, and IWM — last ~5 trading sessions (daily closes), not intraday tape."
              cardTip={WEEKLY_MARKET_CONTEXT_CARD_TIP}
            >
              <WeeklyMarketContextWidget
                rows={weeklyIndexRows}
                marketStatus={marketOverview.status}
                dataIssue={
                  weeklyIndexRows.every((r) => r.pct5d == null) && weeklyIndexRows.every((r) => r.lastPrice == null)
                    ? marketOverview.error || null
                    : null
                }
              />
            </DashboardCard>
          </div>

          <DashboardCard
            className={`order-2 flex w-full min-h-[200px] flex-col overflow-hidden lg:self-start lg:col-start-1 lg:row-start-2`}
            title="Top signals"
            eyebrow="Scanner"
            subtitle="Daily swing scanner only (no intraday session patterns on the dashboard). Open Evidence for the six-layer read, macro–sector–technical alignment, and levels."
            cardTip={TOP_SIGNALS_CARD_TIP}
          >
            <div className="flex flex-col gap-3">
              {topSignals.length === 0 ? (
                <div className="flex flex-col justify-center gap-3 py-4" style={{ padding: spacing[2] }}>
                  {scannerOverview.error ? (
                    <p style={{ margin: 0, color: colors.textMuted }}>{scannerOverview.error}</p>
                  ) : (
                    <>
                      <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.55 }}>
                        No active swing setups right now.
                      </p>
                      <p
                        style={{
                          margin: 0,
                          color: colors.text,
                          lineHeight: 1.55,
                          fontSize: typography.scale.sm,
                          fontWeight: 500
                        }}
                      >
                        {emptySwingTeaching.sentence}
                      </p>
                      <div className="inline-flex flex-wrap items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold tracking-wide"
                          style={{
                            border: `1px solid color-mix(in srgb, ${regimeChipCore} 38%, ${colors.border})`,
                            background: `color-mix(in srgb, ${regimeChipCore} 10%, transparent)`,
                            color: regimeChipAccent,
                            textTransform: "none"
                          }}
                        >
                          {emptySwingTeaching.chip.label}
                          <InfoTip text={emptySwingTeaching.chip.tip} label="Why the swing list can be empty" maxWidth={300} />
                        </span>
                      </div>
                      <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.55, fontSize: typography.scale.sm }}>
                        The daily scanner runs each morning and surfaces setups when conditions align across price structure,
                        volume, and weekly momentum.
                      </p>
                      <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.55, fontSize: typography.scale.sm }}>
                        Check back at market open or run the full Scanner for intraday lists and detail.
                      </p>
                      <Link
                        href="/dashboard/scanner"
                        className="inline-flex min-h-11 items-center font-semibold"
                        style={{ color: colors.accent, fontSize: typography.scale.sm }}
                      >
                        Open Scanner →
                      </Link>
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
                  className="grid w-full max-w-md gap-y-1 font-mono text-xs"
                  style={{ fontVariantNumeric: "tabular-nums", color: colors.text }}
                >
                  {alignmentLadder.map((row) => (
                    <div
                      key={row.key}
                      className="grid w-full gap-x-3"
                      style={{ gridTemplateColumns: "minmax(0,7.5rem) minmax(0,1fr)", alignItems: "baseline" }}
                    >
                      <span style={{ color: colors.textMuted }}>{row.label}</span>
                      <span style={{ color: colors.text, fontWeight: 600 }}>{row.state}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gap: spacing[1] }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
                    <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.textMuted }}>
                      Watchlist readiness
                    </span>
                    <InfoTip text={WATCHLIST_READINESS_TIP} label="What watchlist readiness means" maxWidth={300} />
                  </div>
                  <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.55 }}>
                    {watchlistReadiness}
                  </p>
                </div>
                <div style={{ display: "grid", gap: spacing[2] }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
                    <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.textMuted }}>
                      What would re-enable swing setups
                    </span>
                    <InfoTip text={SWING_REENABLE_CALLOUT_TIP} label="How these bullets are derived" maxWidth={320} />
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: spacing[4],
                      color: colors.text,
                      fontSize: typography.scale.sm,
                      lineHeight: 1.55,
                      display: "grid",
                      gap: spacing[2]
                    }}
                  >
                    {swingReenableBullets.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </DashboardCard>

          <div className="order-3 flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
          <DashboardCard
            className="flex min-h-[200px] flex-col overflow-hidden lg:self-start"
            eyebrow="Tape"
            title="Market pulse"
            subtitle="SPY · QQQ · VIX session change and regime — today’s tape versus your swing read. Numbers match the scanner when it completes; otherwise they come from your overview snapshots."
            cardTip={MARKET_PULSE_CARD_TIP}
          >
            <div className="flex flex-col gap-3 text-sm" style={{ color: colors.text }}>
              <div
                className="grid w-full grid-cols-1 gap-x-6 gap-y-2 text-left font-semibold sm:grid-cols-3"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <span className="min-w-0">
                  SPY{" "}
                  <span style={{ color: spyPct != null ? getChangeColor(spyPct, colors) : colors.textMuted }}>
                    {spyPct != null ? (
                      <DecisionMetric explanation={SPY_PULSE_NUMBER_TIP} label="How SPY change is used" maxWidth={280}>
                        <span>{`${spyPct >= 0 ? "+" : ""}${spyPct.toFixed(2)}%`}</span>
                      </DecisionMetric>
                    ) : (
                      "—"
                    )}
                  </span>
                </span>
                <span className="min-w-0">
                  QQQ{" "}
                  <span style={{ color: qqqPct != null ? getChangeColor(qqqPct, colors) : colors.textMuted }}>
                    {qqqPct != null ? (
                      <DecisionMetric explanation={QQQ_PULSE_NUMBER_TIP} label="How QQQ change is used" maxWidth={280}>
                        <span>{`${qqqPct >= 0 ? "+" : ""}${qqqPct.toFixed(2)}%`}</span>
                      </DecisionMetric>
                    ) : (
                      "—"
                    )}
                  </span>
                </span>
                <span className="min-w-0">
                  VIX{" "}
                  <span
                    className="inline-flex min-w-0 flex-wrap items-baseline gap-x-0.5 align-middle"
                    style={{ color: vixPct != null ? getChangeColor(vixPct, colors) : colors.textMuted }}
                  >
                    {vixPct != null ? (
                      <DecisionMetric explanation={VIX_PULSE_NUMBER_TIP} label="How VIX move is used" maxWidth={280}>
                        <span>{`${vixPct > 0.05 ? "▲" : vixPct < -0.05 ? "▼" : "→"} ${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(2)}%`}</span>
                      </DecisionMetric>
                    ) : vixSnapshot?.last_trade_price != null ? (
                      <DecisionMetric explanation={VIX_PULSE_NUMBER_TIP} label="How VIX level is used" maxWidth={280}>
                        <span>→ {Number(vixSnapshot.last_trade_price).toFixed(2)}</span>
                      </DecisionMetric>
                    ) : vixBlankKind ? (
                      <VixDashExplained kind={vixBlankKind} colors={colors} />
                    ) : (
                      "—"
                    )}
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2" style={{ fontSize: typography.scale.sm }}>
                <span style={{ color: colors.textMuted, fontWeight: 600 }}>Macro risk state</span>
                <strong style={{ color: colors.text }}>{macroRiskStateHeadline(macroPulse)}</strong>
                <InfoTip text={macroRiskStateTip(macroPulse)} label="What macro risk state means" maxWidth={320} />
              </div>
              {macroWarnings[0] ? (
                <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
                  {macroWarnings[0]}
                </p>
              ) : null}
              <DecisionMetric explanation={regimeBadgeExplanation} label="How regime label is used" maxWidth={320}>
                <div
                  className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide"
                  style={{
                    borderColor: `color-mix(in srgb, ${pulseRegimeColor(regimeLabel, colors)} 35%, ${colors.border})`,
                    background: "rgba(148,163,184,0.08)",
                    color: pulseRegimeBadgeColor(regimeLabel, colors)
                  }}
                >
                  Regime: {regimeLabel}
                  {regimeBadgePriceBreadthOnly ? (
                    <span style={{ fontWeight: 700, textTransform: "none", letterSpacing: "0.02em" }}>
                      {" "}
                      (price + breadth only)
                    </span>
                  ) : null}
                </div>
              </DecisionMetric>
              <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
                Session tape for context; swing thesis uses weekly panel + Evidence.
              </p>
            </div>
          </DashboardCard>

          <DashboardCard
            eyebrow="Sectors"
            title="Sector rotation (5 sessions)"
            subtitle="ETF buckets over ~5 trading sessions of daily closes — not today’s session % beside Regime."
            cardTip={SECTOR_ROTATION_CARD_TIP}
          >
            <div className="flex flex-col gap-3">
              <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.55 }}>
                <strong style={{ color: colors.text }}>When this is from:</strong> last ~5{" "}
                <strong style={{ color: colors.text }}>trading sessions</strong> of daily closes (same swing window as
                Weekly market context).{" "}
                <InfoTip text={SECTOR_FRAME_TIMING_TIP} label="How sector timing differs from Regime" maxWidth={320} />
              </p>
              {sectorFrame.narrative ? (
                <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.55, fontWeight: 500 }}>
                  {sectorFrame.narrative}
                </p>
              ) : null}
              {sectorFrame.chip && sectorFrame.chipKind ? (
                <div className="inline-flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold tracking-wide"
                    style={{
                      textTransform: "none",
                      letterSpacing: "0.02em",
                      ...sectorLeadershipChipColors(sectorFrame.chipKind, colors)
                    }}
                  >
                    {sectorFrame.chip.label}
                    <InfoTip text={sectorFrame.chip.tip} label="How to read leadership vs regime" maxWidth={320} />
                  </span>
                </div>
              ) : null}
            <div className="flex flex-wrap gap-2" style={{ fontSize: typography.scale.sm, fontVariantNumeric: "tabular-nums" }}>
              {sectorRotation.map((s) => (
                <span
                  key={s.symbol}
                  style={{
                    borderRadius: borderRadius.md,
                    border: `1px solid ${colors.border}`,
                    padding: `${spacing[1]} ${spacing[2]}`,
                    color: colors.text
                  }}
                >
                  <strong>{s.symbol}</strong>{" "}
                  <span style={{ color: s.pct5d != null ? getChangeColor(s.pct5d, colors) : colors.textMuted }}>
                    {s.pct5d != null ? `${s.pct5d >= 0 ? "+" : ""}${s.pct5d.toFixed(1)}%` : "—"}
                  </span>
                  <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}> · {s.label}</span>
                </span>
              ))}
            </div>
            </div>
          </DashboardCard>

          <DashboardCard
            eyebrow="Catalysts"
            title="Upcoming earnings this week"
            subtitle="Earnings on your dashboard symbol list only — macro prints (Fed, CPI, etc.) are not shown here."
            cardTip={UPCOMING_CATALYSTS_CARD_TIP}
          >
            {upcomingCatalystWeek.length === 0 ? (
              <div style={{ display: "grid", gap: spacing[2] }}>
                <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.55 }}>
                  No tracked earnings in this window.
                </p>
                <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.55 }}>
                  Macro economic events are not shown in this panel — absence of rows does not mean there is nothing on
                  the calendar.
                </p>
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: spacing[4], color: colors.text, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
                {upcomingCatalystWeek.map((e) => (
                  <li key={`${e.symbol}-${e.report_date}`}>
                    <strong>{e.symbol}</strong> · {earningsTimingLabel(e.report_time)} · {e.report_date.slice(5).replace("-", "/")}
                    {e.company_name ? (
                      <span style={{ color: colors.textMuted }}> — {e.company_name}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard
            eyebrow="Signal portfolio"
            title="Active positions"
            subtitle="Model book marks — not your brokerage."
            cardTip={PORTFOLIO_ACTIVE_CARD_TIP}
          >
            <div className="mb-2">
              <Link href="/portfolio" style={{ fontSize: typography.scale.xs, color: colors.accent, fontWeight: 600 }}>
                Open full portfolio →
              </Link>
            </div>
            {portfolioActive.length === 0 ? (
              <div style={{ display: "grid", gap: spacing[2] }}>
                <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.55 }}>
                  No open rows in the signal portfolio.
                </p>
                <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.55 }}>
                  This is the model book only — not your brokerage. An empty list means nothing is marked open here, not
                  that data failed to load.
                </p>
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: spacing[4], color: colors.text, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
                {portfolioActive.map((p) => {
                  const lastStr = p.last != null && Number.isFinite(p.last) ? `$${p.last.toFixed(2)}` : "—";
                  const pnlStr =
                    p.pnlDollars != null && Number.isFinite(p.pnlDollars)
                      ? `${p.pnlDollars >= 0 ? "+" : ""}$${Math.abs(p.pnlDollars).toFixed(0)}`
                      : null;
                  return (
                    <li key={`${p.symbol}-${p.entry}`}>
                      <strong>{p.symbol}</strong> {p.side} · Entry ${p.entry.toFixed(2)} · Now {lastStr}
                      {pnlStr ? <span style={{ color: p.pnlDollars! >= 0 ? colors.bullish : colors.bearish }}> · {pnlStr}</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </DashboardCard>
          </div>

          <EarningsCalendar
            className="order-4 lg:col-span-2 lg:col-start-1 lg:row-start-3"
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
    </section>
  );
}
