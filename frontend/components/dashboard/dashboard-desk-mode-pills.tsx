"use client";

import { DeskModeTabNav } from "@/components/desk-mode-tab-nav";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";

type Props = {
  mode: DashboardDeskMode;
  onModeChange: (mode: DashboardDeskMode) => void;
  showDay: boolean;
};

const DASHBOARD_DESK_MODES_DUAL = ["swing", "day"] as const satisfies readonly DashboardDeskMode[];
const DASHBOARD_DESK_MODES_SWING_ONLY = ["swing"] as const satisfies readonly DashboardDeskMode[];

export function DashboardDeskModePills({ mode, onModeChange, showDay }: Props) {
  const modes = showDay ? DASHBOARD_DESK_MODES_DUAL : DASHBOARD_DESK_MODES_SWING_ONLY;
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
