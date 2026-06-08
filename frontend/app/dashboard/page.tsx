import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContentLoading } from "@/components/content-loading";
import { TradingRoomPreviewContent } from "@/components/dashboard/trading-room/trading-room-preview-content";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

/** Dashboard chains market + scanner API work; must exceed client apiFetch and timeoutFallback budgets. */
export const maxDuration = 60;

function firstNameFromEmail(email: string | undefined): string | null {
  if (!email?.trim()) return null;
  const local = email.split("@")[0]?.split(/[._-]/)[0]?.trim();
  if (!local) return null;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Real first name from the Cognito token when available; tidy email-derived name as fallback. */
function resolveGreetingName(session: { firstName?: string; email?: string }): string | null {
  const claim = session.firstName?.trim();
  if (claim) return claim.charAt(0).toUpperCase() + claim.slice(1);
  return firstNameFromEmail(session.email);
}

export default function DashboardPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session} isAdmin={isAdmin} hideTopBar>
      <Suspense fallback={<ContentLoading />}>
        <TradingRoomPreviewContent userName={resolveGreetingName(session)} />
      </Suspense>
    </AppShell>
  );
}
