import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="grid min-h-screen place-items-center overflow-x-hidden bg-[#0a0e1a] px-4 py-8 sm:py-10">
      <section className="w-full max-w-full rounded-xl border border-white/10 bg-[#111827] p-4 shadow-[0_0_30px_rgba(0,0,0,0.35)] sm:max-w-md sm:p-6">
        <p className="mb-3 text-xl font-extrabold tracking-tight text-[#3b82f6]">STOCVEST</p>
        <h1 className="m-0 text-2xl font-bold text-slate-100 sm:text-3xl">Create your account.</h1>
        <p className="mb-6 mt-1 text-slate-400">Start trading with institutional intelligence.</p>
        <SignupForm />
        <p className="mt-4 text-sm text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="text-[#3b82f6] hover:underline">
            Sign in
          </Link>
        </p>
        <p className="mt-3 text-xs text-slate-500">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="text-slate-400 hover:text-slate-300">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-slate-400 hover:text-slate-300">
            Privacy Policy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
