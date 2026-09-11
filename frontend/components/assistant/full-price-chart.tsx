"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { AssistantChartLevel } from "@/lib/assistant/types";
import {
  ema,
  fiftyTwoWeek,
  highLow,
  openingRange,
  sessionRange,
  sessionVwap,
  sma,
  type IndicatorBar
} from "@/lib/charts/indicators";
import { createHorizontalBand } from "@/lib/charts/horizontal-band";
import {
  MIN_VISIBLE,
  defaultTimeframe,
  fetchLimitFor,
  isIntradayTf,
  visibleBarsFor,
  type ChartMode,
  type ChartTimeframe
} from "@/lib/charts/chart-config";

/**
 * Rich, interactive trading chart powered by TradingView's `lightweight-charts`
 * (v5, MIT, ~40 KB, lazy-loaded). It renders two purpose-built layouts driven
 * entirely by our own Polygon data + signal payload, so the chart can never
 * contradict the signal card:
 *
 *  • Day desk  (`mode="day"`):  5-min candles, session VWAP curve, EMA 9/20,
 *    opening-range high/low, entry-zone band, stop & target lines.
 *  • Swing desk (`mode="swing"`): daily candles, SMA 20/50/200, swing-range band,
 *    52-week high/low, entry-zone band, stop & target lines.
 *
 * A timeframe switcher (1m/5m/15m/1h · 1D/1W), overlay toggles (persisted), and a
 * key-levels grid round out the desk experience. When `mode` is omitted the
 * component renders the original lightweight chart (single timeframe, SMA-50 on
 * daily, reference-level lines) so existing call sites keep working unchanged.
 */

// Chart timeframe / mode types + tunable fetch/viewport constants now live in
// the pure, testable `@/lib/charts/chart-config` module. Re-exported here so
// existing importers (deep-dive, signals-page-client, assistant rail) are
// unchanged.
export type { ChartTimeframe, ChartMode } from "@/lib/charts/chart-config";

/** Signal-engine levels overlaid on the chart (all optional). */
export interface ChartSignalOverlay {
  entryZone?: { low: number; high: number } | null;
  swingRange?: { low: number; high: number } | null;
  stop?: number | null;
  target1?: number | null;
  target2?: number | null;
  prevClose?: number | null;
}

interface FullPriceChartProps {
  symbol: string;
  colors: ThemeColors;
  levels?: AssistantChartLevel[];
  /** Candle interval. Back-compat: "1day"/"1hour" still accepted. */
  timeframe?: ChartTimeframe;
  /** Bars to request (defaults chosen per timeframe). */
  limit?: number;
  height?: number;
  /** Live/last price for the labeled "Current" line. */
  currentPrice?: number | null;
  /** Desk mode — enables the rich layout, indicators, overlays and grid. */
  mode?: ChartMode;
  /** Signal-engine levels for the overlay band + stop/target lines. */
  signal?: ChartSignalOverlay;
  /** Show the timeframe switcher + overlay legend toggles. Defaults on in mode. */
  showToolbar?: boolean;
  /** Show the key-levels grid below the chart. Defaults on in mode. */
  showKeyLevels?: boolean;
}

type BarTime = { year: number; month: number; day: number } | number;

