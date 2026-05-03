import type { ReactNode } from "react";
import { DashboardComplianceClient } from "@/components/dashboard-compliance-client";
import { getServerSession } from "@/lib/auth/session";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const session = getServerSession();
  return <DashboardComplianceClient hasSession={!!session}>{children}</DashboardComplianceClient>;
}
