"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { useTheme } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppChrome } from "@/lib/app-chrome-context";
import { borderRadius, roleAccents, spacing, typography } from "@/lib/design-system";
import {
  ScannerOverviewProvider,
  useScannerOverview
} from "@/components/dashboard/scanner-overview-context";
import {
  DashboardEarningsProvider,
  useDashboardEarnings
} from "@/components/dashboard/dashboard-earnings-context";
import { useDeskToday } from "@/lib/hooks/use-desk-today";
import type { DeskTodayData } from "@/lib/api/desk-today";
import { formatTradingDateLabel, isoDateInNewYork } from "@/lib/market-hours-et";
import { useMacroContext } from "@/lib/hooks/use-macro-context";
import { useMarketNews } from "@/lib/hooks/use-market-news";
import { useMarketBriefNarrative } from "@/lib/hooks/use-market-brief-narrative";
import { applyRegimeSanityGuard, mapMacroRegimeToLabel, resolveRegimeLabel } from "@/lib/market-context/regime";
import { isRegularSessionOpen } from "@/lib/market/regular-session";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import type {
  DashboardDeskInitial,
  DashboardSectorRotationRow
} from "@/lib/dashboard/dashboard-page-data";
import {
  MarketBrief,
  type BriefHeadline,
  type BriefMover,
  type BriefOutcomesRecap,
  type BriefSector,
  type BriefWeekEvent,
  type BriefWeekInReview,
  type MarketBriefData
} from "@/components/dashboard/trading-room/market-brief";
import {
  isPreparationPhase,
  resolveBriefSessionPhase
} from "@/lib/dashboard/trading-room/brief-session-copy";
import { useDashboardTape } from "@/lib/hooks/use-dashboard-tape";
import { useWatchlistAtClose } from "@/lib/hooks/use-watchlist-at-close";
import { useWeeklySetupOutcomes } from "@/lib/hooks/use-weekly-setup-outcomes";
import { DeepDive } from "@/components/dashboard/trading-room/deep-dive";
import { QuietFeed } from "@/components/dashboard/trading-room/quiet-feed";
import { SymbolSearch } from "@/components/dashboard/trading-room/symbol-search";
import { WatchlistRail } from "@/components/dashboard/trading-room/watchlist-rail";
import { MarketEnvironmentStrip } from "@/components/market-environment-strip";
import { useMarketEnvironment } from "@/lib/hooks/use-market-environment";
import { environmentSessionCardHint } from "@/lib/signal-evidence/environment-session-hint";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import { getLastSelectedId, setLastSelectedId } from "@/lib/dashboard/trading-room/session-selection";
import {
  buildFeedCards,
  groupFeedByLane,
  rankAndCapFeed,
  type FeedBias,
  type FeedCard,
  type FeedFilters,
  type FeedLane,
  type FeedState,
  DEFAULT_FEED_FILTERS
} from "@/lib/dashboard/trading-room/feed-model";

interface DashboardTradingRoomProps {
  marketOverview: MarketOverview;
  scannerOverview: ScannerOverview;
  earningsEvents: EarningsEvent[];
  earningsRecent: EarningsEvent[];
  dayTradingSurfaces?: boolean;
  deskInitial?: DashboardDeskInitial;
  /** Server-computed sector ETF rotation (1-day + 5-day) for the brief. */
  sectorRotation?: DashboardSectorRotationRow[];
  /** First name for the brief greeting; falls back to a name-less greeting. */
  userName?: string | null;
  /** Renders null; hydrates the scanner overview context with live setups/gaps. */
  deferredScannerSlot?: ReactNode;
}

const STATE_LABEL: Record<FeedState, string> = {
  actionable: "Actionable",
  near: "Near",
  potential: "Potential",
  cooling: "Cooling"
};

function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function mapNewsSentiment(s: string | null | undefined): "bullish" | "bearish" | "neutral" {
  const v = (s || "").trim().toLowerCase();
  if (v === "positive" || v === "bullish") return "bullish";
  if (v === "negative" || v === "bearish") return "bearish";
  return "neutral";
}

function newsAgeLabel(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** Human "when" for a macro event row, e.g. "Tue 8:30 AM ET" — falls back to a day count. */
function formatEventWhen(scheduledIso: string | null | undefined, hoursUntil: number): string {
  if (scheduledIso?.trim()) {
    const d = new Date(scheduledIso);
    if (Number.isFinite(d.getTime())) {
      return (
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        }).format(d) + " ET"
      );
    }
  }
  const days = Math.round(hoursUntil / 24);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days}d`;
}

/** Swing-lane accent (violet/magenta) — deliberately far from the day/interactive blue. */
const SWING_ACCENT = "#c04cf5";

/**
 * Stacks the Trading Room into a single column below `maxPx`. Uses a lower
 * threshold (900px) than the app-wide `useIsMobileLayout` (1024px) so the
 * three-column terminal still appears on narrower desktop windows / scaled
 * laptops — matching where the nav rail also becomes visible.
 */
function useStackedLayout(maxPx = 899): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxPx}px)`);
    const update = () => setStacked(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxPx]);
  return stacked;
}

/** Breadth read from how many of the tracked indices are advancing. */
function breadthWord(spyPct: number | null, qqqPct: number | null, iwmPct: number | null): string {
  const vals = [spyPct, qqqPct, iwmPct].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return "mixed";
  const up = vals.filter((v) => v > 0.05).length;
  const down = vals.filter((v) => v < -0.05).length;
  if (up > down) return "positive";
  if (down > up) return "negative";
  return "mixed";
}

/** VIX in plain English. */
function vixWord(level: number | null): string {
  if (level == null) return "—";
  if (level < 14) return "calm";
  if (level >= 20) return "elevated";
  return "moderate";
}

/** Concise session word for the pulse line. */
function sessionWord(marketOpen: boolean | null, marketStatusLabel: string): string {
  if (marketOpen === true) return "Active session";
  if (/extended/i.test(marketStatusLabel)) return "Extended hours";
  if (marketOpen === false) return "Market closed";
  return "Session pending";
}

/** "Market data as of" clock, in US Eastern, matching the prototype's tabular time. */
function asOfTimeET(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short"
    });
  } catch {
    return d.toLocaleTimeString();
  }
}

