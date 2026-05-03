"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart2,
  BookOpen,
  Bookmark,
  Briefcase,
  Layers,
  LayoutDashboard,
  LogOut,
  Radio,
  CalendarDays,
  Settings,
  TrendingUp,
  Zap,
  Percent
} from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { openCrispChat } from "@/components/crisp-chat";
import { isDashboardNavItemActive } from "@/lib/dashboard-nav-active";
import { spacing, borderRadius, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

interface SidebarProps {
  userLabel: string;
}

export const DASHBOARD_NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/scanner", label: "Scanner", icon: Radio },
  { href: "/dashboard/watchlists", label: "Watchlists", icon: Bookmark },
  { href: "/dashboard/signals", label: "Signals", icon: Zap },
  { href: "/dashboard/earnings", label: "Earnings", icon: CalendarDays },
  { href: "/dashboard/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/dashboard/options", label: "Options", icon: Layers },
  { href: "/dashboard/crypto", label: "Crypto", icon: TrendingUp },
  { href: "/dashboard/futures", label: "Futures", icon: BarChart2 },
  { href: "/dashboard/journal", label: "Journal", icon: BookOpen },
  { href: "/dashboard/performance", label: "Performance", icon: Percent },
  { href: "/dashboard/settings", label: "Settings", icon: Settings }
] as const;

export function Sidebar({ userLabel }: SidebarProps) {
  const pathname = usePathname();
  const { colors } = useTheme();

  return (
    <aside
      className="relative hidden h-screen w-[248px] shrink-0 flex-col lg:flex lg:flex-col"
      style={{
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`
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
        {DASHBOARD_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = isDashboardNavItemActive(pathname, item.href);
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
        className="sidebar-footer relative"
        style={{
          padding: spacing[4],
          paddingBottom: `calc(${spacing[6]} + 22px)`,
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
        <button
          type="button"
          onClick={() => openCrispChat()}
          title="Share feedback or report issues"
          className="sidebar-feedback-link transition-colors hover:[color:var(--color-text-secondary)]"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            margin: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
            textAlign: "left",
            fontSize: "11px",
            color: "var(--color-text-tertiary)",
            textDecoration: "none",
            padding: "4px 16px",
            display: "block",
            letterSpacing: "0.3px"
          }}
        >
          Send feedback
        </button>
      </div>
    </aside>
  );
}
