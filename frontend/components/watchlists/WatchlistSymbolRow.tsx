"use client";

import { RefreshCw } from "lucide-react";
import { SignalsDeeplinkLink } from "@/components/nav/signals-deeplink-link";
import { buildWatchlistDeskStatusPresent, watchlistStatusRailColor } from "@/lib/watchlist-row-present";
import { WATCHLIST_EVALUATE_LINK_CLASS } from "@/lib/watchlist-interactive-styles";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { formatWatchlistMaturationLabel } from "@/lib/watchlist-page-utils";
import { shouldShowDeskRow, type SymbolTrackingMap, trackingForSymbol } from "@/lib/watchlist-tracking-presentation";
import type { WatchlistViewMode } from "@/lib/watchlist-page-utils";
import { watchlistSignalsOpenAriaLabel } from "@/lib/nav/watchlist-signals-deeplink";
import {
  formatLastEvaluatedLine,
  formatUnevaluatedDeskStatusLine,
  type WatchlistEvaluationLineOpts
} from "@/lib/watchlist-evaluation-present";
import type { SnapshotPayload } from "@/lib/api/market";
import { watchlistQuoteFromSnapshot } from "@/lib/watchlist-page-utils";
import { useTheme } from "@/lib/theme-provider";
import { WatchlistScenarioBuilder } from "@/components/watchlists/watchlist-scenario-builder";

type Desk = "swing" | "day";

function DeskEvalMeta({
  symU,
  desk,
  lastEvaluatedLine,
  deskEvaluating,
  onRefreshDesk
}: {
  symU: string;
  desk: Desk;
  lastEvaluatedLine: string;
  deskEvaluating?: boolean;
  onRefreshDesk?: (desk: Desk) => void;
}) {
  const { colors } = useTheme();
  return (
    <span
      className="watchlist-desk-lines__meta inline-flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-right"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className="watchlist-desk-lines__fetched text-xs leading-snug"
        style={{ color: colors.textMuted }}
        data-testid={`watchlist-last-evaluated-${symU}-${desk}`}
      >
        {lastEvaluatedLine}
      </span>
      {onRefreshDesk ? (
        <button
          type="button"
          className={`${WATCHLIST_EVALUATE_LINK_CLASS} watchlist-desk-lines__refresh inline-flex items-center gap-1`}
          style={{ color: colors.textMuted }}
          data-testid={`watchlist-refresh-${symU}-${desk}`}
          aria-label={`Refresh ${desk} evaluation for ${symU}`}
          title="Re-run composite and update maturation"
          disabled={deskEvaluating}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRefreshDesk(desk);
          }}
        >
          <RefreshCw size={12} className={deskEvaluating ? "animate-spin" : undefined} aria-hidden />
          {deskEvaluating ? "Refreshing…" : "Refresh"}
        </button>
      ) : null}
    </span>
  );
}

type Props = {
  symbol: string;
  swingRow?: WatchlistMaturationRow;
  dayRow?: WatchlistMaturationRow;
  displayState?: string;
  viewMode: WatchlistViewMode;
  dualDesk: boolean;
  symbolTracking: SymbolTrackingMap | undefined;
  snapshot?: SnapshotPayload;
  maturationFetchStatus: "idle" | "loading" | "ready" | "error";
  isDefaultList: boolean;
  planMode: "swing" | "day";
  maturationForPlan?: WatchlistMaturationRow;
  deskEvaluating?: { swing?: boolean; day?: boolean };
  sessionClosed?: boolean;
  onRemove: () => void;
  onOpenLayers: (desk: Desk, row: WatchlistMaturationRow | undefined) => void;
  onRefreshDesk?: (desk: Desk) => void;
};