function marketStatusLabelFor(market: string | undefined, open: boolean | null): string {
  const m = (market || "").trim().toLowerCase();
  if (m === "open" || open === true) return "Market open";
  if (m === "extended-hours" || m === "extended_hours") return "Extended hours";
  if (m === "closed" || open === false) return "Market closed";
  return "Market status unknown";
}

/** Plain-English read on the tape from index moves + sector tilt + VIX. Null when no index data. */
function buildSessionNarrative({
  marketOpen,
  spyPct,
  qqqPct,
  iwmPct,
  vixLevel,
  vixPct,
  sectors
}: {
  marketOpen: boolean | null;
  spyPct: number | null;
  qqqPct: number | null;
  iwmPct: number | null;
  vixLevel: number | null;
  vixPct: number | null;
  sectors: { label: string; pct: number }[];
}): string | null {
  if (spyPct == null) return null;
  const verb = marketOpen === false ? "finished" : "is trading";
  const tone = spyPct > 0.15 ? "higher" : spyPct < -0.15 ? "lower" : "little changed";
  const lead = `The S&P 500 ${verb} ${tone} (${fmtPct(spyPct)})`;

  const clauses: string[] = [];
  if (qqqPct != null) {
    if (qqqPct - spyPct > 0.4) clauses.push("tech outperforming");
    else if (spyPct - qqqPct > 0.4) clauses.push("tech dragging");
  }
  if (iwmPct != null) {
    if (iwmPct - spyPct > 0.4) clauses.push("small caps leading (risk-on)");
    else if (spyPct - iwmPct > 0.4) clauses.push("small caps lagging (defensive)");
  }

  let vixClause = "";
  if (vixLevel != null) {
    const fear = vixPct != null && vixPct > 5 ? ", fear rising" : "";
    if (vixLevel >= 20) vixClause = ` Volatility is elevated (VIX ${vixLevel.toFixed(1)}${fear}).`;
    else if (vixLevel < 14) vixClause = ` Volatility is subdued (VIX ${vixLevel.toFixed(1)}).`;
    else vixClause = ` Volatility is moderate (VIX ${vixLevel.toFixed(1)}${fear}).`;
  }

  // Sector tilt: best vs worst of the tracked sector ETFs.
  let sectorClause = "";
  if (sectors.length >= 2) {
    const best = sectors[0];
    const worst = sectors[sectors.length - 1];
    if (best.pct > 0.1 || worst.pct < -0.1) {
      sectorClause = ` ${best.label} leads (${fmtPct(best.pct)}) while ${worst.label} lags (${fmtPct(worst.pct)}).`;
    }
  }

  const body = clauses.length > 0 ? `${lead}, with ${joinClauses(clauses)}.` : `${lead}.`;
  return `${body}${sectorClause}${vixClause}`;
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function snapPct(s: SnapshotPayload | undefined): number | null {
  if (!s) return null;
  const c = s.change_percent;
  if (typeof c === "number" && Number.isFinite(c) && c > -99.5) return c;
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

export function DashboardTradingRoom(props: DashboardTradingRoomProps) {
  return (
    <ScannerOverviewProvider initialOverview={props.scannerOverview}>
      <DashboardEarningsProvider
        initialUpcoming={props.earningsEvents}
        initialRecent={props.earningsRecent}
      >
        <TradingRoomBody {...props} />
        {props.deferredScannerSlot}
      </DashboardEarningsProvider>
    </ScannerOverviewProvider>
  );
}

function TradingRoomBody({
  marketOverview,
  dayTradingSurfaces = true,
  deskInitial,
  sectorRotation = [],
  userName
}: DashboardTradingRoomProps) {
  const { colors } = useTheme();
  const isMobile = useStackedLayout(899);
  const scannerOverview = useScannerOverview();
  const earnings = useDashboardEarnings();
  const { data: macro } = useMacroContext();
  const { articles: newsArticles } = useMarketNews();
  const { data: aiBrief } = useMarketBriefNarrative();
  const swingEnvironment = useMarketEnvironment("swing", { macroRegime: macro?.market_regime });
  const dayEnvironment = useMarketEnvironment("day", { macroRegime: macro?.market_regime });

  const { data: swingDesk } = useDeskToday("swing", { fallbackData: deskInitial?.swing });
  const { data: dayDesk } = useDeskToday("day", {
    fallbackData: deskInitial?.day
  });

  const { snapshotsBySymbol, status: marketStatus } = useDashboardTape(marketOverview);

  const { swingSetups, daySetups } = useMemo(() => {
    const swing = scannerOverview.setups.filter((s) => s.scanner_mode === "swing_daily");
    const day = scannerOverview.setups.filter(
      (s) => s.scanner_mode !== "swing_daily" && typeof s.score === "number" && Number.isFinite(s.score)
    );
    return { swingSetups: swing, daySetups: day };
  }, [scannerOverview.setups]);

  const companyBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of scannerOverview.setups) {
      const sym = s.symbol?.trim().toUpperCase();
      if (sym && s.company_name?.trim()) map.set(sym, s.company_name.trim());
    }
    for (const g of scannerOverview.gapIntelligence) {
      const sym = g.symbol?.trim().toUpperCase();
      if (sym && g.company_name?.trim() && !map.has(sym)) map.set(sym, g.company_name.trim());
    }
    // Snapshots carry company_name from Polygon — fills in any symbol not
    // covered by the scanner overview (desk-only leaders, watchlist entries).
    for (const [sym, snap] of snapshotsBySymbol) {
      if (snap.company_name?.trim() && !map.has(sym)) map.set(sym, snap.company_name.trim());
    }
    return map;
  }, [scannerOverview.setups, scannerOverview.gapIntelligence, snapshotsBySymbol]);

  const allCards = useMemo(() => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk: swingDesk?.data,
      dayDesk: dayDesk?.data,
      swingSetups,
      daySetups,
      snapshotsBySymbol,
      dayTradingSurfaces
    });
    return cards.map((c) => ({ ...c, company: c.company ?? companyBySymbol.get(c.symbol) ?? null }));
  }, [swingDesk?.data, dayDesk?.data, swingSetups, daySetups, snapshotsBySymbol, dayTradingSurfaces, companyBySymbol]);

  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
  const feedEnvironment = filters.lane === "day" ? dayEnvironment : swingEnvironment;
  const ranked = useMemo(() => rankAndCapFeed(allCards, filters), [allCards, filters]);
  const { day, swing } = useMemo(() => groupFeedByLane(ranked), [ranked]);

  // Staleness detection: compare the swing desk envelope's market_date against today's ET
  // calendar date. When the app is running on a weekend, the swing desk may have data
  // from Friday (4-day TTL); we surface this transparently rather than hiding it.
  const etToday = isoDateInNewYork();
  const swingDeskDate = typeof swingDesk?.envelope?.market_date === "string"
    ? (swingDesk.envelope.market_date as string)
    : null;
  const swingDataIsStale = swingDeskDate != null && swingDeskDate !== etToday;
  // e.g. "Fri Jun 6" — used in the section header and per-card labels.
  const staleDateLabel: string | null = swingDataIsStale
    ? formatTradingDateLabel(swingDeskDate!)
    : null;

  // Center panel = Brief by default. Restore the last selection on SPA return
  // (module-scoped memory survives navigation but not a hard refresh / login).
  const [selectedId, setSelectedId] = useState<string | null>(() => getLastSelectedId());
  // Holds a synthetic card for symbols that live only on the watchlist (not in
  // the desk/scanner feed), so the deep dive can open for any monitored symbol.
  const [overrideCard, setOverrideCard] = useState<FeedCard | null>(null);
  // Collapsed by default on every breakpoint — the watchlist is a peek-on-demand
  // rail, not a persistent third column. The user opens it from the collapsed tab.
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const select = (id: string | null) => {
    setSelectedId(id);
    setOverrideCard(null);
    setLastSelectedId(id);
  };
  const selectCard = (card: FeedCard) => {
    setSelectedId(card.id);
    setOverrideCard(card);
    setLastSelectedId(card.id);
  };
  // Open any searched symbol in the deep dive: reuse the richer feed card when
  // the symbol is already on the desk; otherwise synthesize a minimal card and
  // let the deep dive's composite fetch fill in the read.
  const openSymbol = (symbol: string, company?: string | null) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    const existing = allCards.find((c) => c.symbol === sym);
    if (existing) {
      selectCard(existing);
      return;
    }
    const snap = snapshotsBySymbol.get(sym);
    const last = snap?.last_trade_price;
    selectCard({
      id: `swing:${sym}`,
      symbol: sym,
      company: company?.trim() || companyBySymbol.get(sym) || snap?.company_name?.trim() || null,
      lane: "swing",
      state: "potential",
      bias: "neutral",
      verdict: "Looked up from search — full read below.",
      phase: null,
      price: typeof last === "number" && Number.isFinite(last) ? last : null,
      changePct: snapPct(snap),
      alignment: null,
      rankScore: 0,
      source: "desk"
    });
  };
  const selected = useMemo(() => {
    if (!selectedId) return null;
    const fromFeed = allCards.find((c) => c.id === selectedId);
    if (fromFeed) return fromFeed;
    if (overrideCard && overrideCard.id === selectedId) return overrideCard;
    return null;
  }, [allCards, selectedId, overrideCard]);

  // Top setup for the brief CTA: hottest actionable, else hottest overall.
  const topCard = useMemo(
    () => ranked.find((c) => c.state === "actionable") ?? ranked[0] ?? null,
    [ranked]
  );

  const counts = useMemo(() => {
    const acc: Record<FeedState, number> = { actionable: 0, near: 0, potential: 0, cooling: 0 };
    for (const c of allCards) acc[c.state] += 1;
    return acc;
  }, [allCards]);

  // Resolve the displayed index moves first (scanner overview, else live snapshots)
  // so the regime headline is classified from the *same* numbers the chips show —
  // otherwise a closed-weekend tape (empty scanner overview) reads "Neutral" above
  // red index chips.
  const spyPct = scannerOverview.spyPct ?? snapPct(snapshotsBySymbol.get("SPY"));
  const qqqPct = scannerOverview.qqqPct ?? snapPct(snapshotsBySymbol.get("QQQ"));
  const iwmPct = snapPct(snapshotsBySymbol.get("IWM"));

  // Prefer the backend weighted macro regime (single source of truth — same engine
  // that gates setups and the morning brief). Fall back to the index-return
  // classifier when the macro read is unavailable (e.g. cold cache). The sanity
  // guard is the final net so a sharply red tape can never read "Neutral".
  const macroRegimeLabel = mapMacroRegimeToLabel(macro?.market_regime);
  const regimeLabel = applyRegimeSanityGuard(
    macroRegimeLabel ??
      resolveRegimeLabel({
        scannerError: scannerOverview.error,
        scannerRegimeLabel: scannerOverview.regimeLabel,
        spyPct: typeof spyPct === "number" ? spyPct : null,
        qqqPct: typeof qqqPct === "number" ? qqqPct : null
      }).label,
    typeof spyPct === "number" ? spyPct : null,
    typeof qqqPct === "number" ? qqqPct : null
  );

  const vixSnap =
    snapshotsBySymbol.get("I:VIX") ?? snapshotsBySymbol.get("^VIX") ?? snapshotsBySymbol.get("VIX");
  const vixLevel =
    typeof vixSnap?.last_trade_price === "number" && Number.isFinite(vixSnap.last_trade_price)
      ? vixSnap.last_trade_price
      : null;
  const vixPct = snapPct(vixSnap);

  // "What to watch": nearest high-importance macro event, else next earnings.
  const watch = useMemo(() => {
    const events = [...(macro?.upcoming_events ?? [])]
      .filter((e) => typeof e.hours_until === "number")
      .sort((a, b) => a.hours_until - b.hours_until);
    const top = events.find((e) => e.importance >= 2) ?? events[0];
    if (top) {
      return {
        line: top.name,
        detail: top.warning ?? (macro?.macro_risk ? `${macro.macro_risk}` : null)
      };
    }
    const next = [...earnings.upcoming]
      .filter((e) => e.report_date?.trim())
      .sort((a, b) => a.report_date.localeCompare(b.report_date))[0];
    if (next) {
      return { line: `${next.symbol} earnings ${next.report_date}`, detail: next.company_name || null };
    }
    return { line: null as string | null, detail: null as string | null };
  }, [macro?.upcoming_events, macro?.macro_risk, earnings.upcoming]);

  // Client-tracked last-refresh time: stamped whenever any live data source
  // resolves or revalidates. Acts as the final fallback so the header's
  // "Market data as of" always shows a real time rather than a bare dash.
  const [lastRefreshedIso, setLastRefreshedIso] = useState<string | null>(null);
  useEffect(() => {
    setLastRefreshedIso(new Date().toISOString());
    // `newsArticles` can be a fresh [] each render while loading — key off its
    // length (stable) plus the SWR data refs (stable until a real revalidation).
  }, [swingDesk?.data, dayDesk?.data, newsArticles.length, aiBrief]);

  const updatedAtIso =
    swingDesk?.data?.generated_at ??
    dayDesk?.data?.generated_at ??
    marketStatus?.server_time ??
    lastRefreshedIso;

  const marketOpen = marketStatus ? isRegularSessionOpen(marketStatus) : null;
  const marketStatusLabel = marketStatusLabelFor(marketStatus?.market, marketOpen);

  // Sectors: prefer the latest-session move when the tape is shut (that's "today"),
  // otherwise lean on the 5-day rotation for a steadier leadership read.
  const sectors = useMemo<BriefSector[]>(() => {
    const useDaily = marketOpen === false;
    const result: BriefSector[] = [];
    for (const row of sectorRotation) {
      const pct = useDaily ? (row.pct1d ?? row.pct5d) : (row.pct5d ?? row.pct1d);
      if (pct == null) continue;
      result.push({ label: row.label, pct, pct1d: row.pct1d ?? null, pct5d: row.pct5d ?? null });
    }
    return result.sort((a, b) => b.pct - a.pct);
  }, [sectorRotation, marketOpen]);
  const sectorWindowLabel = marketOpen === false ? "today" : "past week";

  // Notable movers from what we're actively tracking (real intraday % moves).
  const movers = useMemo(() => {
    const withPct = allCards
      .filter((c) => typeof c.changePct === "number" && Number.isFinite(c.changePct))
      .map((c) => ({ symbol: c.symbol, company: c.company ?? null, changePct: c.changePct as number }));
    const seen = new Set<string>();
    const dedup: BriefMover[] = [];
    for (const m of withPct) {
      if (seen.has(m.symbol)) continue;
      seen.add(m.symbol);
      dedup.push(m);
    }
    const up = [...dedup].sort((a, b) => b.changePct - a.changePct).filter((m) => m.changePct > 0).slice(0, 3);
    const down = [...dedup].sort((a, b) => a.changePct - b.changePct).filter((m) => m.changePct < 0).slice(0, 3);
    return { up, down };
  }, [allCards]);

  const sessionNarrative = useMemo(
    () => buildSessionNarrative({ marketOpen, spyPct, qqqPct, iwmPct, vixLevel, vixPct, sectors }),
    [marketOpen, spyPct, qqqPct, iwmPct, vixLevel, vixPct, sectors]
  );

  const headlines = useMemo<BriefHeadline[]>(
    () =>
      newsArticles.slice(0, 6).map((a, i) => ({
        id: a.article_id || a.id || `news-${i}`,
        title: a.title,
        source: a.source || a.publisher?.name || null,
        ageLabel: newsAgeLabel(a.published_at || a.published_utc),
        sentiment: mapNewsSentiment(a.sentiment),
        url: a.url || a.article_url || null,
        impact: a.impact_summary?.trim() || null
      })),
    [newsArticles]
  );

  // Session phase drives the brief's lead line, CTA copy, and which preparation
  // blocks surface. Weekend / after-hours are the "prep" surfaces.
  const sessionPhase = resolveBriefSessionPhase(marketOpen);
  const showPrep = isPreparationPhase(sessionPhase);

  // Preparation data is fetched only when the desk is in a prep phase — the live
  // session has its own surfaces (feed, rail) and shouldn't pay for these calls.
  const watchlistAtClose = useWatchlistAtClose(showPrep, "swing");
  const outcomes = useWeeklySetupOutcomes(showPrep, "swing", 30);

  // "Looking ahead": macro/earnings events in the coming days, soonest first.
  const weekAhead = useMemo<BriefWeekEvent[]>(() => {
    const events = [...(macro?.upcoming_events ?? [])]
      .filter((e) => typeof e.hours_until === "number" && e.hours_until >= -6 && e.hours_until <= 24 * 8)
      .sort((a, b) => a.hours_until - b.hours_until);
    return events.slice(0, 5).map((e) => ({
      label: e.name,
      when: formatEventWhen(e.scheduled_time, e.hours_until),
      importance: e.importance ?? 0
    }));
  }, [macro?.upcoming_events]);

  // "Week in review": best/worst sector by 5-day move — factual market data only.
  const weekInReview = useMemo<BriefWeekInReview | null>(() => {
    const with5d = sectors.filter((s): s is BriefSector & { pct5d: number } => typeof s.pct5d === "number" && Number.isFinite(s.pct5d));
    if (with5d.length === 0) return null;
    const sorted = [...with5d].sort((a, b) => b.pct5d - a.pct5d);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    return {
      bestSector: best ? { label: best.label, pct5d: best.pct5d } : null,
      worstSector: worst && worst.label !== best?.label ? { label: worst.label, pct5d: worst.pct5d } : null
    };
  }, [sectors]);

  const outcomesRecap = useMemo<BriefOutcomesRecap | null>(() => {
    if (!outcomes) return null;
    return {
      windowDays: outcomes.days,
      totalEvents: outcomes.stats.total_events,
      buildingDataset: outcomes.stats.building_dataset,
      alignmentHeldRate: outcomes.stats.alignment_held_rate ?? null,
      continuationRate: outcomes.stats.setup_continuation_rate ?? null,
      disclaimer: outcomes.disclaimer
    };
  }, [outcomes]);

  // Top swing card for the weekend prep highlight in the Market Brief.
  // Uses the "all swing cards" list (pre-filter) so the brief always surfaces
  // the hottest setup even if the user's filters would hide it.
  const topSwingCard = useMemo(
    () => allCards.filter((c) => c.lane === "swing").sort((a, b) => {
      const stateOrder: Record<string, number> = { actionable: 0, near: 1, potential: 2, cooling: 3 };
      const byState = (stateOrder[a.state] ?? 4) - (stateOrder[b.state] ?? 4);
      if (byState !== 0) return byState;
      return b.rankScore - a.rankScore;
    })[0] ?? null,
    [allCards]
  );
  const swingCardCount = allCards.filter((c) => c.lane === "swing").length;

  const briefData: MarketBriefData = {
    userName: userName ?? null,
    marketOpen,
    marketStatusLabel,
    regimeLabel,
    marketRegime: macro?.market_regime ?? null,
    macroScore: macro?.macro_score ?? null,
    sessionNarrative,
    aiNarrative: aiBrief?.available ? aiBrief.narrative : null,
    spyPct,
    qqqPct,
    iwmPct,
    vixLevel,
    vixPct,
    breadthLine: null,
    sectors,
    sectorWindowLabel,
    movers,
    headlines,
    counts,
    topCard,
    watchLine: watch.line,
    watchDetail: watch.detail,
    updatedAtIso,
    sessionPhase,
    weekAhead,
    watchlistAtClose,
    weekInReview,
    outcomesRecap,
    topSwingCard,
    swingCardCount,
    swingDataDate: staleDateLabel
  };

  // Use the unfiltered allCards count so active user filters never accidentally hide the
  // feed panel (e.g. "Day only" filter with no day cards but swing cards still in allCards).
  const deskEmpty = allCards.length === 0;

  // On weekends the feed panel stays visible even when the desk cache has expired.
  // This keeps the signal feed column present so Friday's data can surface once the
  // cache warms (TTL fix) and avoids a fully blank left column during prep time.
  const isWeekendSession = sessionPhase === "weekend";
  // feedVisible: the actual gate for rendering the left column.
  const feedVisible = !deskEmpty || isWeekendSession;
  // When the desk is empty, collapse the feed column so the center panel
  // takes the full width. Feed returns when signals appear.
  const gridTemplate = feedVisible
    ? watchlistOpen
      ? `300px minmax(0, 1fr) 300px`
      : `300px minmax(0, 1fr) 44px`
    : watchlistOpen
      ? `minmax(0, 1fr) 300px`
      : `minmax(0, 1fr) 44px`;

  const feedPanel = (
    <SignalFeed
      day={day}
      swing={swing}
      showDay={dayTradingSurfaces}
      selectedId={selected?.id ?? null}
      onSelect={select}
      deskEmpty={deskEmpty}
      swingDeskData={swingDesk?.data}
      dayDeskData={dayDesk?.data}
      snapshotsBySymbol={snapshotsBySymbol}
      companyBySymbol={companyBySymbol}
      onSelectCard={selectCard}
      onOpenSymbol={openSymbol}
      isMobile={isMobile}
      colors={colors}
      staleDateLabel={staleDateLabel}
      isWeekend={isWeekendSession}
      feedEnvironment={feedEnvironment}
      swingEnvironment={swingEnvironment}
      dayEnvironment={dayEnvironment}
    />
  );
  const centerPanel = selected ? (
    <DeepDive card={selected} allCards={allCards} companyBySymbol={companyBySymbol} onBackToBrief={() => select(null)} isMobile={isMobile} colors={colors} />
  ) : (
    <MarketBrief data={briefData} onViewTopSetup={() => topCard && select(topCard.id)} onSearch={undefined} />
  );
  const railPanel = (
    <WatchlistRail
      mode="swing"
      selectedId={selected?.id ?? null}
      onSelectCard={selectCard}
      companyBySymbol={companyBySymbol}
      open={watchlistOpen}
      onToggleOpen={() => setWatchlistOpen((o) => !o)}
      isMobile={isMobile}
      colors={colors}
    />
  );

  // Full-bleed amount: pull the header/filter bands out to the edges of the
  // padded <main> so they read as flush, edge-to-edge bars (prototype). The
  // value mirrors the <main> horizontal padding, which switches at the same
  // 900px breakpoint the dashboard uses.
  const bleed = isMobile ? spacing[4] : spacing[6];

  return (
    <section
      className="stocvest-dashboard-v2"
      style={{ display: "grid", gap: 0, color: colors.text }}
    >
      <SessionHeader
        regimeLabel={regimeLabel}
        spyPct={spyPct}
        qqqPct={qqqPct}
        iwmPct={iwmPct}
        vixLevel={vixLevel}
        marketStatusLabel={marketStatusLabel}
        marketOpen={marketOpen}
        counts={counts}
        updatedAtIso={updatedAtIso}
        onOpenSymbol={openSymbol}
        bleed={bleed}
        isMobile={isMobile}
        colors={colors}
      />

      {/* Hide the filter bar when the desk is quiet — there's nothing to filter,
          and the feed shows the "building structure / session activity" view. */}
      {allCards.length > 0 ? (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          showDay={dayTradingSurfaces}
          bleed={bleed}
          isMobile={isMobile}
          colors={colors}
        />
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : gridTemplate,
          gap: spacing[4],
          alignItems: "start",
          marginTop: spacing[5]
        }}
      >
        {isMobile ? (
          // Mobile: center brief/deep-dive leads; feed shown when there are signals or on weekends.
          <>
            {centerPanel}
            {feedVisible ? feedPanel : null}
            {railPanel}
          </>
        ) : (
          <>
            {feedVisible ? feedPanel : null}
            {centerPanel}
            {railPanel}
          </>
        )}
      </div>
    </section>
  );
}

