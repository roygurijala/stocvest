"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { TradingModeBadge } from "@/components/trading-mode-badge";
import { spacing } from "@/lib/design-system";
import { brokersEnabled } from "@/lib/nav-features";
import { useTheme } from "@/lib/theme-provider";

const TITLE_BY_PATH: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/scanner": "Scanner",
  "/dashboard/earnings": "Earnings",
  "/dashboard/signals": "Signals",
  "/dashboard/signal-validation": "Signal validation",
  "/dashboard/portfolio": "Portfolio",
  "/dashboard/options": "Options",
  "/dashboard/crypto": "Crypto",
  "/dashboard/futures": "Futures",
  "/dashboard/journal": "Journal",
  "/dashboard/settings": "Settings"
};

interface TopBarProps {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const pathname = usePathname();
  const { colors } = useTheme();
  const title = useMemo(() => TITLE_BY_PATH[pathname] || "STOCVEST", [pathname]);

  return (
    <header
      data-testid="app-top-bar"
      // ``sticky top-0`` + a high z-index keeps the page chrome
      // visible while the body scrolls. The AppShell right column
      // intentionally avoids ``overflow-*`` properties so this
      // element pins to the viewport rather than to an inner scroll
      // container. ``z-30`` sits below modals/drawers (which use 40+)
      // but above page content. ``backdrop-blur-sm`` softens the
      // boundary when content scrolls underneath; the background is
      // still mostly opaque so legibility is preserved on themes that
      // don't support backdrop filters.
      className="sticky top-0 z-30 flex min-h-14 items-center gap-2 px-4 backdrop-blur-sm lg:justify-between lg:px-6"
      style={{
        paddingTop: spacing[3],
        paddingBottom: spacing[3],
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <button
        type="button"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border lg:hidden"
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
      <h1 className="m-0 min-w-0 flex-1 truncate text-center text-lg font-bold lg:flex-none lg:text-left lg:text-xl">{title}</h1>
      <div className="flex shrink-0 items-center justify-end gap-2">
        {brokersEnabled() ? <TradingModeBadge /> : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
