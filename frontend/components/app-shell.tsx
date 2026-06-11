"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DashboardMobileChrome } from "@/components/dashboard-mobile-chrome";
import { MobileNavDrawer } from "@/components/mobile-nav-drawer";
import { PageLoader } from "@/components/page-loader";
import { Sidebar } from "@/components/sidebar";
import { APP_TOP_BAR_LAYOUT_HEIGHT, TopBar } from "@/components/top-bar";
import { AppChromeProvider } from "@/lib/app-chrome-context";
import { usesTradingSessionChrome } from "@/lib/app-chrome-routes";
import { normalizeAppPathname } from "@/lib/app-pathname";
import { resolveAppPageTitle } from "@/lib/app-page-titles";
import { useStackedLayout } from "@/lib/hooks/use-stacked-layout";
import type { AuthSession } from "@/lib/auth/types";
import { resetBodyScrollLock } from "@/lib/body-scroll-lock";
import { spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

interface AppShellProps {
  session: AuthSession;
  children: ReactNode;
  /** Server-resolved admin flag — forwarded to Sidebar + MobileNavDrawer so they
   *  conditionally render the admin nav section. The backend gate is the real
   *  perimeter; this flag only controls UI visibility. */
  isAdmin?: boolean;
  /** Space between the fixed top bar and page content. Defaults to `spacing[6]`. */
  mainTopExtra?: string;
  /**
   * Flush layouts: page chrome (search/symbol bar) is fixed under the top bar;
   * `<main>` top padding is zero and spacing is reserved in-page.
   */
  mainTopLayout?: "default" | "watchlist-flush" | "signals-flush";
  /**
   * Suppress the global brand `TopBar` so the page can render its own header
   * (e.g. the dashboard's single prototype-style header bar). The page is then
   * responsible for the brand/theme controls; the mobile nav drawer is still
   * reachable via `useAppChrome().openNavDrawer`.
   */
  hideTopBar?: boolean;
}

export function AppShell({
  session,
  children,
  isAdmin = false,
  mainTopExtra = spacing[6],
  mainTopLayout = "default",
  hideTopBar = false
}: AppShellProps) {
  const mainFlushTop = mainTopLayout !== "default";
  const { colors } = useTheme();
  const pathname = usePathname();
  const normalizedPath = normalizeAppPathname(pathname);
  const compactNav = useStackedLayout(899);
  const sessionChrome = usesTradingSessionChrome(normalizedPath);
  /** Legacy TopBar is desktop-only; trading-room pages bring their own session header. */
  const suppressTopBar = hideTopBar || sessionChrome || compactNav;
  const showMobileChrome = compactNav && !sessionChrome;
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 260);
    return () => clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    setDrawerOpen(false);
    resetBodyScrollLock();
  }, [pathname]);

  const userLabel = session.email || session.subject;

  return (
    <>
      {loading ? <PageLoader /> : null}
      <div className="app-shell-layout grid min-h-screen items-start">
        <Sidebar userLabel={userLabel} isAdmin={isAdmin} />
        <div
          className="flex min-w-0 flex-col"
          data-testid="app-shell-right-column"
          style={{ background: colors.background }}
        >
          {showMobileChrome ? (
            <DashboardMobileChrome
              title={resolveAppPageTitle(normalizedPath)}
              onMenuClick={() => setDrawerOpen(true)}
            />
          ) : suppressTopBar ? null : (
            <TopBar onMenuClick={() => setDrawerOpen(true)} />
          )}
          <main
            className="min-w-0 px-4 pb-6 min-[900px]:px-6"
            data-main-top-layout={mainTopLayout}
            data-compact-nav={compactNav ? "true" : undefined}
            data-session-chrome={sessionChrome ? "true" : undefined}
            style={{
              paddingTop: sessionChrome
                ? 0
                : showMobileChrome
                  ? mainFlushTop
                    ? 0
                    : `calc(${APP_TOP_BAR_LAYOUT_HEIGHT} + env(safe-area-inset-top, 0px) + ${mainTopExtra})`
                  : mainFlushTop
                    ? 0
                    : `calc(${APP_TOP_BAR_LAYOUT_HEIGHT} + ${mainTopExtra})`
            }}
          >
            <AppChromeProvider value={{ openNavDrawer: () => setDrawerOpen(true) }}>
              {children}
            </AppChromeProvider>
          </main>
        </div>
      </div>
      <MobileNavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        userLabel={userLabel}
        isAdmin={isAdmin}
      />
    </>
  );
}
