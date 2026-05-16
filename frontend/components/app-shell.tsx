"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MobileNavDrawer } from "@/components/mobile-nav-drawer";
import { PageLoader } from "@/components/page-loader";
import { Sidebar } from "@/components/sidebar";
import { APP_TOP_BAR_LAYOUT_HEIGHT, TopBar } from "@/components/top-bar";
import type { AuthSession } from "@/lib/auth/types";
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
  }, [pathname]);

  const userLabel = session.email || session.subject;

  return (
    <>
      {loading ? <PageLoader /> : null}
      <div className="app-shell-layout grid min-h-screen grid-cols-1 lg:grid-cols-[248px_1fr]">
        <Sidebar userLabel={userLabel} isAdmin={isAdmin} />
        {/* Right column avoids ``overflow-x-hidden`` on this wrapper so we never
            promote it to a scroll container. Horizontal clipping lives on ``<main>``
            via ``overflow-x-clip`` (keeps ``position: sticky`` working on long pages).
            The TopBar is ``position: fixed`` (see ``top-bar.tsx``); ``main`` padding-top
            clears that chrome. */}
        <div
          className="flex min-w-0 flex-col"
          data-testid="app-shell-right-column"
          style={{ background: colors.background }}
        >
          <TopBar onMenuClick={() => setDrawerOpen(true)} />
          <main
            className="min-w-0 overflow-x-clip px-4 pb-6 lg:px-6"
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
