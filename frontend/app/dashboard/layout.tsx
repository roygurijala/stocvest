import type { ReactNode } from "react";
import { DashboardComplianceClient } from "@/components/dashboard-compliance-client";
import { SessionExpiredBanner } from "@/components/auth/session-expired-banner";
import { SessionExpiryWatcher } from "@/components/auth/session-expiry-watcher";
import { getServerSession } from "@/lib/auth/session";

/**
 * The STOCVEST Assistant + AssistantContextProvider live in the **root** layout
 * (`app/layout.tsx`), gated on `getServerSession()` so logged-in users get the assistant on
 * every authenticated route (dashboard + any marketing route they navigate back to). The
 * dashboard layout only adds dashboard-specific compliance + session-watcher chrome on top.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const session = getServerSession();
  return (
    <DashboardComplianceClient hasSession={!!session}>
      <SessionExpiryWatcher />
      <SessionExpiredBanner />
      {children}
    </DashboardComplianceClient>
  );
}
