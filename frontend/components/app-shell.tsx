"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PageLoader } from "@/components/page-loader";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import type { AuthSession } from "@/lib/auth/types";
import { colorTokens } from "@/lib/design-system";

interface AppShellProps {
  session: AuthSession;
  children: ReactNode;
}

export function AppShell({ session, children }: AppShellProps) {
  const colors = colorTokens.dark;
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 260);
    return () => clearTimeout(timer);
  }, [pathname]);

  return (
    <>
      {loading ? <PageLoader /> : null}
      <div className="app-shell-layout" style={{ display: "grid", gridTemplateColumns: "248px 1fr", minHeight: "100vh" }}>
        <Sidebar userLabel={session.email || session.subject} />
        <div style={{ background: colors.background, minWidth: 0 }}>
          <TopBar />
          <main style={{ padding: 24 }}>{children}</main>
        </div>
      </div>
    </>
  );
}