/* ── Session header ─────────────────────────────────────────────────────── */

function SessionHeader({
  regimeLabel,
  spyPct,
  qqqPct,
  iwmPct,
  vixLevel,
  marketStatusLabel,
  marketOpen,
  counts,
  updatedAtIso,
  onOpenSymbol,
  bleed,
  isMobile = false,
  colors
}: {
  regimeLabel: string;
  spyPct: number | null;
  qqqPct: number | null;
  iwmPct: number | null;
  vixLevel: number | null;
  marketStatusLabel: string;
  marketOpen: boolean | null;
  counts: Record<FeedState, number>;
  updatedAtIso: string | null;
  onOpenSymbol: (symbol: string, name?: string | null) => void;
  bleed: string;
  isMobile?: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  // Orb: green while the tape is live, amber in extended hours, dim when closed.
  const orbTone =
    marketOpen === true ? colors.bullish : /extended/i.test(marketStatusLabel) ? colors.caution : colors.textMuted;
  const breadth = breadthWord(spyPct, qqqPct, iwmPct);
  const vix = vixWord(vixLevel);
  const session = sessionWord(marketOpen, marketStatusLabel);
  const asOf = asOfTimeET(updatedAtIso);
  const deskIsEmpty = counts.actionable + counts.near + counts.potential + counts.cooling === 0;
  const hasActionable = counts.actionable > 0;
  // Color tier: green when actionable, amber when only near/potential, hidden when empty.
  const chipTone = hasActionable
    ? colors.bullish
    : counts.near > 0 || counts.potential > 0
      ? colors.caution
      : colors.textMuted;
  const vixText = vixLevel != null ? `${vix} (${vixLevel.toFixed(1)})` : vix;

  // Color-coded reads so the pulse line is scannable at a glance.
  const regimeTone = /expansion|risk-?on|bull/i.test(regimeLabel)
    ? colors.bullish
    : /contraction|risk-?off|bear/i.test(regimeLabel)
      ? colors.bearish
      : colors.accent;
  const breadthTone =
    breadth === "positive" ? colors.bullish : breadth === "negative" ? colors.bearish : colors.caution;
  const vixTone =
    vix === "calm" ? colors.bullish : vix === "elevated" ? colors.bearish : vix === "moderate" ? colors.caution : colors.textMuted;
  const sessionTone = /active/i.test(session)
    ? colors.bullish
    : /extended|pending/i.test(session)
      ? colors.caution
      : colors.textMuted;

  const Tone = ({ color, children }: { color: string; children: ReactNode }) => (
    <b style={{ color, fontWeight: 600 }}>{children}</b>
  );

  // The dashboard suppresses the global TopBar, so this bar owns the mobile
  // nav-drawer trigger (the rail is hidden < 900px).
  const { openNavDrawer } = useAppChrome();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        columnGap: spacing[5],
        rowGap: spacing[2],
        flexWrap: "wrap",
        padding: `${spacing[3]} ${bleed}`,
        marginLeft: `-${bleed}`,
        marginRight: `-${bleed}`,
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`
      }}
    >
      {/* Mobile menu — opens the nav drawer (rail is hidden below 900px) */}
      {isMobile ? (
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={openNavDrawer}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            flex: "none",
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: "transparent",
            color: colors.text,
            cursor: "pointer"
          }}
        >
          <Menu size={20} />
        </button>
      ) : null}

      {/* Compact wordmark — mirrors the prototype's `.brand` */}
      <span
        style={{
          fontWeight: 700,
          letterSpacing: "0.16em",
          fontSize: 13,
          flex: "none",
          whiteSpace: "nowrap",
          // Subtle brand sheen: a restrained gradient from the text color toward
          // the accent, clipped to the glyphs. Reads premium without being loud.
          backgroundImage: `linear-gradient(95deg, ${colors.text} 35%, ${colors.accent})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          WebkitTextFillColor: "transparent"
        }}
      >
        STOCVEST<span style={{ color: colors.accent, WebkitTextFillColor: colors.accent }}>.</span>
      </span>

      {/* Theme toggle — pinned to the right of the first line on mobile */}
      {isMobile ? <div style={{ marginLeft: "auto", flex: "none" }}><ThemeToggle /></div> : null}

      {/* Pulse line — plain-English session read */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[3],
          color: colors.textMuted,
          fontSize: typography.scale.sm,
          minWidth: 0,
          flex: isMobile ? "1 1 100%" : "0 1 auto"
        }}
      >
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: orbTone,
            boxShadow: marketOpen === true ? `0 0 10px 1px ${orbTone}88` : "none",
            flex: "none"
          }}
        />
        <span style={{ lineHeight: 1.4 }}>
          Market in <Tone color={regimeTone}>{regimeLabel}</Tone> · breadth <Tone color={breadthTone}>{breadth}</Tone> ·{" "}
          VIX <Tone color={vixTone}>{vixText}</Tone> · <Tone color={sessionTone}>{session}</Tone>
        </span>
      </div>

      {/* Right cluster — search + desk count + freshness + theme toggle.
          `marginLeft: auto` shoves it to the far right on desktop; on mobile it
          drops to its own full-width line. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[4],
          flexWrap: "wrap",
          minWidth: 0,
          marginLeft: isMobile ? 0 : "auto",
          flex: isMobile ? "1 1 100%" : "0 0 auto"
        }}
      >
        <SymbolSearch
          placeholder="Jump to a symbol or company…"
          onPick={onOpenSymbol}
          colors={colors}
          width={isMobile ? "100%" : 248}
          pill
        />

        {/* Count chip — hidden when the desk is completely empty */}
        {!deskIsEmpty ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: 6,
              padding: "5px 12px",
              borderRadius: borderRadius.full,
              background: `${chipTone}1a`,
              border: `1px solid ${chipTone}4d`,
              color: chipTone,
              fontSize: typography.scale.xs,
              fontWeight: 600,
              whiteSpace: "nowrap"
            }}
          >
            <span style={{ fontSize: typography.scale.base }}>{counts.actionable}</span> actionable
          </span>
        ) : null}

        <span
          style={{
            fontSize: 11.5,
            color: colors.textMuted,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap"
          }}
        >
          Market data as of <b style={{ color: colors.text, fontWeight: 600 }}>{asOf ?? "—"}</b>
        </span>

        {!isMobile ? <ThemeToggle /> : null}
      </div>
    </header>
  );
}

