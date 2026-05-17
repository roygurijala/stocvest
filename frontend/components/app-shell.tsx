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
}

export function AppShell({ session, children, isAdmin = false }: AppShellProps) {
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
      <div className="app-shell-layout grid min-h-[100dvh] grid-cols-1 lg:grid-cols-[248px_1fr]">
        <Sidebar userLabel={userLabel} isAdmin={isAdmin} />
        <div
          className="flex h-[100dvh] max-h-[100dvh] min-h-0 min-w-0 flex-col"
          data-testid="app-shell-right-column"
          style={{ background: colors.background }}
        >
          <TopBar onMenuClick={() => setDrawerOpen(true)} />
          <main
            data-app-scroll-root
            className="min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto overscroll-y-contain px-4 pb-6 lg:px-6"
            style={{
              paddingTop: `calc(${APP_TOP_BAR_LAYOUT_HEIGHT} + ${spacing[6]})`
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
