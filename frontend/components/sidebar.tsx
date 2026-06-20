"use client";

import { Fragment, useContext, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  BadgeCheck,
  BookOpen,
  Bookmark,
  Briefcase,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  HelpCircle,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Radio,
  ScrollText,
  Settings,
  ShieldCheck,
  Target,
  Timer,
  TrendingUp,
  Users
} from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { clearAssistantSession } from "@/lib/assistant/session-reset";
import { clearTradingRoomClientSession } from "@/lib/dashboard/trading-room/session-selection";
import { openCrispChat } from "@/components/crisp-chat";
import { isDashboardNavItemActive } from "@/lib/dashboard-nav-active";
import { useMarketSessionPhase } from "@/lib/hooks/use-market-session-phase";
import type { MarketSessionPhase } from "@/lib/market-hours-et";
import { isDashboardNavItemEnabled, type NavFeatureKey } from "@/lib/nav-features";

export { NAV_FEATURES } from "@/lib/nav-features";
import { useTheme } from "@/lib/theme-provider";
import { UserProfileContext } from "@/lib/user-profile-context";
import { TrialSidebarPill } from "@/components/trial/trial-sidebar-pill";
import type { LucideIcon } from "lucide-react";

interface SidebarProps {
  userLabel: string;
  /** Whether to render admin-gated nav items. Resolved by the server (dashboard
   *  layout reads `getServerSession()` + `isSessionAdmin()` and forwards). The
   *  backend gate is the real perimeter; this flag only controls UI visibility. */
  isAdmin?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  feature?: NavFeatureKey;
}

/**
 * Destinations grouped into the three nav sections (Trading / Analysis /
 * System). Feature-gated items (`feature`) are filtered by
 * `isDashboardNavItemEnabled` so plan/flag-gated surfaces stay hidden.
 */
export const NAV_SECTIONS: ReadonlyArray<{ id: string; label: string; items: ReadonlyArray<NavItem> }> = [
  {
    id: "trading",
    label: "Trading",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/dashboard/scanner", label: "Scanner", icon: Radio },
      { href: "/dashboard/watchlists", label: "Watchlist", icon: Bookmark }
    ]
  },
  {
    id: "analysis",
    label: "Analysis",
    items: [
      { href: "/dashboard/setup-evolution", label: "Setup evolution", icon: History },
      { href: "/dashboard/setup-outcomes", label: "Setup outcomes", icon: ClipboardList },
      { href: "/dashboard/plans", label: "Trade plans", icon: Target },
      { href: "/dashboard/earnings", label: "Earnings", icon: CalendarDays },
      { href: "/dashboard/portfolio", label: "Portfolio", icon: Briefcase, feature: "brokersEnabled" },
      { href: "/dashboard/options", label: "Options", icon: Layers, feature: "options" },
      { href: "/dashboard/crypto", label: "Crypto", icon: TrendingUp, feature: "crypto" },
      { href: "/dashboard/futures", label: "Futures", icon: BarChart2, feature: "futures" },
      { href: "/dashboard/journal", label: "Journal", icon: BookOpen, feature: "brokersEnabled" }
    ]
  },
  {
    id: "system",
    label: "System",
    items: [
      { href: "/dashboard/legal", label: "Legal & agreements", icon: BadgeCheck },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
      { href: "/how-it-works", label: "How it works", icon: HelpCircle }
    ]
  }
];

/**
 * Flattened nav list — preserved as a named export for back-compatibility
 * with existing tests and any consumers that import the destination set.
 */
export const DASHBOARD_NAV_ITEMS: ReadonlyArray<NavItem> = NAV_SECTIONS.flatMap((s) => s.items);

/**
 * Admin-only nav items, rendered as a collapsible group when the
 * server-side `isSessionAdmin()` check passes. Order is intentional:
 * Overview first (entry point) → high-touch operations → maintenance.
 * The backend gate (`analysis_authorized()`) remains the real perimeter.
 */
export const DASHBOARD_ADMIN_NAV_ITEMS: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
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
 * Persisted-expand state for the Admin collapsible group. Defaults to
 * collapsed; localStorage keeps the choice across navigations. Auto-expands
 * when the current route is under `/dashboard/admin` so sub-items are
 * reachable. SSR-safe (no `window` until effect).
 */
function useAdminNavExpanded(autoExpand: boolean): [boolean, (next: boolean) => void] {
  const [expanded, setExpanded] = useState<boolean>(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(ADMIN_NAV_STORAGE_KEY) === "1") setExpanded(true);
    } catch {
      /* SSR / disabled storage — keep collapsed. */
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
      /* ignore */
    }
  };

  return [expanded, set];
}

function initialsFromLabel(label: string): string {
  const base = (label || "").replace(/@.*/, "").trim();
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const letters = (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : base.slice(0, 2)).toUpperCase();
  return letters || "U";
}

