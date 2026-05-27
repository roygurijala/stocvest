"use client";

import type { ReactNode } from "react";
import { TrendingUp, Zap } from "lucide-react";
import {
  deskModeCadenceLabel,
  getDeskModeTabPresentation,
  type DeskModeTabKey
} from "@/lib/desk-mode-tab-styles";
import { TAB_LABEL_BOTH, TAB_LABEL_DAY, TAB_LABEL_SWING } from "@/lib/mode-terminology";
import { useTheme } from "@/lib/theme-provider";

export type DeskModeTabNavProps<T extends DeskModeTabKey = DeskModeTabKey> = {
  value: T;
  onChange: (mode: T) => void;
  modes: readonly T[];
  /** Accessible name for the tablist. */
  ariaLabel: string;
  /** Prefix for `data-testid` on each tab, e.g. `watchlist-desk` → `watchlist-desk-swing`. */
  testIdPrefix: string;
  /** Optional override for the tablist container test id (e.g. legacy `dashboard-desk-mode`). */
  listTestId?: string;
  /** Secondary cadence line (Multi-day / Intraday) like the scanner. */
  showCadence?: boolean;
  className?: string;
};

function tabLabel(mode: DeskModeTabKey): string {
  if (mode === "swing") return TAB_LABEL_SWING;
  if (mode === "day") return TAB_LABEL_DAY;
  return TAB_LABEL_BOTH;
}

function tabIcon(mode: DeskModeTabKey): ReactNode {
  if (mode === "day") return <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden />;
  if (mode === "swing") return <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden />;
  return null;
}

export function DeskModeTabNav<T extends DeskModeTabKey>({
  value,
  onChange,
  modes,
  ariaLabel,
  testIdPrefix,
  listTestId,
  showCadence = false,
  className = ""
}: DeskModeTabNavProps<T>) {
  const { colors, theme } = useTheme();

  if (modes.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-testid={listTestId ?? `${testIdPrefix}-tablist`}
      className={`inline-flex flex-wrap gap-2 rounded-lg p-1.5 ${className}`.trim()}
      style={{
        border: `1px solid ${colors.border}`,
        background: `color-mix(in srgb, ${colors.surfaceMuted} 85%, ${colors.background})`
      }}
    >
      {modes.map((mode) => {
        const active = value === mode;
        const { tabStyle, cadenceStyle, railHue } = getDeskModeTabPresentation(theme, mode, active, colors);
        const label = tabLabel(mode);
        const cadence = showCadence ? deskModeCadenceLabel(mode) : null;
        const icon = tabIcon(mode);

        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            data-testid={`${testIdPrefix}-${mode}`}
            data-active={active ? "true" : "false"}
            data-desk-mode={mode}
            onClick={() => onChange(mode)}
            className="min-w-0 flex-1 sm:flex-none"
            style={tabStyle}
          >
            <span className="inline-flex w-full items-center gap-1.5" style={{ lineHeight: 1.15 }}>
              {icon}
              <span style={{ fontSize: showCadence ? 14 : 13 }}>{label}</span>
            </span>
            {showCadence && cadence ? (
              <span style={cadenceStyle}>{cadence}</span>
            ) : (
              <span
                className="mt-0.5 block h-0.5 w-full rounded-full"
                style={{
                  background: active ? railHue : `color-mix(in srgb, ${railHue} 35%, transparent)`,
                  opacity: active ? 1 : 0.55
                }}
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
