import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { JournalPageClient } from "@/components/journal-page-client";
import { fetchJournalEntries } from "@/lib/api/journal";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardJournalPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const entries = await fetchJournalEntries().catch(() => []);
  return (
    <AppShell session={session}>
      <JournalPageClient initialEntries={entries} />
    </AppShell>
  );
}
