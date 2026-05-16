"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatWatchlistMaturationLabel, type WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export type WatchlistPickerMaturationBadge = {
  label: string;
  tone: "bullish" | "bearish" | "caution" | "muted";
};

export function maturationPickerBadge(row: WatchlistMaturationRow | undefined): WatchlistPickerMaturationBadge {
  const st = (row?.state || "").trim().toLowerCase();
  const label = formatWatchlistMaturationLabel(row);
  if (st === "actionable") return { label: label === "—" ? "Actionable" : label, tone: "bullish" };
  if (st === "developing") return { label: label === "—" ? "Developing" : label, tone: "caution" };
  if (st === "not_aligned") return { label: "Not aligned", tone: "bearish" };
  if (st === "re_evaluating") return { label: "Re-evaluating", tone: "caution" };
  if (st === "invalidated") return { label: "Invalidated", tone: "bearish" };
  if (label !== "—") return { label, tone: "muted" };
  return { label: "On list", tone: "muted" };
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

  if (!open) return null;

  const badgeColor = (tone: WatchlistPickerMaturationBadge["tone"]) => {
    if (tone === "bullish") return colors.bullish;
    if (tone === "bearish") return colors.bearish;
    if (tone === "caution") return colors.caution;
    return colors.textMuted;
  };

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
        className="flex max-h-[min(80vh,520px)] w-full max-w-md flex-col overflow-hidden rounded-xl border p-4"
        style={{ borderColor: colors.border, background: colors.surface }}
      >
        <h3 className="m-0" style={{ color: colors.text }}>
          Default watchlist
        </h3>
        <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
          {tradingMode === "swing" ? "Swing" : "Day"} maturation · pick a symbol
        </p>
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
                const badge = maturationPickerBadge(maturationBySymbol[s]);
                return (
                  <li key={s}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm"
                      style={{
                        border: `1px solid ${colors.border}`,
                        background: colors.background,
                        color: colors.text
                      }}
                      onClick={() => onSelect(s)}
                      data-testid={`signals-watchlist-picker-row-${s}`}
                    >
                      <span className="font-semibold tracking-wide">{s}</span>
                      <span
                        className="shrink-0 text-[11px] font-medium"
                        style={{ color: badgeColor(badge.tone) }}
                        data-testid={`signals-watchlist-picker-badge-${s}`}
                      >
                        {badge.tone === "bullish" ? "🟢" : badge.tone === "caution" ? "🟠" : badge.tone === "bearish" ? "🔴" : "⚪"}{" "}
                        {badge.label}
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
