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
}

export function AppShell({ session, children }: AppShellProps) {
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
        <Sidebar userLabel={userLabel} />
        <div className="min-w-0 overflow-x-hidden" style={{ background: colors.background }}>
          <TopBar onMenuClick={() => setDrawerOpen(true)} />
          <main className="min-w-0 px-4 py-6 lg:px-6">{children}</main>
        </div>
      </div>
      <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} userLabel={userLabel} />
    </>
  );
}
