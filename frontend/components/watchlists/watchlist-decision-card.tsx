"use client";

import { X } from "lucide-react";
import { SignalsDeeplinkLink } from "@/components/nav/signals-deeplink-link";
import {
  buildWatchlistCardModel,
  type WatchlistCardModel,
  type WatchlistRadarDeskContext
} from "@/lib/watchlist-decision-card-present";
import { watchlistSignalsOpenAriaLabel } from "@/lib/nav/watchlist-signals-deeplink";
import { WATCHLIST_EVALUATE_LINK_CLASS } from "@/lib/watchlist-interactive-styles";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import type { SnapshotPayload } from "@/lib/api/market";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  model: WatchlistCardModel;
  planMode: "swing" | "day";
  deskEvaluating?: boolean;
  justAdded?: boolean;
  compact?: boolean;
  showDeskCompare?: boolean;
  onRemove: () => void;
  onRefresh?: () => void;
  onCompareDesks?: () => void;
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
  justAdded,
  compact = false,
  showDeskCompare = false,
  onRemove,
  onRefresh,
  onCompareDesks
}: Props) {
  const { colors } = useTheme();
  const peek =
    model.blockers.length > 0
      ? `Blocked: ${model.blockers.join(" · ")}`
      : model.momentumLine || model.attentionLine || model.row?.readiness_label?.trim() || model.alignmentLine;

  return (
    <SignalsDeeplinkLink
      symbol={model.symbol}
      contextRef="watchlist"
      tradingMode={planMode}
      className="group block no-underline"
      data-testid={`watchlist-decision-card-${model.symbol}`}
      data-watchlist-card-density={compact ? "compact" : "default"}
      aria-label={watchlistSignalsOpenAriaLabel(model.symbol)}
      title={peek ? `Quick peek: ${peek}` : undefined}
    >
      <article
        className="relative overflow-hidden rounded-xl transition hover:brightness-[1.03]"
        data-card-tone={model.chromeKind}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `3px solid ${model.borderLeft}`,
          borderBottom: compact ? `1px solid ${colors.border}` : `3px solid ${model.borderBottom}`,
          borderRadius: borderRadius.lg,
          padding: compact ? spacing[2] : spacing[3]
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

        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pr-8">
          <span className="text-base font-bold tracking-wide" style={{ color: colors.text }}>
            {model.symbol}
          </span>
          {model.directionChip ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
              style={{
                color: model.directionChip.color,
                background: model.directionChip.background
              }}
              data-testid={`watchlist-direction-${model.symbol}`}
            >
              {model.directionChip.label}
            </span>
          ) : null}
          {justAdded ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: `color-mix(in srgb, ${colors.accent} 22%, transparent)`,
                color: colors.accent
              }}
              data-testid={`watchlist-badge-just-added-${model.symbol}`}
            >
              Just added
            </span>
          ) : null}
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

        {compact ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <LayerDots filled={model.layerDots} total={model.total} accent={model.dotAccent} />
            <span className="text-xs" style={{ color: colors.textMuted }}>
              {model.alignmentLine}
            </span>
          </div>
        ) : (
          <>
        <div
          className="my-2 h-px w-full"
          style={{ background: `color-mix(in srgb, ${colors.border} 80%, transparent)` }}
          aria-hidden
        />

        <div className="flex flex-wrap items-center gap-2">
          <LayerDots filled={model.layerDots} total={model.total} accent={model.dotAccent} />
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

        <p className="m-0 mt-2 text-xs font-medium tabular-nums" style={{ color: colors.textMuted }}>
          {model.alignmentLine}
        </p>

        {model.momentumLine ? (
          <p className="m-0 mt-1 text-sm leading-snug" style={{ color: colors.text }}>
            {model.momentumLine}
          </p>
        ) : null}

        {model.statusBanner ? (
          <p
            className="m-0 mt-1.5 text-sm font-medium leading-snug"
            style={{ color: colors.bearish }}
            data-testid={`watchlist-status-banner-${model.symbol}`}
          >
            {model.statusBanner}
          </p>
        ) : null}

        {model.blockers.length > 0 ? (
          <p className="m-0 mt-1.5 text-sm leading-snug" style={{ color: colors.caution }}>
            <span aria-hidden>⚠ </span>
            Blocked by: {model.blockers.join(" + ")}
          </p>
        ) : null}

        {model.conviction && model.conviction.tier !== "developing" ? (
          <p
            className="m-0 mt-2 text-xs leading-snug"
            style={{
              color: model.conviction.tone === "bullish" ? colors.bullish : colors.caution
            }}
            data-testid={`watchlist-conviction-${model.symbol}`}
          >
            {model.conviction.shortLabel} · {model.conviction.label}
            {model.conviction.tier === "b_plus" ? " (discretionary)" : ""}
          </p>
        ) : null}
          </>
        )}

        <footer
          className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t ${compact ? "mt-2 pt-1.5" : "mt-3 pt-2"}`}
          style={{ borderColor: colors.border }}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                color: model.chromeBadgeColor,
                background: model.chromeBadgeBackground
              }}
              data-testid={`watchlist-chrome-badge-${model.symbol}`}
            >
              {model.chromeBadgeLabel}
            </span>
            <span
              className="text-xs"
              style={{ color: model.evaluatedStale ? colors.caution : colors.textMuted }}
              data-testid={`watchlist-evaluated-ago-${model.symbol}`}
            >
              Updated: {model.evaluatedAgo}
              {model.evaluatedStale ? " · stale" : ""}
            </span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {showDeskCompare && onCompareDesks ? (
              <button
                type="button"
                className={`${WATCHLIST_EVALUATE_LINK_CLASS} text-xs`}
                data-testid={`watchlist-compare-desks-${model.symbol}`}
                aria-label={`Compare swing and day desks for ${model.symbol}`}
                title="Swing vs day maturation for this symbol"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onCompareDesks();
                }}
              >
                Compare desks
              </button>
            ) : null}
            {onRefresh ? (
              <button
                type="button"
                className={`${WATCHLIST_EVALUATE_LINK_CLASS} shrink-0 text-xs`}
                data-testid={`watchlist-refresh-${model.symbol}-${planMode}`}
                aria-label={`Refresh ${planMode} evaluation for ${model.symbol}`}
                title="Re-run composite and update maturation"
                disabled={deskEvaluating}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRefresh();
                }}
              >
                {deskEvaluating ? "Refreshing…" : "Refresh"}
              </button>
            ) : null}
          </span>
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
  justAdded,
  compact,
  showDeskCompare,
  onRemove,
  onRefresh,
  onCompareDesks,
  desk
}: {
  symbol: string;
  row: WatchlistMaturationRow | undefined;
  snapshot?: SnapshotPayload;
  planMode: "swing" | "day";
  deskEvaluating?: boolean;
  justAdded?: boolean;
  compact?: boolean;
  showDeskCompare?: boolean;
  desk?: WatchlistRadarDeskContext;
  onRemove: () => void;
  onRefresh?: () => void;
  onCompareDesks?: () => void;
}) {
  const { colors } = useTheme();
  const model = buildWatchlistCardModel(
    symbol,
    row,
    snapshot,
    {
      accent: colors.accent,
      bullish: colors.bullish,
      bearish: colors.bearish,
      caution: colors.caution,
      textMuted: colors.textMuted
    },
    planMode,
    desk
  );
  return (
    <WatchlistDecisionCard
      model={model}
      planMode={planMode}
      deskEvaluating={deskEvaluating}
      justAdded={justAdded}
      compact={compact}
      showDeskCompare={showDeskCompare}
      onRemove={onRemove}
      onRefresh={onRefresh}
      onCompareDesks={onCompareDesks}
    />
  );
}
