"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlignmentDrilldownLinks } from "@/components/signals/alignment-drilldown-links";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";
import { formatLayersFromActionableHint, formatWatchlistMaturationDisplayLine } from "@/lib/alignment-display-tier";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { signalsWithSymbolHref } from "@/lib/nav/setup-analytics-deeplink";
import { WATCHLIST_EVALUATE_LINK_CLASS } from "@/lib/watchlist-interactive-styles";
import {
  alignedLayerNames,
  formatMaturationBiasLabel,
  maturationAlignmentCounts,
  missingLayerNames
} from "@/lib/watchlist-alignment-present";
import { formatEvaluatedAgo } from "@/lib/watchlist-decision-card-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { useTheme } from "@/lib/theme-provider";

type Desk = "swing" | "day";

type Props = {
  open: boolean;
  symbol: string;
  swingRow: WatchlistMaturationRow | undefined;
  dayRow: WatchlistMaturationRow | undefined;
  swingEvaluating?: boolean;
  dayEvaluating?: boolean;
  onClose: () => void;
  onRefreshDesk?: (desk: Desk) => void;
  onOpenAlignment?: (desk: Desk) => void;
};

function DeskBlock({
  symU,
  desk,
  row,
  evaluating,
  onRefresh,
  onOpenAlignment
}: {
  symU: string;
  desk: Desk;
  row: WatchlistMaturationRow | undefined;
  evaluating?: boolean;
  onRefresh?: () => void;
  onOpenAlignment?: () => void;
}) {
  const { colors } = useTheme();
  const deskLabel = desk === "swing" ? "Swing" : "Day";
  const { aligned, total } = maturationAlignmentCounts(row);
  const evalAgo = formatEvaluatedAgo(row?.last_evaluated_at);
  const stateLabel = formatWatchlistMaturationDisplayLine(row) ?? "Not evaluated yet";
  const biasLabel = formatMaturationBiasLabel(row?.bias ?? null);
  const thresholdHint = formatLayersFromActionableHint(aligned, total);
  const alignedNames = alignedLayerNames(row);
  const missing = missingLayerNames(row);

  return (
    <section
      className="rounded-lg border p-3"
      style={{ borderColor: colors.border, background: `color-mix(in srgb, ${colors.surface} 92%, ${colors.border})` }}
      data-testid={`watchlist-compare-desk-${desk}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: colors.textMuted }}>
            {deskLabel} desk
          </p>
          <p className="m-0 mt-1 text-sm font-semibold" style={{ color: colors.text }}>
            {stateLabel}
            {total > 0 ? (
              <>
                {" "}
                · <span className="tabular-nums">{aligned}</span>/{total} aligned
              </>
            ) : null}
          </p>
          <p
            className="m-0 mt-1 text-xs"
            style={{ color: evalAgo.stale ? colors.caution : colors.textMuted }}
            data-testid={`watchlist-compare-updated-${desk}`}
          >
            Updated: {evalAgo.text}
            {evalAgo.stale ? " · stale" : ""}
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            className={`${WATCHLIST_EVALUATE_LINK_CLASS} inline-flex shrink-0 items-center gap-1 text-xs`}
            style={{ color: colors.textMuted }}
            data-testid={`watchlist-compare-refresh-${desk}`}
            disabled={evaluating}
            onClick={onRefresh}
          >
            <RefreshCw size={12} className={evaluating ? "animate-spin" : undefined} aria-hidden />
            {evaluating ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>

      {biasLabel ? (
        <p className="m-0 mt-2 text-xs" style={{ color: colors.textMuted }}>
          Bias: <span style={{ color: colors.text, fontWeight: 600 }}>{biasLabel}</span>
          {thresholdHint ? ` — ${thresholdHint}` : null}
        </p>
      ) : null}

      {row?.readiness_label?.trim() ? (
        <p className="m-0 mt-2 text-xs leading-snug" style={{ color: colors.textMuted }}>
          {row.readiness_label.trim()}
        </p>
      ) : null}

      {alignedNames.length > 0 || missing.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {alignedNames.length > 0 ? (
            <div>
              <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
                Aligned
              </p>
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-xs" style={{ color: colors.text }}>
                {alignedNames.map((name) => (
                  <li key={name}>✓ {name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {missing.length > 0 ? (
            <div>
              <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
                Missing
              </p>
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-xs" style={{ color: colors.textMuted }}>
                {missing.map((name) => (
                  <li key={name}>• {name}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {onOpenAlignment ? (
          <button
            type="button"
            className="border-0 bg-transparent p-0 font-semibold underline-offset-2 hover:underline"
            style={{ color: colors.accent, cursor: "pointer" }}
            data-testid={`watchlist-compare-layers-${desk}`}
            onClick={onOpenAlignment}
          >
            Layer breakdown
          </button>
        ) : null}
        <Link
          href={signalsWithSymbolHref(symU, desk)}
          className="font-semibold no-underline hover:underline"
          style={{ color: colors.accent }}
          data-testid={`watchlist-compare-signals-${desk}`}
        >
          Open Signals
        </Link>
        <AlignmentDrilldownLinks symbol={symU} mode={desk} testId={`watchlist-compare-drilldown-${desk}`} />
      </div>
    </section>
  );
}

export function WatchlistDeskCompareSheet({
  open,
  symbol,
  swingRow,
  dayRow,
  swingEvaluating,
  dayEvaluating,
  onClose,
  onRefreshDesk,
  onOpenAlignment
}: Props) {
  const { colors } = useTheme();
  const [mounted, setMounted] = useState(false);
  const symU = symbol.trim().toUpperCase();

  useBodyScrollLock(open);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !open || !symU) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[94] grid place-items-end p-0 sm:place-items-center sm:p-3"
        style={{ background: "rgba(2,6,23,0.72)" }}
        onClick={onClose}
        data-testid="watchlist-compare-overlay"
      >
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.2 }}
          className={`w-full max-w-none sm:max-w-lg ${surfaceGlowClassName}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: `${borderRadius.xl} ${borderRadius.xl} 0 0`,
            padding: spacing[5],
            maxHeight: "min(90vh, 640px)",
            overflowY: "auto"
          }}
          data-testid="watchlist-desk-compare-sheet"
          role="dialog"
          aria-labelledby="watchlist-compare-title"
        >
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: colors.textMuted }}>
                Swing vs Day
              </p>
              <h2 id="watchlist-compare-title" className="m-0 mt-1 text-xl font-bold" style={{ color: colors.text }}>
                {symU}
              </h2>
              <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
                Each desk has its own schedule and maturation row. Refresh either desk without leaving this sheet.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 border-0 bg-transparent p-1"
              style={{ color: colors.textMuted, cursor: "pointer" }}
            >
              <X size={18} aria-hidden />
            </button>
          </header>

          <div className="mt-4 grid gap-3">
            <DeskBlock
              symU={symU}
              desk="swing"
              row={swingRow}
              evaluating={swingEvaluating}
              onRefresh={onRefreshDesk ? () => onRefreshDesk("swing") : undefined}
              onOpenAlignment={
                onOpenAlignment
                  ? () => {
                      onOpenAlignment("swing");
                    }
                  : undefined
              }
            />
            <DeskBlock
              symU={symU}
              desk="day"
              row={dayRow}
              evaluating={dayEvaluating}
              onRefresh={onRefreshDesk ? () => onRefreshDesk("day") : undefined}
              onOpenAlignment={
                onOpenAlignment
                  ? () => {
                      onOpenAlignment("day");
                    }
                  : undefined
              }
            />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
