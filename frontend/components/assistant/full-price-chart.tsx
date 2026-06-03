"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ThemeColors } from "@/lib/design-system";
import { spacing, typography } from "@/lib/design-system";
import type { AssistantChartLevel } from "@/lib/assistant/types";

/**
 * Rich, interactive price chart (candlesticks + volume + 50-day average +
 * reference price lines) powered by TradingView's `lightweight-charts`.
 *
 * Design notes:
 * - The library (~35 KB) is **dynamically imported inside an effect**, so it
 *   only loads when a user actually opens a full chart — the chat stays light.
 * - Daily OHLC is fetched from the BFF `/api/stocvest/market/bars` proxy.
 * - Reference levels (VWAP, support, resistance, analyst target, 50-day) render
 *   as labeled horizontal price lines via `createPriceLine`.
 * - Reusable: drop this on the Signals/Dashboard page with the same props.
 */
interface FullPriceChartProps {
  symbol: string;
  colors: ThemeColors;
  levels?: AssistantChartLevel[];
  /** Daily bars to request (defaults to ~7 months — enough for a 50-day avg). */
  limit?: number;
  height?: number;
}

interface DailyBar {
  time: { year: number; month: number; day: number };
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function levelColor(kind: AssistantChartLevel["kind"], colors: ThemeColors): string {
  switch (kind) {
    case "support":
      return colors.bullish;
    case "resistance":
      return colors.bearish ?? colors.textMuted;
    case "target":
      return colors.caution ?? colors.accent;
    case "vwap":
      return colors.accent;
    case "sma50":
      return "#8b5cf6";
    case "prev_close":
    default:
      return colors.textMuted;
  }
}

export function FullPriceChart({ symbol, colors, levels = [], limit = 150, height = 280 }: FullPriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");

  // Stable identity for the levels so the effect doesn't re-run each render.
  const levelsKey = useMemo(
    () => levels.map((l) => `${l.kind}:${l.value}`).join("|"),
    [levels]
  );

  useEffect(() => {
    let disposed = false;
    let chart: { remove: () => void; applyOptions: (o: unknown) => void; timeScale: () => { fitContent: () => void } } | null =
      null;
    let resizeObserver: ResizeObserver | null = null;

    async function build() {
      const container = containerRef.current;
      if (!container) return;

      let bars: DailyBar[] = [];
      try {
        const res = await fetch(
          `/api/stocvest/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=1day&limit=${limit}`,
          { method: "GET" }
        );
        const data = await res.json().catch(() => null);
        const rows: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.bars) ? data.bars : [];
        bars = rows
          .map((r) => toDailyBar(r))
          .filter((b): b is DailyBar => b !== null);
      } catch {
        if (!disposed) setStatus("error");
        return;
      }

      if (disposed) return;
      if (bars.length < 2) {
        setStatus("empty");
        return;
      }

      let lib: typeof import("lightweight-charts");
      try {
        lib = await import("lightweight-charts");
      } catch {
        if (!disposed) setStatus("error");
        return;
      }
      if (disposed || !containerRef.current) return;

      const { createChart, CandlestickSeries, HistogramSeries, LineSeries } = lib;
      const DASHED_LINE_STYLE = 2; // LineStyle.Dashed

      chart = createChart(container, {
        height,
        width: container.clientWidth || 320,
        layout: {
          attributionLogo: true, // satisfies lightweight-charts attribution requirement
          background: { color: "transparent" },
          textColor: colors.textMuted,
          fontSize: 11
        },
        grid: {
          vertLines: { color: `${colors.border}55` },
          horzLines: { color: `${colors.border}55` }
        },
        rightPriceScale: { borderColor: colors.border },
        timeScale: { borderColor: colors.border, timeVisible: false },
        crosshair: { mode: 1 }
      }) as unknown as typeof chart;

      const chartApi = chart as unknown as {
        addSeries: (def: unknown, opts?: unknown) => {
          setData: (d: unknown) => void;
          createPriceLine: (o: unknown) => void;
          priceScale: () => { applyOptions: (o: unknown) => void };
        };
        timeScale: () => { fitContent: () => void };
      };

      const candles = chartApi.addSeries(CandlestickSeries, {
        upColor: colors.bullish,
        downColor: colors.bearish ?? "#ef4444",
        borderVisible: false,
        wickUpColor: colors.bullish,
        wickDownColor: colors.bearish ?? "#ef4444",
        // Keep ONE clean axis tag (the current price); drop the dotted auto
        // price line so it doesn't add to the label clutter near the top.
        priceLineVisible: false,
        lastValueVisible: true
      });
      candles.setData(
        bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }))
      );

      // Volume histogram pinned to the bottom on its own (overlay) scale. Its
      // auto last-value tag (e.g. "112.68M") collided with the price labels, so
      // it's suppressed — volume is read from the bar heights, not a number.
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
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

      // 50-day simple moving average overlay.
      const closes = bars.map((b) => b.close);
      if (closes.length >= 20) {
        const period = Math.min(50, closes.length);
        // The moving-average curve carries its own meaning; its auto last-value
        // tag duplicated the "50-day avg" reference label, so it's suppressed.
        const sma = chartApi.addSeries(LineSeries, {
          color: "#8b5cf6",
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false
        });
        const smaData: Array<{ time: DailyBar["time"]; value: number }> = [];
        for (let i = period - 1; i < bars.length; i += 1) {
          let sum = 0;
          for (let j = i - period + 1; j <= i; j += 1) sum += closes[j];
          smaData.push({ time: bars[i].time, value: sum / period });
        }
        sma.setData(smaData);
      }

      // Reference levels as dashed horizontal lines with a quiet inline label.
      // We DON'T render axis value tags here — several levels cluster within a
      // few percent and their boxes overlapped illegibly on the price scale.
      // The colour-matched legend chips above the chart carry the exact values,
      // so each line just needs an inline name to identify it.
      for (const l of levels) {
        if (!Number.isFinite(l.value)) continue;
        // The 50-day average is already drawn as its own curve above — a flat
        // line + label for it would be both redundant and misleading.
        if (l.kind === "sma50") continue;
        candles.createPriceLine({
          price: l.value,
          color: levelColor(l.kind, colors),
          lineWidth: 1,
          lineStyle: DASHED_LINE_STYLE,
          axisLabelVisible: false,
          title: l.label
        });
      }

      chartApi.timeScale().fitContent();
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
  }, [symbol, levelsKey, height, limit, colors]);

  return (
    <div data-testid="assistant-full-chart" style={{ display: "grid", gap: spacing[1] }}>
      <div ref={containerRef} style={{ width: "100%", minHeight: height }} />
      {status === "loading" ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Loading chart…</span>
      ) : null}
      {status === "empty" ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          Not enough price history to chart {symbol} right now.
        </span>
      ) : null}
      {status === "error" ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          Couldn&apos;t load the chart right now.
        </span>
      ) : null}
    </div>
  );
}

function toDailyBar(row: unknown): DailyBar | null {
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
  return {
    time: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0
  };
}
