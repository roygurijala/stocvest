import type { ReactNode } from "react";
import { DashboardComplianceClient } from "@/components/dashboard-compliance-client";
import { SessionExpiredBanner } from "@/components/auth/session-expired-banner";
import { SessionExpiryWatcher } from "@/components/auth/session-expiry-watcher";
import { StocvestAssistant } from "@/components/assistant/stocvest-assistant";
import { AssistantContextProvider } from "@/lib/assistant/context";
import { getServerSession } from "@/lib/auth/session";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const session = getServerSession();
  return (
    <DashboardComplianceClient hasSession={!!session}>
      <SessionExpiryWatcher />
      <SessionExpiredBanner />
      <AssistantContextProvider>
        {children}
        <StocvestAssistant />
      </AssistantContextProvider>
    </DashboardComplianceClient>
  );
}
