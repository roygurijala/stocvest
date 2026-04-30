"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { colorTokens, spacing, typography } from "@/lib/design-system";

const TITLE_BY_PATH: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/scanner": "Scanner",
  "/signals": "Signals",
  "/portfolio": "Portfolio",
  "/options": "Options",
  "/crypto": "Crypto",
  "/futures": "Futures",
  "/journal": "Journal",
  "/settings": "Settings"
};

export function TopBar() {
  const pathname = usePathname();
  const colors = colorTokens.dark;
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
