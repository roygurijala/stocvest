"use client";

import { DeskModeTabNav } from "@/components/desk-mode-tab-nav";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";

type Props = {
  mode: DashboardDeskMode;
  onModeChange: (mode: DashboardDeskMode) => void;
  showDay: boolean;
};

export function DashboardDeskModePills({ mode, onModeChange, showDay }: Props) {
  const modes = (showDay ? ["swing", "day"] : ["swing"]) as const;
  return (
    <DeskModeTabNav
      value={mode}
      onChange={onModeChange}
      modes={modes}
      ariaLabel="Desk mode"
      testIdPrefix="dashboard-desk-mode"
      listTestId="dashboard-desk-mode"
    />
  );
}
