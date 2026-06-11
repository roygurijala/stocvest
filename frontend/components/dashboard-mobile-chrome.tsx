"use client";

import { Menu } from "lucide-react";
import { StocvestTitle } from "@/components/brand/stocvest-title";
import { ThemeToggle } from "@/components/theme-toggle";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  title: string;
  onMenuClick?: () => void;
};

/**
 * Fixed mobile header for dashboard subpages (watchlists, signals, settings, …).
 * Replaces the legacy TopBar below the 900px nav-rail breakpoint.
 */
export function DashboardMobileChrome({ title, onMenuClick }: Props) {
  const { colors } = useTheme();
  const showBrand = title === "Dashboard" || title === "STOCVEST";

  return (
    <header
      data-testid="dashboard-mobile-chrome"
      className="dashboard-mobile-chrome fixed left-0 right-0 top-0 z-30 grid min-h-14 grid-cols-[auto_1fr_auto] items-center gap-2 px-4 min-[900px]:hidden"
      style={{
        paddingTop: `calc(${spacing[3]} + env(safe-area-inset-top, 0px))`,
        paddingRight: spacing[4],
        paddingBottom: spacing[3],
        paddingLeft: spacing[4],
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <button
        type="button"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border"
        style={{
          borderColor: colors.border,
          background: "transparent",
          color: colors.text,
          cursor: "pointer"
        }}
        aria-label="Open navigation menu"
        onClick={onMenuClick}
      >
        <Menu size={22} />
      </button>
      {showBrand ? (
        <div className="flex min-w-0 justify-center px-2">
          <StocvestTitle href="/dashboard" />
        </div>
      ) : (
        <h1 className="m-0 min-w-0 truncate text-center text-base font-bold">{title}</h1>
      )}
      <div className="flex shrink-0 items-center justify-end gap-2">
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Fallback height when the live mobile chrome bar is not mounted (tests, SSR). */
export const DASHBOARD_MOBILE_CHROME_HEIGHT_PX = 80;
