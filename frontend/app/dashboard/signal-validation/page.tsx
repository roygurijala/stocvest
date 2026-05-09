import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SignalValidationPageClient } from "@/components/signal-validation-page-client";
import { getServerSession } from "@/lib/auth/session";

export default async function SignalValidationPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell session={session}>
      <SignalValidationPageClient />
    </AppShell>
  );
}