/* ── Filter bar ─────────────────────────────────────────────────────────── */

function FilterBar({
  filters,
  onChange,
  showDay,
  bleed,
  isMobile = false,
  colors
}: {
  filters: FeedFilters;
  onChange: (f: FeedFilters) => void;
  showDay: boolean;
  bleed: string;
  isMobile?: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  // Lane = the prototype's mode pillset: Day reads electric-blue, Swing violet.
  const laneOpts: SegOption<FeedFilters["lane"]>[] = showDay
    ? [
        { id: "all", label: "All" },
        { id: "day", label: "Day", icon: "⚡", activeColor: colors.accent },
        { id: "swing", label: "Swing", icon: "◈", activeColor: SWING_ACCENT }
      ]
    : [
        { id: "all", label: "All" },
        { id: "swing", label: "Swing", icon: "◈", activeColor: SWING_ACCENT }
      ];
  const stateOpts: SegOption<FeedFilters["state"]>[] = [
    { id: "all", label: "All states" },
    { id: "actionable", label: "Actionable" },
    { id: "near", label: "Near" },
    { id: "potential", label: "Potential" }
  ];
  const biasOpts: SegOption<FeedFilters["bias"]>[] = [
    { id: "all", label: "Both" },
    { id: "long", label: "Long" },
    { id: "short", label: "Short" }
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: spacing[4],
        alignItems: "center",
        // Mobile: keep the pillsets on one line and let them scroll horizontally
        // rather than wrapping into a tall stack.
        flexWrap: isMobile ? "nowrap" : "wrap",
        overflowX: isMobile ? "auto" : "visible",
        padding: `${spacing[2]} ${bleed}`,
        marginLeft: `-${bleed}`,
        marginRight: `-${bleed}`,
        background: colors.background,
        borderBottom: `1px solid ${colors.border}`
      }}
    >
      <SegGroup
        value={filters.lane}
        options={laneOpts}
        onSelect={(v) => onChange({ ...filters, lane: v })}
        colors={colors}
      />
      <SegGroup
        value={filters.state}
        options={stateOpts}
        onSelect={(v) => onChange({ ...filters, state: v })}
        colors={colors}
      />
      <SegGroup
        value={filters.bias}
        options={biasOpts}
        onSelect={(v) => onChange({ ...filters, bias: v })}
        colors={colors}
      />
    </div>
  );
}

