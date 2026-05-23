import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SignupAgreementsForm } from "@/components/auth/signup-agreements-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { getServerSession } from "@/lib/auth/session";
import { AGREEMENTS_BUNDLE_VERSION, SIGNUP_LEGAL_COOKIE_NAME } from "@/lib/legal-agreements";

export default function SignupAgreementsPage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }
  const jar = cookies();
  const alreadyAccepted = jar.get(SIGNUP_LEGAL_COOKIE_NAME)?.value === AGREEMENTS_BUNDLE_VERSION;

  return (
    <AuthShell
      signupStep="agreements"
      title="Agreements"
      subtitle="Review each agreement in order, then confirm below to continue. You can re-read these documents anytime after sign-in."
    >
      {alreadyAccepted ? (
        <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          <p className="m-0">
            Agreements for v{AGREEMENTS_BUNDLE_VERSION} are already recorded in this browser. Continue to email and password, or re-confirm below
            to refresh the cookie.
          </p>
          <Link
            href="/signup"
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#3b82f6] px-4 py-2.5 text-center font-semibold text-white"
          >
            I Agree — Continue to create account
          </Link>
        </div>
      ) : null}
      <SignupAgreementsForm />
      <p className="mt-6 text-sm text-slate-400">
        Already have an account?{" "}
        <Link href="/login" className="text-[#3b82f6] hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
