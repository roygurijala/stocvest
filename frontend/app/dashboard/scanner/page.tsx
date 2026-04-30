import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ScannerPageClient } from "@/components/scanner-page-client";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardScannerPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const pdtStatus = await fetchPdtStatus().catch(() => null);
  const overview = await fetchScannerOverview(pdtStatus);
  return (
    <AppShell session={session}>
      <ScannerPageClient initialOverview={overview} initialTimestampIso={new Date().toISOString()} />
    </AppShell>
  );
}
