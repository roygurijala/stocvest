"use client";

import type { ScenarioWhyNotItem } from "@/lib/scenario/scenario-readiness";
import { spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export function ScenarioPreviewWhyNot({ items }: { items: ScenarioWhyNotItem[] }) {
  const { colors } = useTheme();
  if (items.length === 0) return null;

  return (
    <ul
      className="m-0 list-none space-y-2 p-0"
      style={{ fontSize: typography.scale.sm, lineHeight: 1.5, color: colors.textMuted }}
    >
      {items.map((item, idx) => {
        if (item.kind === "missing_confirmations") {
          return (
            <li key={`missing-${idx}`}>
              <span style={{ color: colors.text }}>Missing confirmations:</span>
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0 pl-4">
                {item.layers.map((layer) => (
                  <li key={layer} style={{ listStyleType: "none" }}>
                    <span aria-hidden>– </span>
                    {layer}
                  </li>
                ))}
              </ul>
            </li>
          );
        }
        return (
          <li key={item.text} style={{ paddingLeft: spacing[2], borderLeft: `2px solid ${colors.border}` }}>
            {item.text}
          </li>
        );
      })}
    </ul>
  );
}
