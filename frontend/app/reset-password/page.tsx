import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getServerSession } from "@/lib/auth/session";

export default function ResetPasswordPage({ searchParams }: { searchParams?: { email?: string } }) {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#0a0e1a] px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-white/10 bg-[#111827] p-6 shadow-[0_0_30px_rgba(0,0,0,0.35)]">
        <h1 className="m-0 text-3xl font-bold text-slate-100">Choose a new password.</h1>
        <p className="mb-6 mt-1 text-slate-400">Enter the code from your email and set a new password.</p>
        <ResetPasswordForm email={searchParams?.email || ""} />
      </section>
    </main>
  );
}
