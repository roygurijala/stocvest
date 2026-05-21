"use client";

import { RefreshCw, X } from "lucide-react";
import { SignalsDeeplinkLink } from "@/components/nav/signals-deeplink-link";
import {
  buildWatchlistCardModel,
  type WatchlistCardModel
} from "@/lib/watchlist-decision-card-present";
import { watchlistSignalsOpenAriaLabel } from "@/lib/nav/watchlist-signals-deeplink";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import type { SnapshotPayload } from "@/lib/api/market";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  model: WatchlistCardModel;
  planMode: "swing" | "day";
  deskEvaluating?: boolean;
  onRemove: () => void;
  onRefresh?: () => void;
};

function LayerDots({ filled, total, accent }: { filled: boolean[]; total: number; accent: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums" aria-hidden>
      {filled.map((on, i) => (
        <span
          key={i}
          className="text-sm leading-none"
          style={{ color: on ? accent : "color-mix(in srgb, currentColor 35%, transparent)" }}
        >
          {on ? "●" : "○"}
        </span>
      ))}
      <span className="ml-1.5 text-xs font-medium opacity-80">
        ({filled.filter(Boolean).length}/{total})
      </span>
    </span>
  );
}

export function WatchlistDecisionCard({
  model,
  planMode,
  deskEvaluating,
  onRemove,
  onRefresh
}: Props) {
  const { colors } = useTheme();
  const peek =
    model.blockers.length > 0
      ? `Blocked: ${model.blockers.join(" · ")}`
      : model.row?.readiness_label?.trim() || model.alignmentLine;

  return (
    <SignalsDeeplinkLink
      symbol={model.symbol}
      contextRef="watchlist"
      tradingMode={planMode}
      className="group block no-underline"
      data-testid={`watchlist-decision-card-${model.symbol}`}
      aria-label={watchlistSignalsOpenAriaLabel(model.symbol)}
      title={peek ? `Quick peek: ${peek}` : undefined}
    >
      <article
        className="relative overflow-hidden rounded-xl transition hover:brightness-[1.03]"
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `3px solid ${model.borderLeft}`,
          borderBottom: `3px solid ${model.borderBottom}`,
          borderRadius: borderRadius.lg,
          padding: spacing[3]
        }}
      >
        <button
          type="button"
          className="absolute right-2 top-2 z-20 rounded-md p-1 opacity-60 transition hover:opacity-100"
          style={{ color: colors.textMuted }}
          aria-label={`Remove ${model.symbol} from watchlist`}
          data-testid={`watchlist-remove-${model.symbol}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={14} aria-hidden />
        </button>

        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pr-8">
          <span className="text-base font-bold tracking-wide" style={{ color: colors.text }}>
            {model.symbol}
          </span>
          {model.quote ? (
            <span className="ml-auto flex items-baseline gap-2 text-sm tabular-nums">
              <span style={{ color: colors.text }}>{model.quote.price}</span>
              {model.quote.pct ? (
                <span
                  style={{
                    color:
                      model.quote.bullish === true
                        ? colors.bullish
                        : model.quote.bullish === false
                          ? colors.bearish
                          : colors.textMuted
                  }}
                >
                  {model.quote.pct}
                </span>
              ) : null}
            </span>
          ) : null}
        </header>

        <div
          className="my-2 h-px w-full"
          style={{ background: `color-mix(in srgb, ${colors.border} 80%, transparent)` }}
          aria-hidden
        />

        <div className="flex flex-wrap items-center gap-2">
          <LayerDots filled={model.layerDots} total={model.total} accent={colors.accent} />
          {model.progressionBadge === "improved" ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: `color-mix(in srgb, ${colors.bullish} 18%, transparent)`, color: colors.bullish }}
              data-testid={`watchlist-badge-improved-${model.symbol}`}
            >
              Improved
            </span>
          ) : model.progressionBadge === "weakened" ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: `color-mix(in srgb, ${colors.bearish} 18%, transparent)`, color: colors.bearish }}
              data-testid={`watchlist-badge-weakened-${model.symbol}`}
            >
              Weakening
            </span>
          ) : null}
        </div>

        {model.momentumLine ? (
          <p className="m-0 mt-2 text-sm leading-snug" style={{ color: colors.text }}>
            {model.momentumLine}
          </p>
        ) : null}

        {model.blockers.length > 0 ? (
          <p className="m-0 mt-1.5 text-sm leading-snug" style={{ color: colors.caution }}>
            <span aria-hidden>⚠ </span>
            Blocked by: {model.blockers.join(" + ")}
          </p>
        ) : null}

        <p className="m-0 mt-2 text-sm" style={{ color: colors.textMuted }}>
          → Worth checking?{" "}
          <span style={{ color: model.worthChecking ? colors.bullish : colors.textMuted, fontWeight: 600 }}>
            {model.worthChecking ? "YES" : "Not yet"}
            {model.worthChecking && model.attentionTier === "check_now" ? " (close to threshold)" : ""}
          </span>
        </p>

        <p
          className="m-0 mt-2 text-sm font-semibold"
          style={{ color: colors.accent }}
          data-testid={`watchlist-decision-hint-${model.symbol}`}
        >
          <span aria-hidden>{model.decisionIcon} </span>
          {model.decisionHint}
        </p>

        <footer className="mt-3 flex items-center justify-between gap-2 border-t pt-2" style={{ borderColor: colors.border }}>
          <span
            className="text-xs"
            style={{ color: model.evaluatedStale ? colors.caution : colors.textMuted }}
            data-testid={`watchlist-evaluated-ago-${model.symbol}`}
          >
            Updated: {model.evaluatedAgo}
            {model.evaluatedStale ? " · stale" : ""}
          </span>
          {onRefresh ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition hover:opacity-80"
              style={{ color: colors.textMuted }}
              data-testid={`watchlist-refresh-${model.symbol}-${planMode}`}
              aria-label={`Refresh ${planMode} evaluation for ${model.symbol}`}
              disabled={deskEvaluating}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRefresh();
              }}
            >
              <RefreshCw size={12} className={deskEvaluating ? "animate-spin" : undefined} aria-hidden />
              <span aria-hidden>↻</span>
            </button>
          ) : null}
        </footer>
      </article>
    </SignalsDeeplinkLink>
  );
}

export function WatchlistDecisionCardFromRow({
  symbol,
  row,
  snapshot,
  planMode,
  deskEvaluating,
  onRemove,
  onRefresh
}: {
  symbol: string;
  row: WatchlistMaturationRow | undefined;
  snapshot?: SnapshotPayload;
  planMode: "swing" | "day";
  deskEvaluating?: boolean;
  onRemove: () => void;
  onRefresh?: () => void;
}) {
  const { colors } = useTheme();
  const model = buildWatchlistCardModel(symbol, row, snapshot, {
    accent: colors.accent,
    bullish: colors.bullish,
    bearish: colors.bearish,
    caution: colors.caution,
    textMuted: colors.textMuted
  });
  return (
    <WatchlistDecisionCard
      model={model}
      planMode={planMode}
      deskEvaluating={deskEvaluating}
      onRemove={onRemove}
      onRefresh={onRefresh}
    />
  );
}
