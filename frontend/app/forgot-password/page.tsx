import Link from "next/link";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getServerSession } from "@/lib/auth/session";

export default function ForgotPasswordPage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#0a0e1a] px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-white/10 bg-[#111827] p-6 shadow-[0_0_30px_rgba(0,0,0,0.35)]">
        <h1 className="m-0 text-3xl font-bold text-slate-100">Reset your password.</h1>
        <p className="mb-6 mt-1 text-slate-400">Enter your email and we&apos;ll send a reset code.</p>
        <ForgotPasswordForm />
        <p className="mt-4 text-sm text-slate-400">
          Back to{" "}
          <Link href="/login" className="text-[#3b82f6] hover:underline">
            sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
