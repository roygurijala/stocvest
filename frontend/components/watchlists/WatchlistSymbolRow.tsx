"use client";

import Link from "next/link";
import { buildWatchlistDeskStatusPresent, watchlistStatusRailColor } from "@/lib/watchlist-row-present";
import { WATCHLIST_EVALUATE_LINK_CLASS } from "@/lib/watchlist-interactive-styles";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { formatWatchlistMaturationLabel } from "@/lib/watchlist-page-utils";
import { shouldShowDeskRow, type SymbolTrackingMap, trackingForSymbol } from "@/lib/watchlist-tracking-presentation";
import type { WatchlistViewMode } from "@/lib/watchlist-page-utils";
import { watchlistSignalsOpenAriaLabel, watchlistToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import { formatLastEvaluatedLine } from "@/lib/watchlist-evaluation-present";
import type { SnapshotPayload } from "@/lib/api/market";
import { watchlistQuoteFromSnapshot } from "@/lib/watchlist-page-utils";
import { useTheme } from "@/lib/theme-provider";
import { WatchlistScenarioBuilder } from "@/components/watchlists/watchlist-scenario-builder";

type Desk = "swing" | "day";

type Props = {
  symbol: string;
  href: string;
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
  onRemove: () => void;
  onOpenLayers: (desk: Desk, row: WatchlistMaturationRow | undefined) => void;
};

function DeskStatusBlock({
  symU,
  desk,
  row,
  maturationFetchStatus,
  isDefaultList,
  deskEvaluating,
  onOpenLayers
}: {
  symU: string;
  desk: Desk;
  row: WatchlistMaturationRow | undefined;
  maturationFetchStatus: Props["maturationFetchStatus"];
  isDefaultList: boolean;
  deskEvaluating?: boolean;
  onOpenLayers: Props["onOpenLayers"];
}) {
  const { colors } = useTheme();
  const present = buildWatchlistDeskStatusPresent(row, desk);
  if (!present) {
    if (maturationFetchStatus === "error" && isDefaultList) {
      return null;
    }
    const fallback = maturationFetchStatus === "ready" && isDefaultList ? null : "…";
    if (fallback === null) {
      const signalsHref = watchlistToSignalsHref(symU, desk);
      return (
        <div
          data-testid={`watchlist-desk-${symU}-${desk}`}
          className="watchlist-desk-lines watchlist-desk-lines--pending"
        >
          <p className="watchlist-desk-lines__status m-0" style={{ color: colors.textMuted }}>
            {desk === "swing" ? "SWING" : "DAY"} · {deskEvaluating ? "Evaluating…" : "Not evaluated yet"}
          </p>
          <p
            className="watchlist-desk-lines__fetched m-0"
            style={{ color: colors.textMuted }}
            data-testid={`watchlist-last-evaluated-${symU}-${desk}`}
          >
            {formatLastEvaluatedLine(undefined, { evaluating: deskEvaluating })}
          </p>
          {!deskEvaluating ? (
            <Link
              href={signalsHref}
              className={`${WATCHLIST_EVALUATE_LINK_CLASS} watchlist-desk-lines__action`}
              data-testid={`watchlist-evaluate-${symU}-${desk}`}
              onClick={(e) => e.stopPropagation()}
            >
              Open Signals
            </Link>
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
      <button
        type="button"
        className="watchlist-desk-lines__block pointer-events-auto"
        style={{ color: colors.text }}
        data-testid={`watchlist-alignment-${symU}-${desk}`}
        aria-label={`${symU} ${present.statusLine}. ${present.detailLine ?? "Open layer breakdown"}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenLayers(desk, row);
        }}
      >
        <p
          className="watchlist-desk-lines__status m-0"
          style={{ color: colors.text }}
          data-testid={`watchlist-status-line-${symU}-${desk}`}
        >
          {present.statusLine}
        </p>
        {present.detailLine ? (
          <p
            className="watchlist-desk-lines__detail m-0"
            style={{ color: colors.textMuted }}
            data-testid={`watchlist-detail-line-${symU}-${desk}`}
            title={row?.readiness_label ?? undefined}
          >
            {present.detailLine}
          </p>
        ) : null}
        <p
          className="watchlist-desk-lines__fetched m-0"
          style={{ color: colors.textMuted }}
          data-testid={`watchlist-last-evaluated-${symU}-${desk}`}
        >
          {present.lastEvaluatedLine}
        </p>
        {present.progressionChip ? (
          <span className="sr-only" data-testid={`watchlist-progression-${symU}-${desk}`}>
            {present.progressionChip}
          </span>
        ) : null}
      </button>
    </div>
  );
}

export function WatchlistSymbolRow({
  symbol,
  href,
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
  onRemove,
  onOpenLayers
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
            <Link
              href={href}
              prefetch={false}
              className="watchlist-symbol-row__symbol font-mono pointer-events-auto"
              aria-label={watchlistSignalsOpenAriaLabel(symbol)}
            >
              {symU}
            </Link>
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
              onOpenLayers={onOpenLayers}
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
              onOpenLayers={onOpenLayers}
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
