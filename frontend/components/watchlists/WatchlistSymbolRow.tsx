"use client";

import Link from "next/link";
import {
  buildWatchlistDeskStatusPresent,
  watchlistLayerBarColor,
  watchlistStatusRailColor
} from "@/lib/watchlist-row-present";
import { WATCHLIST_ALIGNMENT_CHIP_CLASS, WATCHLIST_EVALUATE_LINK_CLASS } from "@/lib/watchlist-interactive-styles";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { formatWatchlistMaturationLabel } from "@/lib/watchlist-page-utils";
import { shouldShowDeskRow, type SymbolTrackingMap, trackingForSymbol } from "@/lib/watchlist-tracking-presentation";
import type { WatchlistViewMode } from "@/lib/watchlist-page-utils";
import { watchlistSignalsOpenAriaLabel } from "@/lib/nav/watchlist-signals-deeplink";
import type { SnapshotPayload } from "@/lib/api/market";
import { watchlistQuoteFromSnapshot } from "@/lib/watchlist-page-utils";
import { useTheme } from "@/lib/theme-provider";
import { WatchlistScenarioBuilder } from "@/components/watchlists/watchlist-scenario-builder";
import { LayerAlignmentBar } from "@/components/watchlists/LayerAlignmentBar";

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
  onRemove: () => void;
  onOpenLayers: (desk: Desk, row: WatchlistMaturationRow | undefined) => void;
};

function DeskStatusBlock({
  symU,
  desk,
  row,
  maturationFetchStatus,
  isDefaultList,
  onOpenLayers
}: {
  symU: string;
  desk: Desk;
  row: WatchlistMaturationRow | undefined;
  maturationFetchStatus: Props["maturationFetchStatus"];
  isDefaultList: boolean;
  onOpenLayers: Props["onOpenLayers"];
}) {
  const { colors } = useTheme();
  const present = buildWatchlistDeskStatusPresent(row);
  const deskLabel = desk === "swing" ? "Swing" : "Day";
  const deskHue = desk === "swing" ? "#c4b5fd" : "#5eead4";
  const barTestId = `watchlist-layer-bar-${symU}-${desk}`;

  if (!present) {
    if (maturationFetchStatus === "error" && isDefaultList) {
      return null;
    }
    const fallback = maturationFetchStatus === "ready" && isDefaultList ? null : "…";
    if (fallback === null) {
      return (
        <div data-testid={`watchlist-desk-${symU}-${desk}`} className="watchlist-desk-status">
          <span
            className="watchlist-desk-status__pill"
            style={{
              background: desk === "swing" ? "rgba(167,139,250,0.2)" : "rgba(45,212,191,0.15)",
              color: deskHue
            }}
          >
            {deskLabel}
          </span>
          <Link href={`/dashboard/signals?symbol=${symU}&mode=${desk}`} className={WATCHLIST_EVALUATE_LINK_CLASS}>
            Not evaluated yet · Evaluate →
          </Link>
        </div>
      );
    }
    return (
      <div data-testid={`watchlist-desk-${symU}-${desk}`} className="watchlist-desk-status">
        <span className="watchlist-desk-status__pill" style={{ background: "rgba(148,163,184,0.12)", color: colors.textMuted }}>
          {deskLabel}
        </span>
        <span style={{ fontSize: 12, color: colors.textMuted }}>{fallback}</span>
      </div>
    );
  }

  const improved = row?.last_transition_type === "improved";

  return (
    <div data-testid={`watchlist-desk-${symU}-${desk}`} className="watchlist-desk-status">
      <div className="watchlist-desk-status__head">
        <span
          className="watchlist-desk-status__pill"
          style={{
            background: desk === "swing" ? "rgba(167,139,250,0.2)" : "rgba(45,212,191,0.15)",
            color: deskHue
          }}
        >
          {deskLabel}
        </span>
        <span className="watchlist-desk-status__primary" style={{ color: colors.text }}>
          {present.primary}
        </span>
        {present.progression ? (
          <span
            className="watchlist-desk-status__progression"
            data-testid={`watchlist-progression-${symU}-${desk}`}
            title="Layer alignment vs prior evaluation"
            style={{
              background: improved ? "rgba(34,197,94,0.12)" : "rgba(248,113,113,0.12)",
              color: improved ? "#86efac" : "#fca5a5"
            }}
          >
            {present.progression}
          </span>
        ) : null}
        <button
          type="button"
          className={WATCHLIST_ALIGNMENT_CHIP_CLASS}
          data-testid={`watchlist-alignment-${symU}-${desk}`}
          title="Layer breakdown"
          aria-label={`${symU} ${deskLabel} ${present.aligned} of ${present.total} layers aligned. Open breakdown`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenLayers(desk, row);
          }}
        >
          Layers {present.aligned}/{present.total}
        </button>
      </div>
      <LayerAlignmentBar
        fillPct={present.layerFillPct}
        aligned={present.aligned}
        total={present.total}
        fillColor={watchlistLayerBarColor(row, colors)}
        testId={barTestId}
      />
      {present.secondary ? (
        <p
          className="watchlist-desk-status__secondary"
          style={{ color: colors.textMuted }}
          title={row?.readiness_label ?? undefined}
        >
          {present.secondary}
        </p>
      ) : null}
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
        <Link
          href={href}
          prefetch={false}
          className="watchlist-symbol-row__overlay"
          aria-label={watchlistSignalsOpenAriaLabel(symbol)}
        >
          <span className="sr-only">Open {symU} on Signals</span>
        </Link>

        <span
          className="watchlist-symbol-row__dot"
          style={{ background: accent }}
          aria-hidden
          title={displayState ? formatWatchlistMaturationLabel({ state: displayState, label: displayState }) : undefined}
        />

        <div className="watchlist-symbol-row__body">
          <div className="watchlist-symbol-row__head">
            <span className="watchlist-symbol-row__symbol font-mono">{symU}</span>
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
              <span className="watchlist-symbol-row__quote tabular-nums">
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
