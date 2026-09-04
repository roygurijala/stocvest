"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import {
  tradingRoomMotionTransition,
  tradingRoomSegTrackStyle
} from "@/lib/dashboard/trading-room/trading-room-chrome";
import {
  DEEP_DIVE_EVIDENCE_TABS,
  DEEP_DIVE_EVIDENCE_TAB_LABELS,
  type DeepDiveEvidenceTab
} from "@/lib/dashboard/trading-room/deep-dive-tier-present";
import type { useTheme } from "@/lib/theme-provider";

type Colors = ReturnType<typeof useTheme>["colors"];

export function DeepDiveEvidenceTabs({
  active,
  onChange,
  colors
}: {
  active: DeepDiveEvidenceTab;
  onChange: (tab: DeepDiveEvidenceTab) => void;
  colors: Colors;
}) {
  return (
    <div
      className="deep-dive-seg-tabs"
      role="tablist"
      aria-label="Evidence sections"
      data-testid="deep-dive-evidence-tabs"
      style={{
        ...tradingRoomSegTrackStyle(colors),
        gridTemplateColumns: `repeat(${DEEP_DIVE_EVIDENCE_TABS.length}, minmax(0, 1fr))`,
        gap: spacing[2],
        padding: spacing[1],
        display: "grid"
      }}
    >
      {DEEP_DIVE_EVIDENCE_TABS.map((tab) => {
        const selected = active === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`deep-dive-evidence-tab-${tab}`}
            onClick={() => onChange(tab)}
            style={{
              border: "none",
              background: selected ? colors.surface : "transparent",
              boxShadow: selected ? `inset 0 0 0 1.5px ${colors.accent}` : "none",
              color: selected ? colors.text : colors.textMuted,
              fontSize: typography.scale.sm,
              fontWeight: 700,
              padding: `${spacing[2]} ${spacing[3]}`,
              borderRadius: borderRadius.sm,
              cursor: "pointer",
              letterSpacing: "0.04em",
              transition: tradingRoomMotionTransition("background", "color", "box-shadow")
            }}
          >
            {DEEP_DIVE_EVIDENCE_TAB_LABELS[tab]}
          </button>
        );
      })}
    </div>
  );
}
