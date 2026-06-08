/**
 * A Lightweight-Charts v5 series primitive that fills a horizontal price band
 * (e.g. the signal "entry zone" or the swing range) across the full width of
 * the pane. The library has no native filled-band-between-two-levels series,
 * so we draw it ourselves in the background layer (behind the candles).
 *
 * Structural typing only — we never statically import from "lightweight-charts"
 * here, so this file stays compatible with the dynamic import used by the chart
 * component and doesn't couple the bundle to the library's type surface.
 */

interface BandSeries {
  priceToCoordinate(price: number): number | null;
}

interface BandAttachParam {
  series: BandSeries;
  requestUpdate?: () => void;
}

interface MediaScope {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}

interface BitmapTarget {
  useMediaCoordinateSpace(cb: (scope: MediaScope) => void): void;
}

export interface HorizontalBandOptions {
  low: number;
  high: number;
  /** Fill color (use rgba with low alpha so candles read through). */
  fill: string;
  /** Optional hairline color for the top/bottom edges of the band. */
  edge?: string;
}

/**
 * Build an attachable primitive. Usage:
 *   const band = createHorizontalBand({ low, high, fill });
 *   series.attachPrimitive(band);
 *   // later: series.detachPrimitive(band);
 */
export function createHorizontalBand(options: HorizontalBandOptions) {
  let series: BandSeries | null = null;

  // `draw` is REQUIRED by Lightweight-Charts v5 (drawBackground alone throws in
  // the render loop). With zOrder "bottom" this paints beneath the candles.
  const renderer = {
    draw(target: BitmapTarget) {
      if (!series) return;
      target.useMediaCoordinateSpace((scope) => {
        if (!series) return;
        const yHigh = series.priceToCoordinate(options.high);
        const yLow = series.priceToCoordinate(options.low);
        if (yHigh == null || yLow == null) return;
        const top = Math.min(yHigh, yLow);
        const bottom = Math.max(yHigh, yLow);
        const { context: ctx, mediaSize } = scope;
        ctx.save();
        ctx.fillStyle = options.fill;
        ctx.fillRect(0, top, mediaSize.width, bottom - top);
        if (options.edge) {
          ctx.strokeStyle = options.edge;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, top + 0.5);
          ctx.lineTo(mediaSize.width, top + 0.5);
          ctx.moveTo(0, bottom - 0.5);
          ctx.lineTo(mediaSize.width, bottom - 0.5);
          ctx.stroke();
        }
        ctx.restore();
      });
    }
  };

  const paneView = {
    renderer: () => renderer,
    zOrder: () => "bottom" as const
  };

  return {
    attached(param: BandAttachParam) {
      series = param.series;
    },
    detached() {
      series = null;
    },
    updateAllViews() {
      /* band is static; nothing to recompute */
    },
    paneViews() {
      return [paneView];
    }
  };
}

export type HorizontalBand = ReturnType<typeof createHorizontalBand>;