interface OhlcBar {
  time: BarTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Indicator / overlay palette (consistent across both desks) ──────────────
const COLOR = {
  vwap: "#f59e0b", // orange
  ema9: "#3b82f6", // blue
  ema20: "#8b5cf6", // purple
  sma20: "#3b82f6", // blue
  sma50: "#8b5cf6", // purple
  sma100: "#10b981", // teal (long-term only)
  sma200: "#f59e0b", // orange
  orb: "#f59e0b", // amber dashed (opening range)
  entryFill: "rgba(59,130,246,0.12)",
  entryEdge: "rgba(59,130,246,0.45)",
  swingFill: "rgba(139,92,246,0.10)",
  swingEdge: "rgba(139,92,246,0.40)"
} as const;

const DASHED = 2; // LineStyle.Dashed
const SOLID = 0; // LineStyle.Solid

const TIMEFRAMES: Record<ChartMode, { id: ChartTimeframe; label: string }[]> = {
  day: [
    { id: "1min", label: "1m" },
    { id: "5min", label: "5m" },
    { id: "15min", label: "15m" },
    { id: "1hour", label: "1h" }
  ],
  swing: [
    { id: "1min", label: "1m" },
    { id: "5min", label: "5m" },
    { id: "1hour", label: "1h" },
    { id: "1day", label: "1D" },
    { id: "1week", label: "1W" }
  ],
  // Long-term desk: daily / weekly / monthly only (no intraday noise).
  position: [
    { id: "1day", label: "1D" },
    { id: "1week", label: "1W" },
    { id: "1month", label: "1M" }
  ]
};

/**
 * Session-scoped bars cache, keyed by `symbol:timeframe`. Lives at MODULE scope
 * (not in a component ref) so it survives the chart unmounting when the user
 * leaves the Charts tab — switching Setup/Charts or Day/Swing and back renders
 * instantly from cache instead of refetching Polygon. Capped FIFO so memory
 * can't grow unbounded over a long session.
 */
const BARS_CACHE = new Map<string, OhlcBar[]>();
const BARS_CACHE_CAP = 32;
function cacheGet(key: string): OhlcBar[] | undefined {
  return BARS_CACHE.get(key);
}
function cacheSet(key: string, bars: OhlcBar[]): void {
  if (BARS_CACHE.has(key)) BARS_CACHE.delete(key);
  BARS_CACHE.set(key, bars);
  while (BARS_CACHE.size > BARS_CACHE_CAP) {
    const oldest = BARS_CACHE.keys().next().value;
    if (oldest === undefined) break;
    BARS_CACHE.delete(oldest);
  }
}

function defaultOverlays(mode: ChartMode): Record<string, boolean> {
  if (mode === "day") return { vwap: true, ema9: true, ema20: true, levels: true };
  if (mode === "position") return { sma50: true, sma100: true, sma200: true, levels: true };
  return { sma20: true, sma50: true, sma200: true, levels: true };
}

function levelColor(kind: AssistantChartLevel["kind"], colors: ThemeColors): string {
  switch (kind) {
    case "support":
      return colors.bullish;
    case "resistance":
      return colors.bearish ?? colors.textMuted;
    case "target":
      return colors.caution ?? colors.accent;
    case "target_high":
      return colors.bullish;
    case "target_low":
      return colors.bearish ?? colors.textMuted;
    case "vwap":
      return colors.accent;
    case "sma50":
      return "#8b5cf6";
    case "prev_close":
    default:
      return colors.textMuted;
  }
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}

function fmtRange(lo: number | null | undefined, hi: number | null | undefined): string {
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return "—";
  return `${fmtMoney(lo)}–${fmtMoney(hi)}`;
}

interface GridStats {
  vwap: number | null;
  orHigh: number | null;
  orLow: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  weekHigh: number | null;
  weekLow: number | null;
  swingLow: number | null;
  swingHigh: number | null;
  candleCount: number;
}

const EMPTY_STATS: GridStats = {
  vwap: null,
  orHigh: null,
  orLow: null,
  sessionHigh: null,
  sessionLow: null,
  sma20: null,
  sma50: null,
  sma100: null,
  sma200: null,
  weekHigh: null,
  weekLow: null,
  swingLow: null,
  swingHigh: null,
  candleCount: 0
};

export function FullPriceChart({
  symbol,
  colors,
  levels = [],
  timeframe,
  limit,
  height = 280,
  currentPrice = null,
  mode,
  signal,
  showToolbar,
  showKeyLevels
}: FullPriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [stats, setStats] = useState<GridStats>(EMPTY_STATS);

  const rich = mode != null;
  const toolbarOn = showToolbar ?? rich;
  const gridOn = showKeyLevels ?? rich;

  // Active timeframe (switcher). Seeded from the explicit prop or the mode default.
  const [tf, setTf] = useState<ChartTimeframe>(() => defaultTimeframe(mode, timeframe));
  // When the desk mode flips (Day↔Swing) reset to that mode's default resolution
  // so Day→Swing goes 5-min→daily (not "stick on 5-min" just because Swing's
  // switcher also offers it). An explicit `timeframe` prop still wins.
  useEffect(() => {
    setTf(defaultTimeframe(mode, timeframe));
  }, [mode, timeframe]);

  // Overlay visibility toggles (persisted per mode in localStorage).
  const [overlays, setOverlays] = useState<Record<string, boolean>>(() => {
    if (!mode) return {};
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(`stocvest:chart-overlays:${mode}`);
        if (raw) return { ...defaultOverlays(mode), ...JSON.parse(raw) };
      } catch {
        /* ignore */
      }
    }
    return defaultOverlays(mode);
  });
  const toggleOverlay = (key: string) => {
    setOverlays((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (mode && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(`stocvest:chart-overlays:${mode}`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  };

  const intraday = isIntradayTf(tf);
  const effectiveLimit = limit ?? fetchLimitFor(mode, tf);
  const livePrice =
    typeof currentPrice === "number" && Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null;

  const levelsKey = useMemo(() => levels.map((l) => `${l.kind}:${l.value}`).join("|"), [levels]);
  const signalKey = useMemo(
    () =>
      signal
        ? [
            signal.entryZone?.low,
            signal.entryZone?.high,
            signal.swingRange?.low,
            signal.swingRange?.high,
            signal.stop,
            signal.target1,
            signal.target2,
            signal.prevClose
          ].join(":")
        : "",
    [signal]
  );
  const overlayKey = useMemo(() => JSON.stringify(overlays), [overlays]);

  useEffect(() => {
    let disposed = false;
    let chart: {
      remove: () => void;
      applyOptions: (o: unknown) => void;
      timeScale: () => { fitContent: () => void };
    } | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function build() {
      const container = containerRef.current;
      if (!container) return;

      const cacheKey = `${symbol}:${tf}`;
      let bars = cacheGet(cacheKey);
      if (!bars) {
        try {
          const res = await fetch(
            `/api/stocvest/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&limit=${effectiveLimit}`,
            { method: "GET" }
          );
          const data = await res.json().catch(() => null);
          const rows: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.bars) ? data.bars : [];
          let parsed = rows.map((r) => toOhlcBar(r, intraday)).filter((b): b is OhlcBar => b !== null);
          // Intraday: strip pre-market / after-hours so we only show 9:30–4:00 ET.
          if (intraday) {
            parsed = parsed.filter((b) => isRegularSessionBar(b.time as number));
          }
          bars = parsed;
          cacheSet(cacheKey, parsed);
        } catch {
          if (!disposed) setStatus("error");
          return;
        }
      }

      if (disposed) return;
      if (bars.length < 2) {
        setStatus("empty");
        setStats({ ...EMPTY_STATS });
        return;
      }

      const indicatorBars: IndicatorBar[] = bars.map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume
      }));

      let lib: typeof import("lightweight-charts");
      try {
        lib = await import("lightweight-charts");
      } catch {
        if (!disposed) setStatus("error");
        return;
      }
      if (disposed || !containerRef.current) return;

      const { createChart, CandlestickSeries, HistogramSeries, LineSeries } = lib;

      chart = createChart(container, {
        height,
        width: container.clientWidth || 320,
        layout: {
          attributionLogo: true,
          background: { color: "transparent" },
          textColor: colors.textMuted,
          fontSize: 11
        },
        grid: {
          vertLines: { color: `${colors.border}55` },
          horzLines: { color: `${colors.border}55` }
        },
        rightPriceScale: { borderColor: colors.border },
        timeScale: { borderColor: colors.border, timeVisible: intraday },
        crosshair: { mode: 1 }
      }) as unknown as typeof chart;

      const chartApi = chart as unknown as {
        addSeries: (def: unknown, opts?: unknown) => {
          setData: (d: unknown) => void;
          createPriceLine: (o: unknown) => void;
          priceScale: () => { applyOptions: (o: unknown) => void };
          attachPrimitive?: (p: unknown) => void;
        };
        timeScale: () => {
          fitContent: () => void;
          getVisibleLogicalRange: () => { from: number; to: number } | null;
          setVisibleLogicalRange: (range: { from: number; to: number }) => void;
        };
      };

      const candles = chartApi.addSeries(CandlestickSeries, {
        upColor: colors.bullish,
        downColor: colors.bearish ?? "#ef4444",
        borderVisible: false,
        wickUpColor: colors.bullish,
        wickDownColor: colors.bearish ?? "#ef4444",
        priceLineVisible: false,
        lastValueVisible: livePrice == null
      });
      candles.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));

      // Volume histogram pinned to the bottom on its own overlay scale.
      const volume = chartApi.addSeries(HistogramSeries, {
        priceScaleId: "",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false
      });
      volume.setData(
        bars.map((b) => ({
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? `${colors.bullish}66` : `${colors.bearish ?? "#ef4444"}66`
        }))
      );
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const addLine = (color: string, data: { time: BarTime; value: number }[], width = 1) => {
        if (data.length === 0) return;
        const s = chartApi.addSeries(LineSeries, {
          color,
          lineWidth: width,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false
        });
        s.setData(data);
      };

      // ── Moving averages / VWAP ────────────────────────────────────────────
      if (rich && mode === "day") {
        if (overlays.vwap && intraday) addLine(COLOR.vwap, sessionVwap(indicatorBars));
        if (overlays.ema9) addLine(COLOR.ema9, ema(indicatorBars, 9));
        if (overlays.ema20) addLine(COLOR.ema20, ema(indicatorBars, 20));
      } else if (rich && mode === "swing") {
        if (overlays.sma20) addLine(COLOR.sma20, sma(indicatorBars, 20));
        if (overlays.sma50) addLine(COLOR.sma50, sma(indicatorBars, 50));
        if (overlays.sma200) addLine(COLOR.sma200, sma(indicatorBars, 200));
      } else if (rich && mode === "position") {
        // Long-term MAs (50/100/200) in bars of the active timeframe. On a
        // short-history symbol the longer ones simply don't draw (sma() → []).
        if (overlays.sma50) addLine(COLOR.sma50, sma(indicatorBars, 50));
        if (overlays.sma100) addLine(COLOR.sma100, sma(indicatorBars, 100));
        if (overlays.sma200) addLine(COLOR.sma200, sma(indicatorBars, 200), 2);
      } else if (!rich && !intraday && indicatorBars.length >= 20) {
        // Legacy behaviour: 50-day average on the daily chart.
        addLine("#8b5cf6", sma(indicatorBars, Math.min(50, indicatorBars.length)));
      }

      // ── Signal overlay bands (entry zone, swing range) ───────────────────
      const showSignalLevels = !rich || overlays.levels;
      if (rich && showSignalLevels && typeof candles.attachPrimitive === "function") {
        if (signal?.entryZone && signal.entryZone.high > signal.entryZone.low) {
          candles.attachPrimitive(
            createHorizontalBand({
              low: signal.entryZone.low,
              high: signal.entryZone.high,
              fill: COLOR.entryFill,
              edge: COLOR.entryEdge
            })
          );
        }
        if (mode === "swing" && signal?.swingRange && signal.swingRange.high > signal.swingRange.low) {
          candles.attachPrimitive(
            createHorizontalBand({
              low: signal.swingRange.low,
              high: signal.swingRange.high,
              fill: COLOR.swingFill,
              edge: COLOR.swingEdge
            })
          );
        }
      }

      // ── Legacy reference-level lines (kept for non-mode callers) ─────────
      if (!rich) {
        for (const l of levels) {
          if (!Number.isFinite(l.value)) continue;
          if (l.kind === "sma50" && !intraday) continue;
          candles.createPriceLine({
            price: l.value,
            color: levelColor(l.kind, colors),
            lineWidth: 1,
            lineStyle: DASHED,
            axisLabelVisible: false,
            title: l.label
          });
        }
      }

      // ── Signal stop / target / prev-close / ORB lines ────────────────────
      if (rich && showSignalLevels) {
        const priceLine = (price: number | null | undefined, color: string, style: number, title: string) => {
          if (price == null || !Number.isFinite(price)) return;
          candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: false, title });
        };
        priceLine(signal?.stop, colors.bearish ?? "#ef4444", DASHED, "Stop");
        priceLine(signal?.target1, colors.bullish, SOLID, "T1");
        priceLine(signal?.target2, colors.bullish, SOLID, "T2");
        priceLine(signal?.prevClose, colors.textMuted, DASHED, "Prev close");
        if (mode === "position") {
          // Long-term structural S/R: the 52-week ceiling/floor (where a multi-year
          // thesis is confirmed / breaks) drawn from the same range the grid shows.
          const yr = sessionRange(
            indicatorBars,
            tf === "1month" ? 12 : tf === "1week" ? 52 : 252
          );
          priceLine(yr?.high, COLOR.sma200, DASHED, "52W High");
          priceLine(yr?.low, colors.textMuted, DASHED, "52W Low");
        }
        if (mode === "day") {
          const or = openingRange(indicatorBars, 30);
          if (or) {
            priceLine(or.high, COLOR.orb, DASHED, "ORH");
            priceLine(or.low, COLOR.orb, DASHED, "ORL");
          }
        }
      }

      // Live "current price" marker.
      if (livePrice != null) {
        candles.createPriceLine({
          price: livePrice,
          color: colors.text,
          lineWidth: 1,
          lineStyle: SOLID,
          axisLabelVisible: true,
          title: "Current"
        });
      }

      // ── Visible range ────────────────────────────────────────────────────
      const tScale = chartApi.timeScale();
      tScale.fitContent();
      const wantVisible = rich && !intraday ? visibleBarsFor(mode, tf) : null;
      if (wantVisible != null) {
        // Narrow the viewport (swing ≈6mo; long-term multi-year per timeframe)
        // while keeping the full fetched set — with warmup — loaded so the MAs
        // and 52-week stat stay valid across the whole visible window.
        const range = tScale.getVisibleLogicalRange();
        if (range && range.to - range.from > wantVisible) {
          tScale.setVisibleLogicalRange({ from: range.to - wantVisible, to: range.to + 1 });
        }
      } else if (intraday) {
        const minBars = MIN_VISIBLE[tf] ?? 20;
        const range = tScale.getVisibleLogicalRange();
        if (range && range.to - range.from < minBars) {
          tScale.setVisibleLogicalRange({ from: range.to - minBars, to: range.to + 1 });
        }
      }

      // ── Key-levels grid stats ────────────────────────────────────────────
      if (gridOn) {
        const vwapCurve = intraday ? sessionVwap(indicatorBars) : [];
        const lastVwap = vwapCurve.length ? vwapCurve[vwapCurve.length - 1].value : null;
        const sma20Pts = sma(indicatorBars, 20);
        const sma50Pts = sma(indicatorBars, 50);
        const sma100Pts = sma(indicatorBars, 100);
        const sma200Pts = sma(indicatorBars, 200);
        const or = mode === "day" ? openingRange(indicatorBars, 30) : null;
        // 52-week high/low. Daily uses the 252-bar helper; the long-term desk
        // is timeframe-aware (52 weekly / 12 monthly bars = one year).
        const week =
          mode === "swing"
            ? fiftyTwoWeek(indicatorBars)
            : mode === "position"
              ? sessionRange(indicatorBars, tf === "1month" ? 12 : tf === "1week" ? 52 : 252)
              : null;
        const swingR =
          signal?.swingRange ?? (mode === "swing" ? sessionRange(indicatorBars, 10) : null);
        const sessionHL = highLow(intraday ? lastSessionBars(indicatorBars) : indicatorBars.slice(-1));
        setStats({
          vwap: lastVwap,
          orHigh: or?.high ?? null,
          orLow: or?.low ?? null,
          sessionHigh: sessionHL?.high ?? null,
          sessionLow: sessionHL?.low ?? null,
          sma20: sma20Pts.length ? sma20Pts[sma20Pts.length - 1].value : null,
          sma50: sma50Pts.length ? sma50Pts[sma50Pts.length - 1].value : null,
          sma100: sma100Pts.length ? sma100Pts[sma100Pts.length - 1].value : null,
          sma200: sma200Pts.length ? sma200Pts[sma200Pts.length - 1].value : null,
          weekHigh: week?.high ?? null,
          weekLow: week?.low ?? null,
          swingLow: swingR?.low ?? null,
          swingHigh: swingR?.high ?? null,
          candleCount: bars.length
        });
      } else {
        setStats((s) => ({ ...s, candleCount: bars!.length }));
      }

      setStatus("ready");

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (chart && containerRef.current) {
            chart.applyOptions({ width: containerRef.current.clientWidth });
          }
        });
        resizeObserver.observe(container);
      }
    }

    setStatus("loading");
    void build();

    return () => {
      disposed = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (chart) {
        try {
          chart.remove();
        } catch {
          /* already disposed */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, levelsKey, signalKey, overlayKey, height, intraday, effectiveLimit, mode, rich, gridOn, colors, livePrice]);

  const tfOptions = mode ? TIMEFRAMES[mode] : [];

  return (
    <div style={{ display: "grid", gap: spacing[2] }}>
      {rich ? (
        <ChartHeaderPills mode={mode!} symbol={symbol} tf={tf} candleCount={stats.candleCount} colors={colors} />
      ) : null}

      {toolbarOn && mode ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing[2],
            flexWrap: "wrap"
          }}
        >
          {/* Timeframe switcher */}
          <div style={{ display: "inline-flex", gap: 2, background: colors.surfaceMuted, borderRadius: borderRadius.md, padding: 2 }}>
            {tfOptions.map((o) => {
              const active = o.id === tf;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setTf(o.id)}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    fontSize: typography.scale.xs,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: borderRadius.sm,
                    background: active ? colors.accent : "transparent",
                    color: active ? "#fff" : colors.textMuted
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {/* Overlay legend toggles */}
          <div style={{ display: "inline-flex", gap: spacing[1], flexWrap: "wrap" }}>
            {legendItems(mode).map((it) => {
              const on = overlays[it.key] !== false;
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => toggleOverlay(it.key)}
                  title={on ? `Hide ${it.label}` : `Show ${it.label}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    border: `1px solid ${colors.border}`,
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: typography.scale.xs,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: borderRadius.full,
                    color: on ? colors.text : colors.textMuted,
                    opacity: on ? 1 : 0.5
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: it.color,
                      display: "inline-block"
                    }}
                  />
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div style={{ position: "relative", minHeight: height }}>
        <div ref={containerRef} style={{ width: "100%", minHeight: height }} />
        {status === "loading" ? <ChartSkeleton height={height} colors={colors} /> : null}
      </div>

      {status === "empty" ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          Not enough price history to chart {symbol} right now.
        </span>
      ) : null}
      {status === "error" ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Couldn&apos;t load the chart right now.</span>
      ) : null}

      {gridOn && mode && status === "ready" ? (
        <KeyLevelsGrid mode={mode} stats={stats} signal={signal} colors={colors} />
      ) : null}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * Shimmer placeholder shown while Polygon candle data is fetching — a row of
 * candle-shaped bars + a volume strip, not a spinner, so the layout doesn't
 * jump when the real chart swaps in. Reuses the `stocvest-skeleton` keyframes.
 */
function ChartSkeleton({ height, colors }: { height: number; colors: ThemeColors }) {
  const shimmer =
    "linear-gradient(90deg, rgba(148,163,184,0.06) 0%, rgba(148,163,184,0.18) 40%, rgba(148,163,184,0.06) 80%)";
  // Deterministic pseudo-random heights so SSR/CSR match and it reads as candles.
  const candleHeights = [55, 38, 70, 46, 62, 30, 78, 52, 44, 66, 35, 72, 50, 60, 42, 68, 33, 58, 48, 64];
  const priceH = Math.round(height * 0.74);
  const volH = Math.round(height * 0.18);
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        gap: 6,
        padding: "8px 4px",
        pointerEvents: "none"
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: priceH }}>
        {candleHeights.map((h, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${h}%`,
              borderRadius: 2,
              background: shimmer,
              backgroundSize: "200% 100%",
              animation: "stocvest-skeleton 1.8s ease-in-out infinite"
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: volH }}>
        {candleHeights.map((h, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(20, h * 0.6)}%`,
              borderRadius: 2,
              background: shimmer,
              backgroundSize: "200% 100%",
              animation: "stocvest-skeleton 1.8s ease-in-out infinite"
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, textAlign: "center" }}>
        Loading chart…
      </span>
    </div>
  );
}

function ChartHeaderPills({
  mode,
  symbol,
  tf,
  candleCount,
  colors
}: {
  mode: ChartMode;
  symbol: string;
  tf: ChartTimeframe;
  candleCount: number;
  colors: ThemeColors;
}) {
  const deskColor = mode === "day" ? "#2e8bff" : mode === "position" ? "#f59e0b" : "#8b5cf6";
  const deskName = mode === "day" ? "Day" : mode === "position" ? "Long Term" : "Swing";
  const deskTag = mode === "day" ? "Day trade" : mode === "position" ? "Long-term hold" : "Swing trade";
  const lookback =
    mode === "day"
      ? "9:30 AM – 4:00 PM ET"
      : mode === "position"
        ? tf === "1month"
          ? "~10-year lookback"
          : tf === "1week"
            ? "~3-year lookback"
            : "~2-year lookback"
        : "6-month lookback";
  const pill = (text: string) => (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: colors.textMuted,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.full,
        padding: "2px 8px",
        whiteSpace: "nowrap"
      }}
    >
      {text}
    </span>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[2], flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
        <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text }}>
          {symbol} — {deskName} desk
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: deskColor,
            background: `${deskColor}22`,
            border: `1px solid ${deskColor}55`,
            borderRadius: borderRadius.full,
            padding: "2px 8px"
          }}
        >
          {deskTag}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: spacing[1], flexWrap: "wrap" }}>
        {pill(lookback)}
        {pill(`${candleCount} candles`)}
        {pill("Polygon.io")}
      </div>
    </div>
  );
}

function legendItems(mode: ChartMode): { key: string; label: string; color: string }[] {
  if (mode === "day") {
    return [
      { key: "vwap", label: "VWAP", color: COLOR.vwap },
      { key: "ema9", label: "EMA 9", color: COLOR.ema9 },
      { key: "ema20", label: "EMA 20", color: COLOR.ema20 },
      { key: "levels", label: "Levels", color: COLOR.entryEdge }
    ];
  }
  if (mode === "position") {
    return [
      { key: "sma50", label: "SMA 50", color: COLOR.sma50 },
      { key: "sma100", label: "SMA 100", color: COLOR.sma100 },
      { key: "sma200", label: "SMA 200", color: COLOR.sma200 },
      { key: "levels", label: "Levels", color: COLOR.swingEdge }
    ];
  }
  return [
    { key: "sma20", label: "SMA 20", color: COLOR.sma20 },
    { key: "sma50", label: "SMA 50", color: COLOR.sma50 },
    { key: "sma200", label: "SMA 200", color: COLOR.sma200 },
    { key: "levels", label: "Levels", color: COLOR.swingEdge }
  ];
}

function KeyLevelsGrid({
  mode,
  stats,
  signal,
  colors
}: {
  mode: ChartMode;
  stats: GridStats;
  signal?: ChartSignalOverlay;
  colors: ThemeColors;
}) {
  const cells: { label: string; value: string; tone?: string }[] =
    mode === "day"
      ? [
          { label: "VWAP", value: fmtMoney(stats.vwap), tone: COLOR.vwap },
          { label: "OR High", value: fmtMoney(stats.orHigh), tone: COLOR.orb },
          { label: "OR Low", value: fmtMoney(stats.orLow), tone: COLOR.orb },
          { label: "Session High", value: fmtMoney(stats.sessionHigh) },
          { label: "Session Low", value: fmtMoney(stats.sessionLow) },
          { label: "Prev Close", value: fmtMoney(signal?.prevClose) },
          {
            label: "Entry Zone",
            value: signal?.entryZone ? fmtRange(signal.entryZone.low, signal.entryZone.high) : "—",
            tone: COLOR.entryEdge
          },
          { label: "Stop", value: fmtMoney(signal?.stop), tone: colors.bearish ?? "#ef4444" },
          {
            label: "T1 / T2",
            value: `${fmtMoney(signal?.target1)} / ${fmtMoney(signal?.target2)}`,
            tone: colors.bullish
          }
        ]
      : mode === "position"
      ? [
          { label: "SMA 50", value: fmtMoney(stats.sma50), tone: COLOR.sma50 },
          { label: "SMA 100", value: fmtMoney(stats.sma100), tone: COLOR.sma100 },
          { label: "SMA 200", value: fmtMoney(stats.sma200), tone: COLOR.sma200 },
          { label: "52W High", value: fmtMoney(stats.weekHigh) },
          { label: "52W Low", value: fmtMoney(stats.weekLow) },
          {
            label: "Entry Zone",
            value: signal?.entryZone ? fmtRange(signal.entryZone.low, signal.entryZone.high) : "—",
            tone: COLOR.entryEdge
          },
          { label: "Stop", value: fmtMoney(signal?.stop), tone: colors.bearish ?? "#ef4444" },
          {
            label: "T1 / T2",
            value: `${fmtMoney(signal?.target1)} / ${fmtMoney(signal?.target2)}`,
            tone: colors.bullish
          }
        ]
      : [
          { label: "SMA 20", value: fmtMoney(stats.sma20), tone: COLOR.sma20 },
          { label: "SMA 50", value: fmtMoney(stats.sma50), tone: COLOR.sma50 },
          { label: "SMA 200", value: fmtMoney(stats.sma200), tone: COLOR.sma200 },
          { label: "52W High", value: fmtMoney(stats.weekHigh) },
          { label: "52W Low", value: fmtMoney(stats.weekLow) },
          {
            label: "Swing Range",
            value: fmtRange(stats.swingLow, stats.swingHigh),
            tone: COLOR.swingEdge
          },
          {
            label: "Entry Zone",
            value: signal?.entryZone ? fmtRange(signal.entryZone.low, signal.entryZone.high) : "—",
            tone: COLOR.entryEdge
          },
          { label: "Stop", value: fmtMoney(signal?.stop), tone: colors.bearish ?? "#ef4444" },
          {
            label: "T1 / T2",
            value: `${fmtMoney(signal?.target1)} / ${fmtMoney(signal?.target2)}`,
            tone: colors.bullish
          }
        ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
        gap: spacing[2],
        marginTop: spacing[1]
      }}
    >
      {cells.map((c) => (
        <div
          key={c.label}
          style={{
            background: colors.surfaceMuted,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: `${spacing[2]} ${spacing[3]}`
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              fontSize: typography.scale.sm,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: c.tone ?? colors.text,
              marginTop: 2
            }}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Bars belonging to the most recent ET session (intraday only). */
function lastSessionBars(bars: IndicatorBar[]): IndicatorBar[] {
  const intraday = bars.filter((b) => typeof b.time === "number") as (IndicatorBar & { time: number })[];
  if (intraday.length === 0) return bars;
  const keyOf = (sec: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(sec * 1000)
    );
  const lastKey = keyOf(intraday[intraday.length - 1].time);
  return intraday.filter((b) => keyOf(b.time) === lastKey);
}

function toOhlcBar(row: unknown, intraday: boolean): OhlcBar | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const ts = typeof r.timestamp === "string" ? r.timestamp : null;
  const open = Number(r.open);
  const high = Number(r.high);
  const low = Number(r.low);
  const close = Number(r.close);
  const volume = Number(r.volume ?? 0);
  if (!ts || ![open, high, low, close].every((v) => Number.isFinite(v))) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const time: BarTime = intraday
    ? Math.floor(d.getTime() / 1000)
    : { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  return { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
}

/**
 * True when a UNIX-seconds timestamp falls within NYSE regular hours
 * (9:30 AM – 4:00 PM ET), DST-aware via the America/New_York time zone.
 */
function isRegularSessionBar(unixSeconds: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  }).formatToParts(new Date(unixSeconds * 1000));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const total = h * 60 + m;
  return total >= 570 && total < 960;
}