export function Sidebar({ userLabel, isAdmin = false }: SidebarProps) {
  const pathname = usePathname();
  const { theme, colors } = useTheme();
  const { profile } = useContext(UserProfileContext);
  const pathInAdmin = pathname === "/dashboard/admin" || pathname.startsWith("/dashboard/admin/");
  const [adminExpanded, setAdminExpanded] = useAdminNavExpanded(pathInAdmin && isAdmin);
  const adminActive = isAdmin && pathInAdmin;

  // Status orb reflects the live session phase rather than a fixed "live" state.
  const sessionPhase = useMarketSessionPhase();
  const orbInfo: Record<MarketSessionPhase, { label: string; color: string }> = {
    pre: { label: "Pre-market", color: colors.accent },
    live: { label: "Markets live", color: colors.bullish ?? "#22c55e" },
    post: { label: "After hours", color: colors.caution ?? "#f59e0b" },
    closed: { label: "Markets closed", color: colors.textMuted }
  };
  const orb = orbInfo[sessionPhase];
  const orbGlow = sessionPhase === "closed" ? "none" : `0 0 8px 1px ${orb.color}66`;

  // Theme tokens → CSS custom properties consumed by the `.lnav-*` rules in
  // globals.css (so hover/active states are pure CSS but stay theme-aware).
  // In dark mode the rail uses the prototype's distinct near-black (`#0a0c10`,
  // a touch darker than the page background) with a soft border, so it reads as
  // its own recessed rail rather than blending into the content. Light mode
  // keeps the lighter `surface` panel.
  const railSurface = theme === "dark" ? "#0a0c10" : colors.surface;
  const railBorder = theme === "dark" ? "#1f242e" : colors.border;
  const navVars = {
    "--lnav-surface": railSurface,
    "--lnav-border": railBorder,
    "--lnav-text": colors.textMuted,
    "--lnav-strong": colors.text,
    "--lnav-dim": colors.textMuted,
    "--lnav-hover": "rgba(255,255,255,0.04)",
    "--lnav-active": colors.bullish ?? "#22C55E",
    "--lnav-active-bg": "rgba(34,197,94,0.09)",
    "--lnav-active-glow": "rgba(34,197,94,0.55)"
  } as CSSProperties;

  return (
    <aside className="lnav" style={navVars} data-testid="app-sidebar">
      <div className="lnav-rail">
        <div className="lnav-orb" title={orb.label}>
          <span className="o" style={{ background: orb.color, boxShadow: orbGlow }} />
          <span className="lnav-fade">{orb.label}</span>
        </div>

        <div className="lnav-scroll">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter(isDashboardNavItemEnabled);
            if (items.length === 0 && section.id !== "system") return null;
            return (
              <Fragment key={section.id}>
                <div className="lnav-sec lnav-fade">{section.label}</div>
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isDashboardNavItemActive(pathname, item.href);
                  return (
                    <Link key={item.href} href={item.href} className={`lnav-item${active ? " active" : ""}`}>
                      <span className="lnav-ic">
                        <Icon size={18} />
                      </span>
                      <span className="lnav-label lnav-fade">{item.label}</span>
                    </Link>
                  );
                })}

                {section.id === "system" && isAdmin ? (
                  <>
                    <button
                      type="button"
                      data-testid="sidebar-admin-toggle"
                      data-expanded={adminExpanded}
                      aria-expanded={adminExpanded}
                      aria-controls="sidebar-admin-items"
                      onClick={() => setAdminExpanded(!adminExpanded)}
                      className={`lnav-item${adminActive ? " active" : ""}${adminExpanded ? " open" : ""}`}
                    >
                      <span className="lnav-ic">
                        <ShieldCheck size={18} />
                      </span>
                      <span className="lnav-label lnav-fade">Admin</span>
                      {!adminExpanded ? <span className="lnav-dot amber" /> : null}
                      <ChevronRight className="lnav-caret lnav-fade" size={14} aria-hidden />
                    </button>
                    <div id="sidebar-admin-items" className="lnav-sub">
                      {DASHBOARD_ADMIN_NAV_ITEMS.map((item) => {
                        const active = isDashboardNavItemActive(pathname, item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            data-testid={`sidebar-admin-item-${item.href}`}
                            className={`lnav-subitem lnav-fade${active ? " active" : ""}`}
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </Fragment>
            );
          })}
        </div>

        <div className="lnav-foot">
          <div className="lnav-fade" style={{ padding: "0 12px 6px" }}>
            <TrialSidebarPill profile={profile} />
          </div>
          <div className="lnav-user">
            <span className="lnav-av">{initialsFromLabel(userLabel)}</span>
            <span className="lnav-who lnav-fade">
              <div className="nm" title={userLabel}>
                {userLabel}
              </div>
              <div className="role">{isAdmin ? "Admin · STOCVEST" : "Member"}</div>
            </span>
          </div>
          <button
            type="button"
            onClick={() => openCrispChat()}
            title="Share feedback or report issues"
            className="lnav-item"
          >
            <span className="lnav-ic">
              <MessageCircle size={18} />
            </span>
            <span className="lnav-label lnav-fade">Send feedback</span>
          </button>
          <form action={logoutAction}>
            <button
              type="submit"
              onClick={() => {
                clearAssistantSession();
                clearTradingRoomClientSession();
              }}
              className="lnav-item lnav-signout"
            >
              <span className="lnav-ic">
                <LogOut size={18} />
              </span>
              <span className="lnav-label lnav-fade">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
