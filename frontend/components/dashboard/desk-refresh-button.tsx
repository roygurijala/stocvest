"use client";

import { borderRadius } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  cooldownLabel?: string | null;
  label?: string;
  testId?: string;
};

export function DeskRefreshButton({
  onClick,
  busy = false,
  disabled = false,
  cooldownLabel = null,
  label = "Load movers",
  testId = "dashboard-discovery-refresh-desk"
}: Props) {
  const { colors } = useTheme();
  const canClick = !disabled && !busy;

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={!canClick}
      onClick={() => onClick()}
      className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition"
      style={{
        border: `1px solid ${canClick ? colors.accent : colors.border}`,
        background: canClick
          ? `color-mix(in srgb, ${colors.accent} 14%, ${colors.surface})`
          : colors.surfaceMuted,
        color: canClick ? colors.accent : colors.textMuted,
        cursor: canClick ? "pointer" : "not-allowed"
      }}
    >
      {busy ? "Loading…" : cooldownLabel ? `Wait ${cooldownLabel}` : label}
    </button>
  );
}
