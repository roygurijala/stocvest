"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  BookOpen,
  Bookmark,
  Briefcase,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Radio,
  CalendarDays,
  ScrollText,
  Settings,
  ShieldCheck,
  Timer,
  TrendingUp,
  Users,
  Zap,
  BadgeCheck
} from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { clearAssistantSession } from "@/lib/assistant/session-reset";
import { openCrispChat } from "@/components/crisp-chat";
import { isDashboardNavItemActive } from "@/lib/dashboard-nav-active";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { isDashboardNavItemEnabled, type NavFeatureKey } from "@/lib/nav-features";

export { NAV_FEATURES } from "@/lib/nav-features";
import { useTheme } from "@/lib/theme-provider";
import { StocvestTitle } from "@/components/brand/stocvest-title";
import type { LucideIcon } from "lucide-react";

interface SidebarProps {
  userLabel: string;
  /** Whether to render admin-gated nav items. Resolved by the server (dashboard
   *  layout reads `getServerSession()` + `isSessionAdmin()` and forwards). */
  isAdmin?: boolean;
}

export const DASHBOARD_NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  icon: LucideIcon;
  feature?: NavFeatureKey;
}> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/scanner", label: "Scanner", icon: Radio },
  { href: "/dashboard/watchlists", label: "Watchlists", icon: Bookmark },
  { href: "/dashboard/signals", label: "Signals", icon: Zap },
  { href: "/dashboard/setup-evolution", label: "Setup evolution", icon: History },
  { href: "/dashboard/setup-outcomes", label: "Setup outcomes", icon: ClipboardList },
  { href: "/dashboard/earnings", label: "Earnings", icon: CalendarDays },
  { href: "/dashboard/portfolio", label: "Portfolio", icon: Briefcase, feature: "brokersEnabled" },
  { href: "/dashboard/options", label: "Options", icon: Layers, feature: "options" },
  { href: "/dashboard/crypto", label: "Crypto", icon: TrendingUp, feature: "crypto" },
  { href: "/dashboard/futures", label: "Futures", icon: BarChart2, feature: "futures" },
  { href: "/dashboard/journal", label: "Journal", icon: BookOpen, feature: "brokersEnabled" },
  { href: "/dashboard/legal", label: "Legal & agreements", icon: BadgeCheck },
  { href: "/dashboard/settings", label: "Settings", icon: Settings }
];

/**
 * Admin-only nav items, rendered as a collapsible group when the
 * server-side `isSessionAdmin()` check passes. Order is intentional:
 * Overview first (entry point) → high-touch operations → maintenance.
 *
 * The backend gate (`analysis_authorized()`) is still the real
 * perimeter on every request — hiding the nav is a UX courtesy only.
 */
export const DASHBOARD_ADMIN_NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  icon: LucideIcon;
}> = [
  { href: "/dashboard/admin", label: "Overview", icon: Activity },
  { href: "/dashboard/admin/proposals", label: "Weight proposals", icon: ShieldCheck },
  { href: "/dashboard/admin/parameters", label: "Parameters", icon: History },
  { href: "/dashboard/admin/historical-validation", label: "Historical validation", icon: ClipboardList },
  { href: "/dashboard/admin/users", label: "Users", icon: Users },
  { href: "/dashboard/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/dashboard/admin/error-logs", label: "Error logs", icon: AlertTriangle },
  { href: "/dashboard/admin/dashboard-timing", label: "Dashboard timing", icon: Timer }
];

const ADMIN_NAV_STORAGE_KEY = "stocvest:sidebar:admin-expanded";

/**
 * Hook: persisted-expand state for the Admin collapsible group.
 *
 * Defaults to **collapsed** on first paint — admin users care about the
 * 14 main-nav items 95% of the time. localStorage keeps the choice
 * across navigations and reloads. The hook is SSR-safe (no `window`
 * reference until `useEffect`) so the sidebar can server-render the
 * collapsed state without hydration mismatch.
 *
 * Auto-expand override: if the current pathname is under
 * `/dashboard/admin`, the group is shown expanded regardless of stored
 * preference. The operator is clearly inside the admin surface, so the
 * sub-items must be visible to navigate between them.
 */
