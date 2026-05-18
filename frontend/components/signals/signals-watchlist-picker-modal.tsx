"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  alignmentDisplayMeta,
  formatAlignmentStatusLine,
  type AlignmentDisplayTone
} from "@/lib/alignment-display-tier";
import { formatWatchlistMaturationLabel, type WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import {
  EVALUATION_MODE_LINES,
  evaluationStatusTitle,
  formatLastEvaluatedShort,
  newestLastEvaluatedAt,
  pickerRowIsEvaluated
} from "@/lib/watchlist-evaluation-present";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export type WatchlistPickerMaturationBadge = {
  label: string;
  tone: "bullish" | "bearish" | "caution" | "muted";
  emoji?: string;
};

function displayToneToPicker(tone: AlignmentDisplayTone): WatchlistPickerMaturationBadge["tone"] {
  if (tone === "bullish") return "bullish";
  if (tone === "bearish") return "bearish";
  if (tone === "muted") return "muted";
  return "caution";
}

export function formatPickerMaturationLabel(row: WatchlistMaturationRow | undefined): string {
  const st = (row?.state || "").trim().toLowerCase();
  if (!st) return "Not evaluated yet";
  const aligned = row?.layers_aligned;
  const total = row?.layers_total ?? 6;
  if (typeof aligned === "number" && Number.isFinite(aligned)) {
    return formatAlignmentStatusLine({
      layersAligned: aligned,
      layersTotal: total,
      maturationState: st
    });
  }
  const base = formatWatchlistMaturationLabel(row);
  return base === "—" ? st.replace(/_/g, " ") : base;
}

export function maturationPickerBadge(row: WatchlistMaturationRow | undefined): WatchlistPickerMaturationBadge {
  const st = (row?.state || "").trim().toLowerCase();
  const label = formatPickerMaturationLabel(row);
  if (!st) return { label, tone: "muted" };
  const aligned = row?.layers_aligned;
  const total = row?.layers_total ?? 6;
  if (typeof aligned === "number" && Number.isFinite(aligned)) {
    const meta = alignmentDisplayMeta({
      layersAligned: aligned,
      layersTotal: total,
      maturationState: st
    });
    return { label, tone: displayToneToPicker(meta.tone), emoji: meta.emoji };
  }
  if (st === "actionable") return { label, tone: "bullish" };
  if (st === "developing") return { label, tone: "caution" };
  if (st === "not_aligned") return { label, tone: "bearish" };
  if (st === "re_evaluating") return { label, tone: "caution" };
  if (st === "invalidated") return { label, tone: "bearish" };
  return { label, tone: "muted" };
}

function badgeEmoji(badge: WatchlistPickerMaturationBadge, evaluated: boolean): string {
  if (!evaluated) return "○";
  if (badge.emoji) return badge.emoji;
  const tone = badge.tone;
  if (tone === "bullish") return "🟢";
  if (tone === "caution") return "🟠";
  if (tone === "bearish") return "🔴";
  return "⚪";
}

type Props = {
  open: boolean;
  symbols: string[];
  maturationBySymbol: Record<string, WatchlistMaturationRow>;
  loading: boolean;
  tradingMode: "day" | "swing";
  onSelect: (symbol: string) => void;
  onClose: () => void;
};

export function SignalsWatchlistPickerModal({
  open,
  symbols,
  maturationBySymbol,
  loading,
  tradingMode,
  onSelect,
  onClose
}: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const list = [...symbols];
    if (!q) return list;
    return list.filter((s) => s.includes(q));
  }, [query, symbols]);

  const newestEval = useMemo(() => newestLastEvaluatedAt(maturationBySymbol), [maturationBySymbol]);

  if (!open) return null;

  const badgeColor = (tone: WatchlistPickerMaturationBadge["tone"]) => {
    if (tone === "bullish") return colors.bullish;
    if (tone === "bearish") return colors.bearish;
    if (tone === "caution") return colors.caution;
    return colors.textMuted;
  };

  const deskLabel = tradingMode === "swing" ? "Swing" : "Day";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Choose symbol from watchlist"
      data-testid="signals-watchlist-picker"
    >
      <div
        className="flex max-h-[min(85vh,560px)] w-full max-w-md flex-col overflow-hidden rounded-xl border p-4"
        style={{ borderColor: colors.border, background: colors.surface }}
      >
        <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: colors.textMuted }}>
          Default watchlist
        </p>
        <h3 className="m-0 mt-1 text-base font-semibold" style={{ color: colors.text }} data-testid="signals-watchlist-picker-title">
          {evaluationStatusTitle(tradingMode)}
        </h3>
        <ul
          className="m-0 mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed"
          style={{ color: colors.textMuted }}
          data-testid="signals-watchlist-picker-guidance"
        >
          <li>Evaluated after daily close (~4:30 PM ET)</li>
          <li>Select a symbol below to evaluate immediately</li>
        </ul>
        <div
          className="mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed"
          style={{ borderColor: colors.border, background: colors.background, color: colors.textMuted }}
          data-testid="signals-watchlist-picker-evaluation-mode"
        >
          <p className="m-0 font-semibold" style={{ color: colors.text }}>
            Evaluation mode
          </p>
          <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4">
            {EVALUATION_MODE_LINES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {newestEval ? (
            <p className="m-0 mt-2" data-testid="signals-watchlist-picker-last-eval">
              Most recent evaluation in this list: {newestEval}
            </p>
          ) : null}
        </div>
        <input
          type="search"
          className="mt-3 w-full rounded-md border px-3 py-2 text-sm"
          style={{
            borderColor: colors.border,
            background: colors.background,
            color: colors.text
          }}
          placeholder="Search watchlist…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="signals-watchlist-picker-search"
          aria-label="Search watchlist"
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
              Loading…
            </p>
          ) : symbols.length === 0 ? (
            <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
              No symbols yet.{" "}
              <Link href="/dashboard/watchlists" className="font-medium no-underline" style={{ color: colors.accent }}>
                Add tickers on Watchlists
              </Link>
              .
            </p>
          ) : filtered.length === 0 ? (
            <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
              No symbols match your search.
            </p>
          ) : (
            <ul className="m-0 list-none p-0" style={{ display: "grid", gap: spacing[1] }}>
              {filtered.map((s) => {
                const row = maturationBySymbol[s];
                const evaluated = pickerRowIsEvaluated(row);
                const badge = maturationPickerBadge(row);
                const lastEval = formatLastEvaluatedShort(row?.last_evaluated_at);
                return (
                  <li key={s}>
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm"
                      style={{
                        border: `1px solid ${colors.border}`,
                        background: colors.background,
                        color: colors.text
                      }}
                      onClick={() => onSelect(s)}
                      data-testid={`signals-watchlist-picker-row-${s}`}
                      title={!evaluated ? `Open ${s} on ${deskLabel} Signals to run evaluation` : undefined}
                    >
                      <span className="font-semibold tracking-wide">{s}</span>
                      <span className="flex min-w-0 flex-col items-end gap-0.5">
                        <span
                          className="shrink-0 text-right text-[11px] font-medium leading-snug"
                          style={{ color: badgeColor(badge.tone) }}
                          data-testid={`signals-watchlist-picker-badge-${s}`}
                        >
                          {badgeEmoji(badge, evaluated)} {badge.label}
                        </span>
                        {!evaluated ? (
                          <span
                            className="text-[10px] font-medium"
                            style={{ color: colors.accent }}
                            data-testid={`signals-watchlist-picker-hint-${s}`}
                          >
                            Tap to evaluate
                          </span>
                        ) : lastEval ? (
                          <span className="text-[10px]" style={{ color: colors.textMuted }}>
                            Last: {lastEval}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          className="mt-4 min-h-10 w-full rounded-md text-sm"
          style={{ border: `1px solid ${colors.border}`, background: "transparent", color: colors.textMuted }}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
