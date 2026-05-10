import type { ReactNode } from "react";
import { DashboardComplianceClient } from "@/components/dashboard-compliance-client";
import { SessionExpiredBanner } from "@/components/auth/session-expired-banner";
import { SessionExpiryWatcher } from "@/components/auth/session-expiry-watcher";
import { getServerSession } from "@/lib/auth/session";

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
