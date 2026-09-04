"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { BarChart3, CalendarClock, Compass, Eye, LineChart, Newspaper, Target } from "lucide-react";
import { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { regimeTone } from "@/lib/market-context/regime";
import {
  buildRegimeWhyLine,
  buildRegimeWhyTooltip,
  regimeWhyEmphasize
} from "@/lib/market-context/regime-why-present";
import { InfoTip } from "@/components/info-tip";
import {
  briefNoSetupLabel,
  briefSessionSubtitle,
  isPreparationPhase,
  type BriefSessionPhase
} from "@/lib/dashboard/trading-room/brief-session-copy";
import type { WatchlistAtCloseItem } from "@/lib/hooks/use-watchlist-at-close";
import type { FeedCard, FeedLane, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import {
  buildSectorDeskRows,
  buildSectorRepresentativeRows,
  feedStateLabel,
  getRepresentativeSymbolsForEtf,
  sectorMomentumTradingNote,
  type SectorDeskRow,
  type SectorSnapshotQuote
} from "@/lib/dashboard/trading-room/market-brief-navigation";
import { FeedCardUpdatedLine } from "@/lib/dashboard/trading-room/feed-card-present";
import type { DeskTodayData } from "@/lib/api/desk-today";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import type { ScannerNearQualificationRow } from "@/lib/scanner-scan-summary";
import { MarketSwingSetupsTable } from "@/components/dashboard/personal-ranked-home-table";
import { MarketBriefSymbolLink } from "@/components/dashboard/trading-room/market-brief-symbol-link";

const BRIEF_NAME_STORAGE_KEY = "stocvest:brief-name";
const SWING_ACCENT = "#8B5CF6";

export interface BriefHeadline {
  id: string;
  title: string;
  source: string | null;
  ageLabel: string | null;
  sentiment: "bullish" | "bearish" | "neutral";
  url: string | null;
  /** Plain-English market impact line from the news feed. */
  impact: string | null;
}

export interface BriefSector {
  /** Sector ETF symbol, e.g. XLF. */
  symbol: string;
  label: string;
  /** Primary value shown (1-day when the tape is shut, 5-day average while open). */
  pct: number;
  /** 1-day move, when available. */
  pct1d?: number | null;
  /** 5-day average move, when available. */
  pct5d?: number | null;
}

export interface BriefMover {
  symbol: string;
  company: string | null;
  changePct: number;
  lane: FeedLane;
}

export interface BriefWeekEvent {
  /** Event name, e.g. "CPI data". */
  label: string;
  /** When it lands, e.g. "Tue 8:30 AM ET". */
  when: string;
  /** 0–3 importance; high-importance events are emphasized. */
  importance: number;
}

/** Setup follow-through recap — framed as "alignment held", never a trade win rate. */
export interface BriefOutcomesRecap {
  windowDays: number;
  totalEvents: number;
  buildingDataset: boolean;
  alignmentHeldRate: number | null;
  continuationRate: number | null;
  disclaimer: string;
}

export interface BriefWeekInReview {
  bestSector: { label: string; pct5d: number } | null;
  worstSector: { label: string; pct5d: number } | null;
}

export interface MarketBriefData {
  /** Optional first name for the greeting ("Good morning, Roy."). */
  userName?: string | null;
  /** Whether the regular session is currently open. Null when unknown. */
  marketOpen: boolean | null;
  /** Short status chip text, e.g. "Market open", "Market closed". */
  marketStatusLabel: string;
  regimeLabel: string;
  /** Backend macro bucket: risk_on | neutral | risk_off | avoid. */
  marketRegime?: string | null;
  /** Weighted macro score (0–100) behind `marketRegime`. */
  macroScore?: number | null;
  /** One-line deterministic read on how the tape is acting. */
  sessionNarrative: string | null;
  /** AI-written multi-sentence market narrative (preferred when present). */
  aiNarrative: string | null;
  spyPct: number | null;
  qqqPct: number | null;
  iwmPct: number | null;
  vixLevel: number | null;
  vixPct: number | null;
  /** Optional breadth line, e.g. "Breadth positive · advancers lead 3:1". Omitted when unavailable. */
  breadthLine: string | null;
  /** Sector ETF performance, sorted best → worst. */
  sectors: BriefSector[];
  /** Window the sector numbers cover, e.g. "today" or "past week". */
  sectorWindowLabel: string;
  /** Notable movers among tracked names. */
  movers: { up: BriefMover[]; down: BriefMover[] };
  /** Top market headlines (broad-tape proxy). */
  headlines: BriefHeadline[];
  counts: Record<FeedState, number>;
  topCard: FeedCard | null;
  /** Single "what to watch" line (macro event or next earnings). */
  watchLine: string | null;
  watchDetail: string | null;
  /** ISO timestamp of the freshest source feeding the brief. */
  updatedAtIso: string | null;
  /** Resolved session phase — drives lead line, CTA copy, and preparation blocks. */
  sessionPhase: BriefSessionPhase;
  /** Macro / earnings events in the days ahead (weekend / after-hours prep). */
  weekAhead: BriefWeekEvent[];
  /** Closing snapshot of the user's watchlist (weekend / after-hours prep). */
  watchlistAtClose: WatchlistAtCloseItem[];
  /** Best/worst sector over the trailing week (weekend / after-hours prep). */
  weekInReview: BriefWeekInReview | null;
  /** Setup follow-through recap (weekend / after-hours prep). */
  outcomesRecap: BriefOutcomesRecap | null;
  /** Top swing card to highlight in the prep brief (weekend / after-hours). */
  topSwingCard?: FeedCard | null;
  /** Total count of swing signals currently in the feed. */
  swingCardCount?: number;
  /** Human-readable date label for the swing data, e.g. "Fri Jun 6" when serving stale cache. */
  swingDataDate?: string | null;
}

interface MarketBriefProps {
  data: MarketBriefData;
  onViewTopSetup: () => void;
  onSearch?: () => void;
  swingDesk?: DeskTodayData | null;
  swingSetups?: readonly IntradaySetupPayload[];
  nearQualification?: readonly ScannerNearQualificationRow[];
  /** Opens in-panel Deep Dive for a symbol (movers, watchlist, sector names, swing table). */
  onSelectSymbol?: (symbol: string, company?: string | null, lane?: FeedLane) => void;
  /** Tracked feed cards — used to populate sector desk lists. */
  trackedCards?: readonly FeedCard[];
}

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(
      new Date()
    )
  );
  if (Number.isFinite(hour)) {
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }
  return "Welcome";
}

