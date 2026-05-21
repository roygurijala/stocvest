"use client";

import {
  SIGNALS_DESK_TAB_LABEL,
  SIGNALS_DESK_TABS,
  type SignalsDeskTab
} from "@/lib/signals-page-tabs";
import { borderRadius } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  activeTab: SignalsDeskTab;
  onTabChange: (tab: SignalsDeskTab) => void;
};

export function SignalsDeskTabNav({ activeTab, onTabChange }: Props) {
  const { colors } = useTheme();

  return (
    <nav
      className="mt-3 flex flex-wrap gap-1 rounded-lg p-1"
      style={{ background: colors.surfaceMuted, border: `1px solid ${colors.border}` }}
      data-testid="signals-desk-tab-nav"
      aria-label="Signals desk sections"
    >
      {SIGNALS_DESK_TABS.map((tab) => {
        const active = tab === activeTab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            className="min-h-10 flex-1 rounded-md px-3 text-sm font-semibold sm:min-h-9"
            style={{
              background: active ? colors.surface : "transparent",
              color: active ? colors.text : colors.textMuted,
              border: active ? `1px solid ${colors.border}` : "1px solid transparent",
              borderRadius: borderRadius.md,
              cursor: "pointer"
            }}
            data-testid={`signals-desk-tab-${tab}`}
            onClick={() => onTabChange(tab)}
          >
            {SIGNALS_DESK_TAB_LABEL[tab]}
          </button>
        );
      })}
    </nav>
  );
}
