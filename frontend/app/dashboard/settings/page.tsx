import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SettingsPageClient } from "@/components/settings-page-client";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardSettingsPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session}>
      <SettingsPageClient email={session.email ?? "unknown@stocvest.local"} />
    </AppShell>
  );
}
