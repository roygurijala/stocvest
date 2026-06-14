import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SignupForm } from "@/components/auth/signup-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { getServerSession } from "@/lib/auth/session";
import { AGREEMENTS_BUNDLE_VERSION, SIGNUP_LEGAL_COOKIE_NAME } from "@/lib/legal-agreements";

export default function SignupPage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }
  const jar = cookies();
  if (jar.get(SIGNUP_LEGAL_COOKIE_NAME)?.value !== AGREEMENTS_BUNDLE_VERSION) {
    redirect("/signup/agreements");
  }

  return (
    <AuthShell
      signupStep="account"
      title="Create your account."
      subtitle="Tell us a bit about you so we can personalize your experience. First name is used in your Market Brief and across the app."
    >
      <SignupForm />
      <p className="mt-4 text-sm text-slate-400">
        Already have an account?{" "}
        <Link href="/login" className="text-[#3b82f6] hover:underline">
          Sign in
        </Link>
      </p>
      <p className="mt-3 text-xs text-slate-500">
        Agreements for v{AGREEMENTS_BUNDLE_VERSION} are recorded in this browser. If you need to re-read them,{" "}
        <Link href="/signup/agreements" className="text-slate-400 hover:text-slate-300">
          return to the agreements step
        </Link>{" "}
        (you will need to check the box again).
      </p>
    </AuthShell>
  );
}
