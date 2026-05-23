"use client";

import { useTheme } from "@/lib/theme-provider";

type Props = {
  checked: boolean;
  onChange: (compact: boolean) => void;
  disabled?: boolean;
};

export function WatchlistTrackingDensityToggle({ checked, onChange, disabled = false }: Props) {
  const { colors } = useTheme();

  return (
    <label
      className="flex min-w-[10rem] cursor-pointer items-start gap-2"
      data-testid="watchlist-tracking-compact-toggle"
      style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.65 : 1 }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0"
        aria-describedby="watchlist-tracking-compact-hint"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold" style={{ color: colors.text }}>
          Compact tracking
        </span>
        <span id="watchlist-tracking-compact-hint" className="text-[11px] leading-snug" style={{ color: colors.textMuted }}>
          Smaller cards in the Tracking group only
        </span>
      </span>
    </label>
  );
}
