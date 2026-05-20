"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";

type Props = {
  mode: DashboardDeskMode;
  onModeChange: (mode: DashboardDeskMode) => void;
  showDay: boolean;
};

export function DashboardDeskModePills({ mode, onModeChange, showDay }: Props) {
  const { colors } = useTheme();
  const modes: DashboardDeskMode[] = showDay ? ["swing", "day"] : ["swing"];

  return (
    <div
      role="tablist"
      aria-label="Desk mode"
      data-testid="dashboard-desk-mode"
      className="flex flex-wrap gap-2"
    >
      {modes.map((m) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`dashboard-desk-mode-${m}`}
            onClick={() => onModeChange(m)}
            style={{
              padding: `${spacing[2]} ${spacing[4]}`,
              borderRadius: borderRadius.md,
              fontSize: typography.scale.sm,
              fontWeight: 600,
              textTransform: "capitalize",
              border: `1px solid ${on ? colors.accent : colors.border}`,
              background: on ? `color-mix(in srgb, ${colors.accent} 12%, ${colors.surface})` : colors.surface,
              color: on ? colors.text : colors.textMuted,
              cursor: "pointer"
            }}
          >
            {m === "swing" ? "Swing" : "Day"}
          </button>
        );
      })}
    </div>
  );
}