function useAdminNavExpanded(autoExpand: boolean): [boolean, (next: boolean) => void] {
  const [expanded, setExpanded] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ADMIN_NAV_STORAGE_KEY);
      if (stored === "1") setExpanded(true);
    } catch {
      // SSR / disabled storage — keep collapsed.
    }
  }, []);

  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  const set = (next: boolean) => {
    setExpanded(next);
    try {
      window.localStorage.setItem(ADMIN_NAV_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  return [expanded, set];
}

export function Sidebar({ userLabel, isAdmin = false }: SidebarProps) {
  const pathname = usePathname();
  const { colors } = useTheme();
  const adminItems = isAdmin ? DASHBOARD_ADMIN_NAV_ITEMS : [];
  const pathInAdmin =
    pathname === "/dashboard/admin" || pathname.startsWith("/dashboard/admin/");
  const [adminExpanded, setAdminExpanded] = useAdminNavExpanded(pathInAdmin && isAdmin);
  const adminActive = isAdmin && pathInAdmin;

  return (
    <aside
      className="relative hidden w-[248px] shrink-0 flex-col lg:sticky lg:top-0 lg:flex lg:max-h-screen lg:flex-col lg:self-start"
      style={{
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`
      }}
    >
      <div
        className="flex min-h-14 shrink-0 items-center justify-center border-b px-5"
        style={{
          paddingTop: spacing[3],
          paddingBottom: spacing[3],
          borderBottomColor: colors.border
        }}
      >
        <StocvestTitle href="/dashboard" />
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
        {DASHBOARD_NAV_ITEMS.filter(isDashboardNavItemEnabled).map((item) => {
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
        {adminItems.length > 0 ? (
          <div
            data-testid="sidebar-admin-section"
            style={{
              marginTop: spacing[3],
              paddingTop: spacing[3],
              borderTop: `1px solid ${colors.border}`,
              display: "grid",
              gap: spacing[1]
            }}
          >
            <button
              type="button"
              data-testid="sidebar-admin-toggle"
              data-expanded={adminExpanded}
              aria-expanded={adminExpanded}
              aria-controls="sidebar-admin-items"
              onClick={() => setAdminExpanded(!adminExpanded)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing[3],
                width: "100%",
                borderRadius: borderRadius.md,
                padding: `${spacing[2]} ${spacing[3]}`,
                borderLeft: `3px solid ${adminActive ? colors.accent : "transparent"}`,
                border: "none",
                borderTop: "none",
                borderRight: "none",
                borderBottom: "none",
                background: adminActive && !adminExpanded ? "rgba(59,130,246,0.12)" : "transparent",
                color: adminActive ? colors.accent : colors.text,
                fontSize: typography.scale.sm,
                fontWeight: adminActive ? 600 : 500,
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              <ShieldCheck size={18} />
              <span className="sidebar-nav-label" style={{ flex: 1 }}>
                Admin
              </span>
              {adminExpanded ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
            </button>
            {adminExpanded ? (
              <div
                id="sidebar-admin-items"
                style={{
                  display: "grid",
                  gap: spacing[1],
                  paddingLeft: spacing[3]
                }}
              >
                {adminItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isDashboardNavItemActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="sidebar-nav-item"
                      data-testid={`sidebar-admin-item-${item.href}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: spacing[3],
                        borderRadius: borderRadius.md,
                        padding: `${spacing[2]} ${spacing[3]}`,
                        borderLeft: `2px solid ${isActive ? colors.accent : colors.border}`,
                        background: isActive ? "rgba(59,130,246,0.12)" : "transparent",
                        color: isActive ? colors.accent : colors.text,
                        fontSize: typography.scale.sm,
                        fontWeight: isActive ? 600 : 500
                      }}
                    >
                      <Icon size={16} />
                      <span className="sidebar-nav-label">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </nav>

      <div
        className="sidebar-footer"
        style={{
          padding: spacing[4],
          borderTop: `1px solid ${colors.border}`,
          flexShrink: 0
        }}
      >
        <div
          className={surfaceGlowClassName}
          style={{
            display: "grid",
            gap: spacing[3],
            padding: spacing[3],
            borderRadius: borderRadius.lg,
            background: colors.surfaceMuted,
            border: `1px solid ${colors.border}`
          }}
        >
          <p
            className="sidebar-user-label"
            style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, overflowWrap: "anywhere", lineHeight: 1.4 }}
          >
            {userLabel}
          </p>
          <form action={logoutAction}>
            <button
              type="submit"
              onClick={() => clearAssistantSession()}
              className="sidebar-signout-btn"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing[2],
                minHeight: 44,
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.border}`,
                padding: `${spacing[2]} ${spacing[3]}`,
                background: colors.surface,
                color: colors.text,
                cursor: "pointer",
                fontSize: typography.scale.sm,
                fontWeight: 600
              }}
            >
              <LogOut size={18} strokeWidth={2} />
              <span className="sidebar-signout-label">Sign out</span>
            </button>
          </form>
          <button
            type="button"
            onClick={() => openCrispChat()}
            title="Share feedback or report issues"
            className="sidebar-feedback-link"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing[2],
              minHeight: 40,
              borderRadius: borderRadius.md,
              border: `1px dashed ${colors.border}`,
              padding: `${spacing[2]} ${spacing[3]}`,
              background: "transparent",
              cursor: "pointer",
              fontSize: typography.scale.sm,
              fontWeight: 500,
              color: colors.textMuted
            }}
          >
            <MessageCircle size={16} strokeWidth={2} aria-hidden />
            Send feedback
          </button>
        </div>
      </div>
    </aside>
  );
}
