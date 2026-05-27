"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MobileNavDrawer } from "@/components/mobile-nav-drawer";
import { PageLoader } from "@/components/page-loader";
import { Sidebar } from "@/components/sidebar";
import { APP_TOP_BAR_LAYOUT_HEIGHT, TopBar } from "@/components/top-bar";
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
}

export function AppShell({
  session,
  children,
  isAdmin = false,
  mainTopExtra = spacing[6],
  mainTopLayout = "default"
}: AppShellProps) {
  const mainFlushTop = mainTopLayout !== "default";
  const { colors } = useTheme();
  const pathname = usePathname();
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
      <div className="app-shell-layout grid min-h-screen grid-cols-1 items-start lg:grid-cols-[248px_1fr]">
        <Sidebar userLabel={userLabel} isAdmin={isAdmin} />
        <div
          className="flex min-w-0 flex-col"
          data-testid="app-shell-right-column"
          style={{ background: colors.background }}
        >
          <TopBar onMenuClick={() => setDrawerOpen(true)} />
          <main
            className="min-w-0 px-4 pb-6 lg:px-6"
            data-main-top-layout={mainTopLayout}
            style={{
              paddingTop: mainFlushTop ? 0 : `calc(${APP_TOP_BAR_LAYOUT_HEIGHT} + ${mainTopExtra})`
            }}
          >
            {children}
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
