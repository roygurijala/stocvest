import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminProposalsPageClient } from "@/components/admin-proposals-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

/**
 * Admin proposal-review page (D10 Phase 3a / 3b).
 *
 * The frontend gate here mirrors the backend `analysis_authorized()` gate:
 *
 * - Unauthenticated callers redirect to `/login` (no leakage that the page
 *   exists at all — same as every other authenticated dashboard page).
 * - Authenticated callers without the `signal-analytics-admin` Cognito
 *   group redirect to `/dashboard` (calm-redirect; not a 404 so admins
 *   accidentally signed in with a non-admin session get nudged back to
 *   the dashboard without seeing a broken page).
 *
 * The backend gate is the **real** perimeter — the BFF routes attach the
 * httpOnly JWT to every upstream call and `analysis_authorized()` runs on
 * each request. A malicious user who bypasses this redirect (e.g. by
 * calling the BFF route directly from devtools) still gets a 403 from the
 * backend.
 */
export default async function AdminProposalsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <AdminProposalsPageClient />
    </AppShell>
  );
}