type SegOption<T extends string> = {
  id: T;
  label: string;
  /** Optional leading glyph (e.g. ⚡ for Day, ◈ for Swing). */
  icon?: string;
  /** Optional active text color — Day = electric blue, Swing = violet. */
  activeColor?: string;
};

function SegGroup<T extends string>({
  value,
  options,
  onSelect,
  colors
}: {
  value: T;
  options: SegOption<T>[];
  onSelect: (v: T) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 3,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.full
      }}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        const activeColor = opt.activeColor ?? colors.text;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            style={{
              border: "none",
              background: active ? colors.surfaceMuted : "transparent",
              boxShadow: active ? `inset 0 0 0 1px ${colors.border}` : "none",
              color: active ? activeColor : colors.textMuted,
              fontSize: typography.scale.xs,
              fontWeight: 600,
              padding: "5px 13px",
              borderRadius: borderRadius.full,
              cursor: "pointer",
              transition: "color .14s, background .14s",
              whiteSpace: "nowrap"
            }}
          >
            {opt.icon ? <span style={{ marginRight: 5 }}>{opt.icon}</span> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Signal feed ────────────────────────────────────────────────────────── */

function SignalFeed({
  day,
  swing,
  showDay,
  selectedId,
  onSelect,
  deskEmpty,
  swingDeskData,
  dayDeskData,
  snapshotsBySymbol,
  companyBySymbol,
  onSelectCard,
  onOpenSymbol,
  isMobile = false,
  colors,
  staleDateLabel = null,
  isWeekend = false,
  feedEnvironment = null,
  swingEnvironment = null,
  dayEnvironment = null
}: {
  day: FeedCard[];
  swing: FeedCard[];
  showDay: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  deskEmpty: boolean;
  swingDeskData: DeskTodayData | null | undefined;
  dayDeskData: DeskTodayData | null | undefined;
  snapshotsBySymbol: Map<string, SnapshotPayload>;
  companyBySymbol: Map<string, string>;
  onSelectCard: (card: FeedCard) => void;
  onOpenSymbol: (symbol: string, name?: string | null) => void;
  isMobile?: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
  /** When non-null, swing data is from a previous trading day — shown in the section header. */
  staleDateLabel?: string | null;
  /** True when it is a weekend — shows a weekend-specific empty message instead of hiding the feed. */
  isWeekend?: boolean;
  feedEnvironment?: MarketEnvironmentPayload | null;
  swingEnvironment?: MarketEnvironmentPayload | null;
  dayEnvironment?: MarketEnvironmentPayload | null;
}) {
  const empty = day.length === 0 && swing.length === 0;
  // Desktop: an independently-scrolling feed zone (sticky pane) with a vertical
  // divider to its right — mirrors the prototype's bordered feed zone. Mobile:
  // normal flow within the stacked layout.
  const paneStyle: CSSProperties = isMobile
    ? { display: "flex", flexDirection: "column", gap: spacing[4] }
    : {
        display: "flex",
        flexDirection: "column",
        gap: spacing[4],
        position: "sticky",
        top: spacing[3],
        maxHeight: "calc(100vh - 220px)",
        overflowY: "auto",
        paddingRight: spacing[3],
        borderRight: `1px solid ${colors.border}`
      };
  return (
    <div style={paneStyle}>
      {/* Sticky symbol search — pinned to the top of the feed zone. */}
      <div
        style={{
          position: isMobile ? "static" : "sticky",
          top: 0,
          zIndex: 6,
          background: colors.background,
          paddingBottom: spacing[3],
          borderBottom: `1px solid ${colors.border}`
        }}
      >
        <SymbolSearch
          placeholder="Look up any symbol…"
          onPick={onOpenSymbol}
          colors={colors}
          width="100%"
          hint="See where any ticker stands — even if it's not on the desk yet."
        />
      </div>
      {feedEnvironment ? (
        <MarketEnvironmentStrip environment={feedEnvironment} testId="trading-room-environment-strip" />
      ) : null}
      {showDay &&
      dayEnvironment &&
      swingEnvironment &&
      dayEnvironment.environment_tier !== swingEnvironment.environment_tier ? (
        <p className="m-0 text-[11px] leading-snug" style={{ color: colors.textMuted }}>
          Day desk: {dayEnvironment.headline}
        </p>
      ) : null}
      {showDay ? (
        <FeedLaneSection
          title="Day"
          count={day.length}
          cards={day}
          selectedId={selectedId}
          onSelect={onSelect}
          colors={colors}
          environment={dayEnvironment}
        />
      ) : null}
      <FeedLaneSection
        title="Swing"
        count={swing.length}
        cards={swing}
        selectedId={selectedId}
        onSelect={onSelect}
        colors={colors}
        staleLabel={staleDateLabel}
        environment={swingEnvironment}
      />
      {empty ? (
        deskEmpty || isWeekend ? (
          <>
            {isWeekend && deskEmpty ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: spacing[2],
                  padding: spacing[3],
                  borderRadius: 8,
                  border: `1px solid #c04cf533`,
                  background: "#c04cf50d"
                }}
              >
                <span style={{ fontSize: typography.scale.xs, color: "#c04cf5", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Weekend · Markets closed
                </span>
                <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
                  Friday&apos;s swing signals will appear here once the desk cache refreshes. Your existing watchlist and signal deep dives are still accessible.
                </span>
              </div>
            ) : null}
            {!deskEmpty || (swingDeskData || dayDeskData) ? (
              <QuietFeed
                swingDesk={swingDeskData}
                dayDesk={dayDeskData}
                showDay={showDay}
                snapshotsBySymbol={snapshotsBySymbol}
                companyBySymbol={companyBySymbol}
                selectedId={selectedId}
                onSelectCard={onSelectCard}
                colors={colors}
              />
            ) : null}
          </>
        ) : (
          <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
            No setups match the current filters. Try widening the filters above — the desk has names in other lanes.
          </p>
        )
      ) : null}
    </div>
  );
}

