import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CuteLoader } from "@/components/cute-loader";
import { SettingsPageClient } from "@/components/settings-page-client";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardSettingsPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session}>
      <Suspense fallback={<CuteLoader label="Loading settings" sublabel="Syncing your account preferences" compact />}>
        <SettingsPageClient email={session.email ?? "unknown@stocvest.local"} />
      </Suspense>
    </AppShell>
  );
}
