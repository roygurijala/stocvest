import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LegalAgreementsReview } from "@/components/legal-agreements-review";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default function DashboardLegalPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <section style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-100">Legal & agreements</h1>
        <p className="mt-2 text-sm text-slate-400">Review the version you accepted and open the current legal documents.</p>
        <div className="mt-6">
          <LegalAgreementsReview />
        </div>
      </section>
    </AppShell>
  );
}