function FeedLaneSection({
  title,
  count,
  cards,
  selectedId,
  onSelect,
  colors,
  staleLabel = null,
  environment = null
}: {
  title: string;
  count: number;
  cards: FeedCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  /** When non-null, shown beside the count as a staleness badge (e.g. "Fri Jun 6 close"). */
  staleLabel?: string | null;
  environment?: MarketEnvironmentPayload | null;
}) {
  if (cards.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      {/* Section label + count + optional staleness badge + divider rule. */}
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
        <span
          style={{
            fontSize: 10.5,
            color: colors.textMuted,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            whiteSpace: "nowrap"
          }}
        >
          {title} <span style={{ color: colors.text, fontWeight: 600 }}>{count}</span>
        </span>
        {staleLabel ? (
          <span
            style={{
              fontSize: 10,
              color: "#c04cf5",
              background: "#c04cf51a",
              border: "1px solid #c04cf533",
              borderRadius: 999,
              padding: "1px 8px",
              whiteSpace: "nowrap",
              fontWeight: 600,
              letterSpacing: "0.08em"
            }}
          >
            {staleLabel} close
          </span>
        ) : null}
        <span style={{ flex: 1, height: 1, background: colors.border }} />
      </div>
      {cards.map((card) => (
        <SignalCard
          key={card.id}
          card={card}
          active={card.id === selectedId}
          onSelect={onSelect}
          colors={colors}
          staleDate={staleLabel}
          environmentHint={environmentSessionCardHint(environment, card.lane, card.state)}
        />
      ))}
    </div>
  );
}

