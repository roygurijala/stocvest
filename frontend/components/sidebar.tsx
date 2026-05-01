"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart2,
  BookOpen,
  Briefcase,
  Layers,
  LayoutDashboard,
  LogOut,
  Radio,
  CalendarDays,
  Settings,
  TrendingUp,
  Zap
} from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { spacing, borderRadius, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

interface SidebarProps {
  userLabel: string;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/scanner", label: "Scanner", icon: Radio },
  { href: "/dashboard/earnings", label: "Earnings", icon: CalendarDays },
  { href: "/dashboard/signals", label: "Signals", icon: Zap },
  { href: "/dashboard/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/dashboard/options", label: "Options", icon: Layers },
  { href: "/dashboard/crypto", label: "Crypto", icon: TrendingUp },
  { href: "/dashboard/futures", label: "Futures", icon: BarChart2 },
  { href: "/dashboard/journal", label: "Journal", icon: BookOpen },
  { href: "/dashboard/settings", label: "Settings", icon: Settings }
] as const;

export function Sidebar({ userLabel }: SidebarProps) {
  const pathname = usePathname();
  const { colors } = useTheme();

  return (
    <aside
      style={{
        width: "100%",
        maxWidth: 248,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        height: "100vh",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <div style={{ padding: spacing[6], borderBottom: `1px solid ${colors.border}` }}>
        <Link
          href="/dashboard"
          style={{
            color: colors.accent,
            fontWeight: 700,
            fontSize: typography.scale.xl,
            letterSpacing: "0.03em"
          }}
        >
          STOCVEST
        </Link>
      </div>

      <nav
        style={{
          padding: spacing[4],
          display: "grid",
          gap: spacing[2],
          alignContent: "start",
          flexGrow: 1,
          overflowY: "auto",
          minHeight: 0
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="sidebar-nav-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing[3],
                borderRadius: borderRadius.md,
                padding: `${spacing[2]} ${spacing[3]}`,
                borderLeft: `3px solid ${isActive ? colors.accent : "transparent"}`,
                background: isActive ? "rgba(59,130,246,0.12)" : "transparent",
                color: isActive ? colors.accent : colors.text,
                fontSize: typography.scale.sm,
                fontWeight: isActive ? 600 : 500
              }}
            >
              <Icon size={18} />
              <span className="sidebar-nav-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div
        style={{
          padding: spacing[4],
          borderTop: `1px solid ${colors.border}`,
          display: "grid",
          gap: spacing[3],
          flexShrink: 0
        }}
      >
        <p
          className="sidebar-user-label"
          style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, overflowWrap: "anywhere" }}
        >
          {userLabel}
        </p>
        <form action={logoutAction}>
          <button
            type="submit"
            className="sidebar-signout-btn"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing[2],
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              padding: `${spacing[2]} ${spacing[3]}`,
              background: "transparent",
              color: colors.text,
              cursor: "pointer",
              fontSize: typography.scale.sm
            }}
          >
            <LogOut size={16} />
            <span className="sidebar-signout-label">Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
