import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SignalValidationPageClient } from "@/components/signal-validation-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function SignalValidationPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <SignalValidationPageClient />
    </AppShell>
  );
}