function biasPillStyle(bias: FeedBias, colors: ReturnType<typeof useTheme>["colors"]): CSSProperties {
  const tone = bias === "bull" ? colors.bullish : bias === "bear" ? colors.bearish : colors.textMuted;
  return {
    display: "inline-block",
    fontSize: typography.scale.xs,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: tone,
    background: `${tone}1f`,
    padding: "2px 8px",
    borderRadius: borderRadius.full
  };
}

function stateTone(state: FeedState, colors: ReturnType<typeof useTheme>["colors"]): string {
  if (state === "actionable") return colors.bullish;
  if (state === "near") return colors.caution;
  if (state === "cooling") return colors.bearish;
  return colors.textMuted;
}

function SignalCard({
  card,
  active,
  onSelect,
  colors,
  staleDate = null,
  environmentHint = null
}: {
  card: FeedCard;
  active: boolean;
  onSelect: (id: string) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  /** When non-null, this card's price data is from a prior day — shown as a small badge. */
  staleDate?: string | null;
  /** Layer 0 ledger policy hint for actionable/near cards in elevated/stressed sessions. */
  environmentHint?: string | null;
}) {
  const laneAccent =
    card.lane === "day" ? roleAccents.dark.day.borderAccent : roleAccents.dark.swing.borderAccent;
  const sTone = stateTone(card.state, colors);
  const pct = card.changePct;
  const pctTone = pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
  return (
    <button
      type="button"
      onClick={() => onSelect(card.id)}
      style={{
        textAlign: "left",
        background: active ? colors.surfaceMuted : colors.surface,
        border: `1px solid ${active ? colors.accent : colors.border}`,
        borderLeft: `3px solid ${laneAccent}`,
        borderBottom: `3px solid ${sTone}`,
        borderRadius: borderRadius.md,
        padding: spacing[3],
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: spacing[1],
        opacity: card.state === "cooling" ? 0.7 : 1
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: spacing[2] }}>
        <span style={{ fontSize: typography.scale.base, fontWeight: 700 }}>{card.symbol}</span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: pctTone }}>{fmtPrice(card.price)}</span>
          {pct != null ? (
            <span style={{ fontSize: typography.scale.xs, color: pctTone }}>
              {fmtPct(pct)}
              {staleDate ? <span style={{ color: colors.textMuted, fontWeight: 400 }}> {staleDate.slice(0, 3).toLowerCase()}</span> : null}
            </span>
          ) : null}
        </span>
      </div>
      {card.company ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{card.company}</span>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2], marginTop: 2 }}>
        <span style={biasPillStyle(card.bias, colors)}>
          {card.bias === "bull" ? "Bullish" : card.bias === "bear" ? "Bearish" : "Neutral"}
        </span>
        <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: sTone }}>{STATE_LABEL[card.state]}</span>
      </div>
      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.4 }}>{card.verdict}</span>
      {environmentHint ? (
        <span
          data-testid={`signal-card-environment-hint-${card.symbol}`}
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: colors.caution,
            lineHeight: 1.35
          }}
        >
          {environmentHint}
        </span>
      ) : null}
      {staleDate ? (
        <span style={{ fontSize: 10, color: "#c04cf5", marginTop: 2 }}>
          from {staleDate} · valid through weekend
        </span>
      ) : null}
    </button>
  );
}

