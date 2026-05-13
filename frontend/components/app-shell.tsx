"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MobileNavDrawer } from "@/components/mobile-nav-drawer";
import { PageLoader } from "@/components/page-loader";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import type { AuthSession } from "@/lib/auth/types";
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
        {/* Right column intentionally drops the previous
            ``overflow-x-hidden`` from this wrapper — that property
            promotes the element to a scroll container, which then
            captures ``position: sticky`` on the ``TopBar`` and
            prevents it from sticking to the viewport. Horizontal
            overflow protection moves down to ``<main>`` (the actual
            content surface that can grow wide), so the TopBar can
            stay pinned at ``top: 0`` during page scroll. */}
        <div
          className="flex min-w-0 flex-col"
          data-testid="app-shell-right-column"
          style={{ background: colors.background }}
        >
          <TopBar onMenuClick={() => setDrawerOpen(true)} />
          <main className="min-w-0 overflow-x-hidden px-4 py-6 lg:px-6">{children}</main>
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