function DeskStatusBlock({
  symU,
  desk,
  row,
  maturationFetchStatus,
  isDefaultList,
  deskEvaluating,
  sessionClosed,
  onOpenLayers,
  onRefreshDesk
}: {
  symU: string;
  desk: Desk;
  row: WatchlistMaturationRow | undefined;
  maturationFetchStatus: Props["maturationFetchStatus"];
  isDefaultList: boolean;
  deskEvaluating?: boolean;
  sessionClosed?: boolean;
  onOpenLayers: Props["onOpenLayers"];
  onRefreshDesk?: Props["onRefreshDesk"];
}) {
  const evalOpts: WatchlistEvaluationLineOpts = { evaluating: deskEvaluating, sessionClosed };
  const { colors } = useTheme();
  const present = buildWatchlistDeskStatusPresent(row, desk);
  if (!present) {
    if (maturationFetchStatus === "error" && isDefaultList) {
      return null;
    }
    const fallback = maturationFetchStatus === "ready" && isDefaultList ? null : "…";
    if (fallback === null) {
      return (
        <div
          data-testid={`watchlist-desk-${symU}-${desk}`}
          className="watchlist-desk-lines watchlist-desk-lines--pending"
        >
          <div className="watchlist-desk-lines__header flex items-start justify-between gap-3">
            <p className="watchlist-desk-lines__status m-0 min-w-0 flex-1" style={{ color: colors.textMuted }}>
              {formatUnevaluatedDeskStatusLine(desk, evalOpts)}
            </p>
            <DeskEvalMeta
              symU={symU}
              desk={desk}
              lastEvaluatedLine={formatLastEvaluatedLine(undefined, evalOpts)}
              deskEvaluating={deskEvaluating}
              onRefreshDesk={onRefreshDesk}
            />
          </div>
          {!deskEvaluating ? (
            <SignalsDeeplinkLink
              symbol={symU}
              contextRef="watchlist"
              tradingMode={desk}
              className={`${WATCHLIST_EVALUATE_LINK_CLASS} watchlist-desk-lines__action`}
              data-testid={`watchlist-evaluate-${symU}-${desk}`}
              onClick={(e) => e.stopPropagation()}
            >
              Open Signals
            </SignalsDeeplinkLink>
          ) : null}
        </div>
      );
    }
    return (
      <div data-testid={`watchlist-desk-${symU}-${desk}`} className="watchlist-desk-lines">
        <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
          {fallback}
        </p>
      </div>
    );
  }

  return (
    <div data-testid={`watchlist-desk-${symU}-${desk}`} className="watchlist-desk-lines">
      <div className="watchlist-desk-lines__header flex items-start justify-between gap-3">
        <button
          type="button"
          className="watchlist-desk-lines__status-btn pointer-events-auto m-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
          style={{ color: colors.text, cursor: "pointer" }}
          data-testid={`watchlist-alignment-${symU}-${desk}`}
          aria-label={`${symU} ${present.statusLine}. ${present.detailLine ?? "Open layer breakdown"}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenLayers(desk, row);
          }}
        >
          <span
            className="watchlist-desk-lines__status block"
            data-testid={`watchlist-status-line-${symU}-${desk}`}
          >
            {present.statusLine}
          </span>
        </button>
        <DeskEvalMeta
          symU={symU}
          desk={desk}
          lastEvaluatedLine={present.lastEvaluatedLine}
          deskEvaluating={deskEvaluating}
          onRefreshDesk={onRefreshDesk}
        />
      </div>
      {present.detailLine ? (
        <button
          type="button"
          className="watchlist-desk-lines__detail-btn pointer-events-auto m-0 w-full border-0 bg-transparent p-0 text-left"
          style={{ color: colors.textMuted, cursor: "pointer" }}
          data-testid={`watchlist-detail-line-${symU}-${desk}`}
          title={row?.readiness_label ?? undefined}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenLayers(desk, row);
          }}
        >
          <span className="watchlist-desk-lines__detail block">{present.detailLine}</span>
        </button>
      ) : null}
      {present.progressionChip ? (
        <span className="sr-only" data-testid={`watchlist-progression-${symU}-${desk}`}>
          {present.progressionChip}
        </span>
      ) : null}
    </div>
  );
}

export function WatchlistSymbolRow({
  symbol,
  swingRow,
  dayRow,
  displayState,
  viewMode,
  dualDesk,
  symbolTracking,
  snapshot,
  maturationFetchStatus,
  isDefaultList,
  planMode,
  maturationForPlan,
  deskEvaluating,
  sessionClosed,
  onRemove,
  onOpenLayers,
  onRefreshDesk
}: Props) {
  const { colors } = useTheme();
  const symU = symbol.trim().toUpperCase();
  const quote = watchlistQuoteFromSnapshot(snapshot);
  const tracking = trackingForSymbol(symbolTracking, symU, dualDesk);
  const accent = watchlistStatusRailColor(displayState, colors);
  const showSwing = isDefaultList && shouldShowDeskRow(tracking, "swing", viewMode, dualDesk);
  const showDay = isDefaultList && shouldShowDeskRow(tracking, "day", viewMode, dualDesk);

  return (
    <li id={`watchlist-row-${symU}`} data-testid={`watchlist-row-${symU}`}>
      <div
        className="watchlist-symbol-row"
        style={{
          borderColor: colors.border,
          background: colors.background
        }}
      >
        <span
          className="watchlist-symbol-row__dot"
          style={{ background: accent }}
          aria-hidden
          title={displayState ? formatWatchlistMaturationLabel({ state: displayState, label: displayState }) : undefined}
        />

        <div className="watchlist-symbol-row__body">
          <div className="watchlist-symbol-row__head">
            <SignalsDeeplinkLink
              symbol={symU}
              contextRef="watchlist"
              tradingMode={planMode}
              className="watchlist-symbol-row__symbol font-mono pointer-events-auto"
              aria-label={watchlistSignalsOpenAriaLabel(symbol)}
            >
              {symU}
            </SignalsDeeplinkLink>
            <span className="watchlist-symbol-row__scenario pointer-events-auto">
              <WatchlistScenarioBuilder
                symbol={symU}
                mode={planMode}
                snapshot={snapshot}
                maturation={maturationForPlan}
                testId={`build-scenario-watchlist-${symU}`}
              />
            </span>
            {maturationFetchStatus === "loading" && isDefaultList ? (
              <span className="watchlist-symbol-row__loading" style={{ color: colors.textMuted }}>
                …
              </span>
            ) : null}
            {quote ? (
              <span className="watchlist-symbol-row__quote tabular-nums pointer-events-none">
                <span style={{ color: colors.text, fontWeight: 600 }}>{quote.price}</span>
                {quote.pct ? (
                  <span
                    style={{
                      color:
                        quote.bullish === true
                          ? colors.bullish
                          : quote.bullish === false
                            ? colors.bearish
                            : colors.textMuted,
                      marginLeft: 6,
                      fontSize: 12,
                      fontWeight: 600
                    }}
                  >
                    {quote.pct}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>

          {showSwing ? (
            <DeskStatusBlock
              symU={symU}
              desk="swing"
              row={swingRow}
              maturationFetchStatus={maturationFetchStatus}
              isDefaultList={isDefaultList}
              deskEvaluating={deskEvaluating?.swing}
              sessionClosed={sessionClosed}
              onOpenLayers={onOpenLayers}
              onRefreshDesk={onRefreshDesk}
            />
          ) : null}
          {showDay ? (
            <DeskStatusBlock
              symU={symU}
              desk="day"
              row={dayRow}
              maturationFetchStatus={maturationFetchStatus}
              isDefaultList={isDefaultList}
              deskEvaluating={deskEvaluating?.day}
              sessionClosed={sessionClosed}
              onOpenLayers={onOpenLayers}
              onRefreshDesk={onRefreshDesk}
            />
          ) : null}
        </div>

        <button
          type="button"
          className="watchlist-symbol-row__remove pointer-events-auto"
          style={{ color: colors.textMuted }}
          aria-label={`Remove ${symU}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </div>
    </li>
  );
}
