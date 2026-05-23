"use client";

import {
  WATCHLIST_SORT_OPTIONS,
  type WatchlistSortMode
} from "@/lib/watchlist-sort-preference";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  value: WatchlistSortMode;
  onChange: (mode: WatchlistSortMode) => void;
  disabled?: boolean;
};

export function WatchlistSortControl({ value, onChange, disabled = false }: Props) {
  const { colors } = useTheme();
  const activeHint = WATCHLIST_SORT_OPTIONS.find((o) => o.value === value)?.hint ?? "";

  return (
    <div
      className="flex min-w-[10rem] flex-col gap-1"
      data-testid="watchlist-sort-control"
    >
      <label
        htmlFor="watchlist-sort-mode"
        className="text-[10px] font-bold uppercase tracking-wide"
        style={{ color: colors.textMuted }}
      >
        Sort cards
      </label>
      <select
        id="watchlist-sort-mode"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as WatchlistSortMode)}
        className="min-h-9 rounded-lg border px-2.5 text-sm font-medium"
        style={{
          borderColor: colors.border,
          background: colors.surfaceMuted,
          color: colors.text,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.65 : 1
        }}
        aria-describedby="watchlist-sort-hint"
      >
        {WATCHLIST_SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <span id="watchlist-sort-hint" className="text-[11px] leading-snug" style={{ color: colors.textMuted }}>
        {disabled ? "Available after maturation loads" : activeHint}
      </span>
    </div>
  );
}
