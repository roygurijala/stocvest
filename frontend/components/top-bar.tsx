"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const TITLE_BY_PATH: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/scanner": "Scanner",
  "/dashboard/signals": "Signals",
  "/dashboard/portfolio": "Portfolio",
  "/dashboard/options": "Options",
  "/dashboard/crypto": "Crypto",
  "/dashboard/futures": "Futures",
  "/dashboard/journal": "Journal",
  "/dashboard/settings": "Settings"
};

export function TopBar() {
  const pathname = usePathname();
  const { colors } = useTheme();
  const title = useMemo(() => TITLE_BY_PATH[pathname] || "STOCVEST", [pathname]);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `${spacing[4]} ${spacing[6]}`,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <h1 style={{ margin: 0, fontSize: typography.scale.xl, fontWeight: 700 }}>{title}</h1>
      <ThemeToggle />
    </header>
  );
}