function todayEt(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date());
}

function relativeFrom(iso: string | null): string | null {
  if (!iso?.trim()) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `Updated ${hrs}h ago`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function MarketBrief({
  data,
  onViewTopSetup,
  onSearch,
  swingDesk = null,
  swingSetups = [],
  nearQualification = [],
  onSelectSymbol,
  trackedCards = []
}: MarketBriefProps) {
  const { theme, colors } = useTheme();
  const [selectedSectorEtf, setSelectedSectorEtf] = useState<string | null>(null);
  const sectorPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedSectorEtf || !sectorPanelRef.current) return;
    sectorPanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedSectorEtf]);
  const updated = relativeFrom(data.updatedAtIso);
  const top = data.topCard;
  const topActionable = data.counts.actionable > 0;
  const tone = regimeTone(data.regimeLabel, colors);

  const sectionLabel = (text: string) => (
    <span
      style={{
        fontSize: typography.scale.xs,
        color: colors.textMuted,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        fontWeight: 600
      }}
    >
      {text}
    </span>
  );

  // Session-aware lead line: live read when open, recap when closed, prep on weekends.
  const sessionLead = briefSessionSubtitle(data.sessionPhase);
  const showPrep = isPreparationPhase(data.sessionPhase);
  const noSetupLabel = briefNoSetupLabel(data.sessionPhase);
  const regimeWhyInput = {
    regimeLabel: data.regimeLabel,
    marketRegime: data.marketRegime,
    macroScore: data.macroScore,
    spyPct: data.spyPct,
    qqqPct: data.qqqPct,
    vixLevel: data.vixLevel,
    vixPct: data.vixPct
  };
  const regimeWhyLine = buildRegimeWhyLine(regimeWhyInput);
  const regimeWhyTip = buildRegimeWhyTooltip(regimeWhyInput);
  const emphasizeRegimeWhy = regimeWhyEmphasize(regimeWhyInput);

  const dotFor = (s: BriefHeadline["sentiment"]) =>
    s === "bullish" ? colors.bullish : s === "bearish" ? colors.bearish : colors.textMuted;

  // Bento tile: a recessed panel with a thin colored top-accent + icon header.
  // Gives the brief visual rhythm and fills the width without fragmenting the
  // narrative into a stack of heavy, identical cards.
  const tileBg = theme === "dark" ? "rgba(255,255,255,0.022)" : "rgba(2,6,23,0.022)";
  const tile = (
    icon: ReactNode,
    label: string | null,
    accent: string,
    children: ReactNode,
    opts?: { span?: boolean }
  ) => (
    <section
      style={{
        background: tileBg,
        border: `1px solid ${colors.border}`,
        borderTop: `2px solid ${accent}`,
        borderRadius: borderRadius.md,
        padding: spacing[4],
        display: "flex",
        flexDirection: "column",
        gap: spacing[2],
        gridColumn: opts?.span ? "1 / -1" : undefined
      }}
    >
      {label ? (
        <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
          <span style={{ color: accent, display: "inline-flex", flex: "none" }}>{icon}</span>
          {sectionLabel(label)}
        </div>
      ) : null}
      {children}
    </section>
  );

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: spacing[6],
        display: "flex",
        flexDirection: "column",
        gap: spacing[4]
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: spacing[4] }}>
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
          <GreetingHeading fallbackName={data.userName ?? null} colors={colors} />
          <MarketStatusChip open={data.marketOpen} label={data.marketStatusLabel} colors={colors} />
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>{todayEt()}</span>
          {updated ? (
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{updated}</span>
          ) : null}
        </div>
      </div>

      {/* Pulse hero — the lead story. Tinted in the regime color with a bold
          headline so the market read clearly outranks the supporting modules. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: spacing[2],
          borderLeft: `4px solid ${tone.fg}`,
          borderRadius: borderRadius.md,
          padding: `${spacing[4]} ${spacing[5]}`,
          background: `linear-gradient(105deg, ${tone.bg}, transparent 72%)`
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: spacing[3] }}>
          {sectionLabel("Market pulse")}
          {updated ? (
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, whiteSpace: "nowrap" }}>{updated}</span>
          ) : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
          <span style={{ fontSize: typography.scale.xl, fontWeight: 700, lineHeight: 1.25 }}>
            <span style={{ color: tone.fg }}>{data.regimeLabel} regime</span>
            <span style={{ color: colors.textMuted, fontWeight: 400 }}> · </span>
            <span style={{ fontWeight: 600 }}>{sessionLead}</span>
          </span>
          <InfoTip text={regimeWhyTip} label="Why this regime" maxWidth={360} />
        </div>
        {regimeWhyLine ? (
          <p
            data-testid="market-brief-regime-why"
            className="m-0 text-xs leading-relaxed"
            style={{
              color: emphasizeRegimeWhy ? colors.caution : colors.textMuted,
              fontWeight: emphasizeRegimeWhy ? 600 : 400
            }}
          >
            {regimeWhyLine}
          </p>
        ) : null}
        {data.aiNarrative ? (
          <span style={{ fontSize: typography.scale.base, color: colors.text, lineHeight: 1.6 }}>
            {data.aiNarrative}
          </span>
        ) : data.sessionNarrative ? (
          <span style={{ fontSize: typography.scale.base, color: colors.text, lineHeight: 1.55 }}>
            {data.sessionNarrative}
          </span>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[1] }}>
          <IndexChip label="SPY" pct={data.spyPct} colors={colors} onSelect={onSelectSymbol ? () => onSelectSymbol("SPY", null, "swing") : undefined} />
          <IndexChip label="QQQ" pct={data.qqqPct} colors={colors} onSelect={onSelectSymbol ? () => onSelectSymbol("QQQ", null, "swing") : undefined} />
          <IndexChip label="IWM" pct={data.iwmPct} colors={colors} onSelect={onSelectSymbol ? () => onSelectSymbol("IWM", null, "swing") : undefined} />
          <VixChip level={data.vixLevel} pct={data.vixPct} colors={colors} />
        </div>
        {data.breadthLine ? (
          <span style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>{data.breadthLine}</span>
        ) : null}
      </div>

      {onSelectSymbol
        ? tile(
            <Target size={15} />,
            "Swing setups from market scan",
            SWING_ACCENT,
            <MarketSwingSetupsTable
              swingDesk={swingDesk}
              swingSetups={swingSetups}
              nearQualification={nearQualification}
              onSelectSymbol={(sym) => onSelectSymbol(sym, null, "swing")}
              colors={colors}
              embedded
            />,
            { span: true }
          )
        : null}

      <div className="brief-bento" style={{ gap: spacing[3], alignItems: "start" }}>
        {/* Weekend / after-hours swing highlight — shown when swing data is active during prep.
            Turns Saturday into an actionable preparation surface by surfacing the best swing
            setup so the trader can review the scenario before Monday's open. */}
        {showPrep && data.topSwingCard
          ? tile(
              <Compass size={15} />,
              `Swing setups active · ${data.swingCardCount ?? 1} signal${(data.swingCardCount ?? 1) !== 1 ? "s" : ""}${data.swingDataDate ? ` from ${data.swingDataDate}` : ""}`,
              "#c04cf5",
              <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
                <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: spacing[2] }}>
                    {onSelectSymbol ? (
                      <BriefSymbolButton
                        symbol={data.topSwingCard.symbol}
                        onClick={() => onSelectSymbol(data.topSwingCard!.symbol, data.topSwingCard!.company, "swing")}
                        colors={colors}
                        style={{ fontSize: typography.scale.lg, fontWeight: 700 }}
                      />
                    ) : (
                      <span style={{ fontSize: typography.scale.lg, fontWeight: 700 }}>{data.topSwingCard.symbol}</span>
                    )}
                    <span style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
                      {data.topSwingCard.price != null ? `$${data.topSwingCard.price.toFixed(2)}` : ""}
                    </span>
                  </div>
                  {data.topSwingCard.company ? (
                    <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                      {data.topSwingCard.company}
                    </span>
                  ) : null}
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: typography.scale.xs,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: data.topSwingCard.bias === "bull" ? colors.bullish : data.topSwingCard.bias === "bear" ? colors.bearish : colors.textMuted,
                      background: data.topSwingCard.bias === "bull" ? `${colors.bullish}1f` : data.topSwingCard.bias === "bear" ? `${colors.bearish}1f` : `${colors.textMuted}1f`,
                      padding: "2px 8px",
                      borderRadius: 999,
                      alignSelf: "flex-start"
                    }}
                  >
                    {data.topSwingCard.bias === "bull" ? "Bullish" : data.topSwingCard.bias === "bear" ? "Bearish" : "Neutral"}
                    {" · "}{data.topSwingCard.state.charAt(0).toUpperCase() + data.topSwingCard.state.slice(1)}
                  </span>
                  <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.45 }}>
                    {data.topSwingCard.verdict}
                  </span>
                  <FeedCardUpdatedLine iso={data.topSwingCard.lastEvaluatedAt} colors={colors} />
                </div>
                <button
                  type="button"
                  onClick={onViewTopSetup}
                  style={{
                    border: "none",
                    background: "#c04cf5",
                    color: "#fff",
                    fontSize: typography.scale.sm,
                    fontWeight: 600,
                    padding: `${spacing[2]} ${spacing[4]}`,
                    borderRadius: borderRadius.md,
                    cursor: "pointer",
                    alignSelf: "flex-start"
                  }}
                >
                  Review scenario before open →
                </button>
                {data.swingDataDate ? (
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                    Signals carried from {data.swingDataDate} · valid through weekend
                  </span>
                ) : null}
              </div>,
              { span: true }
            )
          : null}

        {data.headlines.length > 0
          ? tile(
              <Newspaper size={15} />,
              data.marketOpen ? "Moving the tape" : "Today's headlines",
              colors.accent,
              <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
                {data.headlines.map((h) => (
                  <Headline key={h.id} item={h} dot={dotFor(h.sentiment)} colors={colors} />
                ))}
              </div>,
              { span: true }
            )
          : null}

        {data.sectors.length > 0
          ? tile(
              <LineChart size={15} />,
              `Sector performance · ${data.sectorWindowLabel === "today" ? "1-day" : "5-day average"}`,
              colors.accent,
              <>
                <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, opacity: 0.85, marginTop: -2 }}>
                  Tap a sector for representative names, desk setups, and a trading read. Each chip shows 1-day and 5-day moves.
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
                  {data.sectors.map((s) => (
                    <SectorChip
                      key={s.symbol}
                      sector={s}
                      colors={colors}
                      selected={selectedSectorEtf === s.symbol}
                      interactive={Boolean(onSelectSymbol)}
                      onClick={() => {
                        if (!onSelectSymbol) return;
                        setSelectedSectorEtf((prev) => (prev === s.symbol ? null : s.symbol));
                      }}
                    />
                  ))}
                </div>
                {selectedSectorEtf && onSelectSymbol ? (
                  <SectorDeskPanel
                    panelRef={sectorPanelRef}
                    sector={data.sectors.find((s) => s.symbol === selectedSectorEtf) ?? null}
                    rows={buildSectorDeskRows(trackedCards, selectedSectorEtf)}
                    colors={colors}
                    onSelectSymbol={onSelectSymbol}
                  />
                ) : null}
              </>
            )
          : null}

        {data.movers.up.length > 0 || data.movers.down.length > 0
          ? tile(
              <BarChart3 size={15} />,
              "Notable movers on the desk",
              colors.bullish,
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: spacing[3] }}>
                <MoverColumn
                  title="Leading"
                  movers={data.movers.up}
                  positive
                  colors={colors}
                  onSelectSymbol={onSelectSymbol}
                />
                <MoverColumn
                  title="Lagging"
                  movers={data.movers.down}
                  positive={false}
                  colors={colors}
                  onSelectSymbol={onSelectSymbol}
                />
              </div>
            )
          : null}

        {showPrep && data.weekInReview && (data.weekInReview.bestSector || data.weekInReview.worstSector)
          ? tile(
              <BarChart3 size={15} />,
              "Week in review",
              colors.bullish,
              <span style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
                {data.weekInReview.bestSector ? (
                  <>
                    Leading: <span style={{ color: colors.text, fontWeight: 600 }}>{data.weekInReview.bestSector.label}</span>{" "}
                    <span style={{ color: colors.bullish, fontWeight: 600 }}>{fmtPct(data.weekInReview.bestSector.pct5d)}</span>
                  </>
                ) : null}
                {data.weekInReview.bestSector && data.weekInReview.worstSector ? " · " : null}
                {data.weekInReview.worstSector ? (
                  <>
                    Lagging: <span style={{ color: colors.text, fontWeight: 600 }}>{data.weekInReview.worstSector.label}</span>{" "}
                    <span style={{ color: colors.bearish, fontWeight: 600 }}>{fmtPct(data.weekInReview.worstSector.pct5d)}</span>
                  </>
                ) : null}
              </span>
            )
          : null}

        {showPrep && data.watchlistAtClose.length > 0
          ? tile(
              <Eye size={15} />,
              "Your watchlist at close",
              colors.accent,
              <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
                {data.watchlistAtClose.slice(0, 6).map((w) => {
                  const rowTone = w.changePct == null ? colors.textMuted : w.changePct >= 0 ? colors.bullish : colors.bearish;
                  if (onSelectSymbol) {
                    return (
                      <MarketBriefSymbolLink
                        key={w.symbol}
                        symbol={w.symbol}
                        lane="swing"
                        onSelect={onSelectSymbol}
                        data-testid={`market-brief-watchlist-row-${w.symbol}`}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: spacing[2],
                          width: "100%",
                          padding: `${spacing[1]} ${spacing[2]}`,
                          margin: `0 -${spacing[2]}`,
                          borderRadius: borderRadius.sm,
                          cursor: "pointer"
                        }}
                        className="market-brief-row-link"
                      >
                        <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.accent, width: 56, flexShrink: 0, fontFamily: typography.fontFamilyMono }}>
                          {w.symbol}
                        </span>
                        <span style={{ fontSize: typography.scale.sm, color: colors.text, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                          {w.price != null ? `$${w.price.toFixed(2)}` : "—"}
                        </span>
                        <span style={{ fontSize: typography.scale.sm, color: rowTone, flexShrink: 0, width: 64, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {fmtPct(w.changePct)}
                        </span>
                        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {w.stateLabel}
                        </span>
                      </MarketBriefSymbolLink>
                    );
                  }
                  return (
                    <div key={w.symbol} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: spacing[2] }}>
                      <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.text, width: 56, flexShrink: 0 }}>
                        {w.symbol}
                      </span>
                      <span style={{ fontSize: typography.scale.sm, color: colors.text, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                        {w.price != null ? `$${w.price.toFixed(2)}` : "—"}
                      </span>
                      <span style={{ fontSize: typography.scale.sm, color: rowTone, flexShrink: 0, width: 64, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {fmtPct(w.changePct)}
                      </span>
                      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {w.stateLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            )
          : null}

        {showPrep && data.outcomesRecap
          ? tile(
              <Target size={15} />,
              `Setup follow-through · your watchlist · last ${data.outcomesRecap.windowDays} sessions`,
              colors.textMuted,
              <OutcomesRecap recap={data.outcomesRecap} colors={colors} />
            )
          : null}

        {showPrep && data.weekAhead.length > 0
          ? tile(
              <CalendarClock size={15} />,
              "Looking ahead",
              colors.caution,
              <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
                {data.weekAhead.map((e, i) => (
                  <div key={`${e.label}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: spacing[2] }}>
                    <span
                      style={{
                        fontSize: typography.scale.sm,
                        color: colors.text,
                        fontWeight: e.importance >= 2 ? 600 : 400,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {e.label}
                    </span>
                    <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, flexShrink: 0 }}>{e.when}</span>
                  </div>
                ))}
              </div>
            )
          : null}

        {data.watchLine && !(showPrep && data.weekAhead.length > 0)
          ? tile(
              <Compass size={15} />,
              "What to watch",
              colors.caution,
              <>
                <span style={{ fontSize: typography.scale.base, fontWeight: 600 }}>{data.watchLine}</span>
                {data.watchDetail ? (
                  <span style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>→ {data.watchDetail}</span>
                ) : null}
              </>
            )
          : null}
      </div>

      <div style={{ display: "flex", gap: spacing[3], flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onViewTopSetup}
          disabled={!top}
          style={{
            border: `1px solid ${colors.accent}`,
            background: top ? colors.accent : "transparent",
            color: top ? "#fff" : colors.textMuted,
            fontSize: typography.scale.sm,
            fontWeight: 600,
            padding: `${spacing[2]} ${spacing[4]}`,
            borderRadius: borderRadius.md,
            cursor: top ? "pointer" : "not-allowed"
          }}
        >
          {topActionable ? "View top setup →" : top ? "View closest setup →" : noSetupLabel}
        </button>
        {onSearch ? (
          <button
            type="button"
            onClick={onSearch}
            style={{
              border: `1px solid ${colors.border}`,
              background: "transparent",
              color: colors.text,
              fontSize: typography.scale.sm,
              fontWeight: 600,
              padding: `${spacing[2]} ${spacing[4]}`,
              borderRadius: borderRadius.md,
              cursor: "pointer"
            }}
          >
            Search any symbol
          </button>
        ) : null}
      </div>
    </div>
  );
}

function GreetingHeading({
  fallbackName,
  colors
}: {
  fallbackName: string | null;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const [name, setName] = useState<string | null>(fallbackName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Local override survives refresh and is instant (no backend round-trip).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(BRIEF_NAME_STORAGE_KEY);
      if (saved && saved.trim()) setName(saved.trim());
    } catch {
      /* ignore storage access errors */
    }
  }, []);

  const commit = () => {
    const value = draft.trim();
    setName(value || null);
    try {
      if (value) window.localStorage.setItem(BRIEF_NAME_STORAGE_KEY, value);
      else window.localStorage.removeItem(BRIEF_NAME_STORAGE_KEY);
    } catch {
      /* ignore storage access errors */
    }
    // Best-effort cross-device persistence; local storage already covers this device.
    void fetch("/api/stocvest/users/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ first_name: value || null })
    }).catch(() => {
      /* backend may not have the field yet (pre-deploy) — local storage still applies */
    });
    setEditing(false);
  };

  const headingStyle = { margin: 0, fontSize: typography.scale["2xl"], fontWeight: 700 } as const;

  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}>
        <h2 style={headingStyle}>{greeting()},</h2>
        <input
          value={draft}
          autoFocus
          placeholder="your name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          style={{
            fontSize: typography.scale.lg,
            fontWeight: 700,
            padding: `${spacing[1]} ${spacing[2]}`,
            borderRadius: borderRadius.sm,
            border: `1px solid ${colors.accent}`,
            background: colors.surfaceMuted,
            color: colors.text,
            width: 160
          }}
        />
      </div>
    );
  }

  return (
    <h2 style={{ ...headingStyle, display: "inline-flex", alignItems: "center", gap: spacing[2] }}>
      <span>
        {greeting()}
        {name ? `, ${name}` : ""}.
      </span>
      <button
        type="button"
        title={name ? "Edit your name" : "Add your name"}
        onClick={() => {
          setDraft(name ?? "");
          setEditing(true);
        }}
        style={{
          border: "none",
          background: "transparent",
          color: colors.textMuted,
          cursor: "pointer",
          fontSize: typography.scale.sm,
          padding: 2,
          lineHeight: 1
        }}
      >
        {name ? "✎" : "+ name"}
      </button>
    </h2>
  );
}

function MarketStatusChip({
  open,
  label,
  colors
}: {
  open: boolean | null;
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const tone = open === true ? colors.bullish : open === false ? colors.textMuted : colors.caution;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[2],
        alignSelf: "flex-start",
        fontSize: typography.scale.xs,
        fontWeight: 600,
        color: tone,
        background: `${tone}1f`,
        padding: "3px 10px",
        borderRadius: borderRadius.full
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: tone,
          boxShadow: open ? `0 0 0 3px ${tone}33` : "none"
        }}
      />
      {label}
    </span>
  );
}

function IndexChip({
  label,
  pct,
  colors,
  onSelect
}: {
  label: string;
  pct: number | null;
  colors: ReturnType<typeof useTheme>["colors"];
  onSelect?: () => void;
}) {
  const tone = pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
  const body = (
    <>
      <span style={{ color: colors.textMuted, fontWeight: 600 }}>{label}</span>
      <span style={{ color: tone, fontWeight: 700 }}>{fmtPct(pct)}</span>
    </>
  );
  const style = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: spacing[1],
    fontSize: typography.scale.sm,
    padding: `${spacing[1]} ${spacing[2]}`,
    borderRadius: borderRadius.md,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceMuted
  };
  if (onSelect) {
    return (
      <button
        type="button"
        data-testid={`market-brief-index-${label}`}
        onClick={onSelect}
        style={{ ...style, cursor: "pointer", color: "inherit" }}
      >
        {body}
      </button>
    );
  }
  return <span style={style}>{body}</span>;
}

function VixChip({
  level,
  pct,
  colors
}: {
  level: number | null;
  pct: number | null;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  if (level == null) return null;
  // VIX up = fear rising (bearish tone), down = calming.
  const tone = pct == null ? colors.textMuted : pct > 0 ? colors.bearish : colors.bullish;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: spacing[1],
        fontSize: typography.scale.sm,
        padding: `${spacing[1]} ${spacing[2]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <span style={{ color: colors.textMuted, fontWeight: 600 }}>VIX</span>
      <span style={{ color: colors.text, fontWeight: 700 }}>{level.toFixed(1)}</span>
      {pct != null ? <span style={{ color: tone, fontWeight: 600 }}>{fmtPct(pct)}</span> : null}
    </span>
  );
}

function SectorChip({
  sector,
  colors,
  selected = false,
  interactive = false,
  onClick
}: {
  sector: BriefSector;
  colors: ReturnType<typeof useTheme>["colors"];
  selected?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}) {
  const tone = sector.pct >= 0 ? colors.bullish : colors.bearish;
  const has1d = sector.pct1d != null;
  const has5d = sector.pct5d != null;
  const toneFor = (n: number | null | undefined) =>
    n == null ? colors.textMuted : n >= 0 ? colors.bullish : colors.bearish;
  const body = (
    <>
      <span style={{ color: colors.text, fontWeight: 600 }}>{sector.label}</span>
      {has1d || has5d ? (
        <span style={{ display: "inline-flex", gap: spacing[2], fontSize: typography.scale.xs }}>
          {has1d ? (
            <span style={{ color: colors.textMuted }}>
              1d <span style={{ color: toneFor(sector.pct1d), fontWeight: 700 }}>{fmtPct(sector.pct1d!)}</span>
            </span>
          ) : null}
          {has5d ? (
            <span style={{ color: colors.textMuted }}>
              5d <span style={{ color: toneFor(sector.pct5d), fontWeight: 700 }}>{fmtPct(sector.pct5d!)}</span>
            </span>
          ) : null}
        </span>
      ) : (
        <span style={{ color: tone, fontWeight: 700, fontSize: typography.scale.xs }}>{fmtPct(sector.pct)}</span>
      )}
    </>
  );
  const style = {
    display: "inline-flex",
    flexDirection: "column" as const,
    gap: 1,
    fontSize: typography.scale.sm,
    padding: `${spacing[1]} ${spacing[2]}`,
    borderRadius: borderRadius.md,
    border: `1px solid ${selected ? tone : `${tone}55`}`,
    background: selected ? `${tone}28` : `${tone}14`,
    cursor: interactive ? "pointer" : undefined,
    textAlign: "left" as const
  };
  if (interactive) {
    return (
      <button
        type="button"
        data-testid={`market-brief-sector-${sector.symbol}`}
        aria-pressed={selected}
        onClick={onClick}
        style={{ ...style, color: "inherit" }}
      >
        {body}
      </button>
    );
  }
  return <span style={style}>{body}</span>;
}

function SectorDeskPanel({
  panelRef,
  sector,
  rows,
  colors,
  onSelectSymbol
}: {
  panelRef?: RefObject<HTMLDivElement>;
  sector: BriefSector | null;
  rows: SectorDeskRow[];
  colors: ReturnType<typeof useTheme>["colors"];
  onSelectSymbol: (symbol: string, company?: string | null, lane?: FeedLane) => void;
}) {
  const [snapshots, setSnapshots] = useState<Map<string, SectorSnapshotQuote>>(new Map());
  const [quotesLoading, setQuotesLoading] = useState(false);

  const sectorEtf = sector?.symbol ?? null;
  const representativeSymbols = useMemo(
    () => (sectorEtf ? getRepresentativeSymbolsForEtf(sectorEtf) : []),
    [sectorEtf]
  );

  useEffect(() => {
    if (!sectorEtf || representativeSymbols.length === 0) {
      setSnapshots(new Map());
      setQuotesLoading(false);
      return;
    }
    let cancelled = false;
    setQuotesLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/market/snapshots?symbols=${encodeURIComponent(representativeSymbols.join(","))}`,
          { cache: "no-store" }
        );
        const body = (await res.json().catch(() => ({}))) as { snapshots?: SectorSnapshotQuote[] };
        const map = new Map<string, SectorSnapshotQuote>();
        for (const row of body.snapshots ?? []) {
          const sym = String((row as { symbol?: string }).symbol ?? "")
            .trim()
            .toUpperCase();
          if (sym) map.set(sym, row);
        }
        if (!cancelled) setSnapshots(map);
      } catch {
        if (!cancelled) setSnapshots(new Map());
      } finally {
        if (!cancelled) setQuotesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sectorEtf, representativeSymbols]);

  const representativeRows = useMemo(
    () => (sectorEtf ? buildSectorRepresentativeRows(sectorEtf, snapshots) : []),
    [sectorEtf, snapshots]
  );

  if (!sector) return null;
  const note = sectorMomentumTradingNote(sector);

  const sectionHeading = (text: string) => (
    <span
      style={{
        fontSize: typography.scale.xs,
        color: colors.textMuted,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600
      }}
    >
      {text}
    </span>
  );

  return (
    <div
      ref={panelRef}
      data-testid={`market-brief-sector-panel-${sector.symbol}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[2],
        marginTop: spacing[1],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.accent}66`,
        background: colors.surfaceMuted,
        boxShadow: `0 0 0 1px ${colors.accent}22`
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
        <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>
          {sector.label} ({sector.symbol})
        </span>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>{note}</span>
      </div>

      {representativeRows.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
          {sectionHeading("Sector names")}
          {representativeRows.map((row) => {
            const moveTone =
              row.changePct == null ? colors.textMuted : row.changePct >= 0 ? colors.bullish : colors.bearish;
            return (
              <MarketBriefSymbolLink
                key={`rep:${row.symbol}`}
                symbol={row.symbol}
                company={row.company}
                lane="swing"
                onSelect={onSelectSymbol}
                data-testid={`market-brief-sector-rep-${row.symbol}`}
                className="market-brief-row-link"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(3.5rem, auto) minmax(0, 1fr) minmax(3.5rem, auto)",
                  gap: spacing[2],
                  alignItems: "baseline",
                  width: "100%",
                  padding: `${spacing[1]} ${spacing[2]}`,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.sm,
                  background: colors.surface,
                  color: colors.text,
                  cursor: "pointer"
                }}
              >
                <span style={{ fontWeight: 700, fontFamily: typography.fontFamilyMono }}>{row.symbol}</span>
                <span
                  style={{
                    fontSize: typography.scale.xs,
                    color: colors.textMuted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {row.company ?? "Representative name"}
                </span>
                <span style={{ fontSize: typography.scale.sm, color: moveTone, fontWeight: 600, textAlign: "right" }}>
                  {quotesLoading && row.changePct == null ? "…" : fmtPct(row.changePct)}
                </span>
              </MarketBriefSymbolLink>
            );
          })}
        </div>
      ) : (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          No curated sector names for {sector.label} yet.
        </span>
      )}

      {rows.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
          {sectionHeading("On your desk")}
          {rows.slice(0, 8).map((row) => {
            const moveTone =
              row.changePct == null ? colors.textMuted : row.changePct >= 0 ? colors.bullish : colors.bearish;
            const biasTone =
              row.bias === "bull" ? colors.bullish : row.bias === "bear" ? colors.bearish : colors.textMuted;
            return (
              <MarketBriefSymbolLink
                key={`${row.lane}:${row.symbol}`}
                symbol={row.symbol}
                company={row.company}
                lane={row.lane}
                onSelect={onSelectSymbol}
                data-testid={`market-brief-sector-row-${row.symbol}`}
                className="market-brief-row-link"
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(3.5rem, auto) minmax(4.5rem, auto) minmax(3.5rem, auto) minmax(0, 1fr)",
                  gap: spacing[2],
                  alignItems: "baseline",
                  width: "100%",
                  padding: `${spacing[1]} ${spacing[2]}`,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.sm,
                  background: colors.surface,
                  color: colors.text,
                  cursor: "pointer"
                }}
              >
                <span style={{ fontWeight: 700, fontFamily: typography.fontFamilyMono }}>{row.symbol}</span>
                <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{feedStateLabel(row.state)}</span>
                <span style={{ fontSize: typography.scale.sm, color: moveTone, fontWeight: 600 }}>{fmtPct(row.changePct)}</span>
                <span
                  style={{
                    fontSize: typography.scale.xs,
                    color: biasTone,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {row.verdict}
                </span>
              </MarketBriefSymbolLink>
            );
          })}
        </div>
      ) : null}

      <MarketBriefSymbolLink
        symbol={sector.symbol}
        company={`${sector.label} sector ETF`}
        lane="swing"
        onSelect={onSelectSymbol}
        data-testid={`market-brief-sector-etf-${sector.symbol}`}
        style={{
          alignSelf: "flex-start",
          border: `1px solid ${colors.border}`,
          background: "transparent",
          color: colors.accent,
          fontSize: typography.scale.xs,
          fontWeight: 600,
          padding: `${spacing[1]} ${spacing[2]}`,
          borderRadius: borderRadius.sm,
          cursor: "pointer"
        }}
      >
        View {sector.symbol} sector ETF →
      </MarketBriefSymbolLink>
    </div>
  );
}

function BriefSymbolButton({
  symbol,
  onClick,
  colors,
  style
}: {
  symbol: string;
  onClick: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      data-testid={`market-brief-symbol-${symbol}`}
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        color: colors.accent,
        fontFamily: typography.fontFamilyMono,
        cursor: "pointer",
        textDecoration: "underline",
        textDecorationColor: `${colors.accent}66`,
        textUnderlineOffset: 3,
        ...style
      }}
    >
      {symbol}
    </button>
  );
}

function MoverColumn({
  title,
  movers,
  positive,
  colors,
  onSelectSymbol
}: {
  title: string;
  movers: BriefMover[];
  positive: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
  onSelectSymbol?: (symbol: string, company?: string | null, lane?: FeedLane) => void;
}) {
  const tone = positive ? colors.bullish : colors.bearish;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[1], minWidth: 0 }}>
      <span style={{ fontSize: typography.scale.xs, fontWeight: 700, color: tone }}>
        {positive ? "▲" : "▼"} {title}
      </span>
      {movers.length === 0 ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>—</span>
      ) : (
        movers.map((m) =>
          onSelectSymbol ? (
            <MarketBriefSymbolLink
              key={m.symbol}
              symbol={m.symbol}
              company={m.company}
              lane={m.lane}
              onSelect={onSelectSymbol}
              data-testid={`market-brief-mover-row-${m.symbol}`}
              className="market-brief-row-link"
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: spacing[2],
                minWidth: 0,
                width: "100%",
                padding: `${spacing[1]} ${spacing[1]}`,
                margin: `0 -${spacing[1]}`,
                borderRadius: borderRadius.sm,
                cursor: "pointer"
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.accent, fontFamily: typography.fontFamilyMono }}>
                  {m.symbol}
                </span>
                {m.company ? (
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}> · {m.company}</span>
                ) : null}
              </span>
              <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: tone, flexShrink: 0 }}>
                {fmtPct(m.changePct)}
              </span>
            </MarketBriefSymbolLink>
          ) : (
            <div key={m.symbol} style={{ display: "flex", justifyContent: "space-between", gap: spacing[2], minWidth: 0 }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.text }}>{m.symbol}</span>
                {m.company ? (
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}> · {m.company}</span>
                ) : null}
              </span>
              <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: tone, flexShrink: 0 }}>
                {fmtPct(m.changePct)}
              </span>
            </div>
          )
        )
      )}
    </div>
  );
}

function OutcomesRecap({
  recap,
  colors
}: {
  recap: BriefOutcomesRecap;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  // Backend already returns these as percentages (e.g. 22.5 = 22.5%), not 0–1 fractions.
  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
  // Tiny samples are statistically meaningless — say so rather than imply a "win rate".
  if (recap.buildingDataset || recap.totalEvents < 5) {
    return (
      <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
        Building the dataset — {recap.totalEvents} tracked {recap.totalEvents === 1 ? "outcome" : "outcomes"} so far.
        Follow-through stats appear once there's enough history to be meaningful.
      </span>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      <span style={{ fontSize: typography.scale.sm, color: colors.text }}>
        {recap.alignmentHeldRate != null ? (
          <>
            Alignment held: <span style={{ fontWeight: 600 }}>{pct(recap.alignmentHeldRate)}</span>
          </>
        ) : null}
        {recap.alignmentHeldRate != null && recap.continuationRate != null ? " · " : null}
        {recap.continuationRate != null ? (
          <>
            Setup continued: <span style={{ fontWeight: 600 }}>{pct(recap.continuationRate)}</span>
          </>
        ) : null}
        <span style={{ color: colors.textMuted }}> · {recap.totalEvents} tracked</span>
      </span>
      {recap.disclaimer ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, opacity: 0.85, lineHeight: 1.45 }}>
          {recap.disclaimer}
        </span>
      ) : null}
    </div>
  );
}

function Headline({
  item,
  dot,
  colors
}: {
  item: BriefHeadline;
  dot: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const meta = [item.source, item.ageLabel].filter(Boolean).join(" · ");
  const body = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: spacing[2] }}>
      <span
        style={{ width: 7, height: 7, borderRadius: "50%", background: dot, marginTop: 6, flexShrink: 0 }}
        aria-hidden
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.4 }}>{item.title}</span>
        {item.impact ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
            {item.impact}
          </span>
        ) : null}
        {meta ? <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, opacity: 0.8 }}>{meta}</span> : null}
      </span>
    </div>
  );
  if (!item.url) return body;
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
      {body}
    </a>
  );
}
