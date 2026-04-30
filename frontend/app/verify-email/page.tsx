import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

export default function VerifyEmailPage({ searchParams }: { searchParams?: { email?: string } }) {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }
  const email = searchParams?.email || "";

  return (
    <main className="grid min-h-screen place-items-center bg-[#0a0e1a] px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-white/10 bg-[#111827] p-6 shadow-[0_0_30px_rgba(0,0,0,0.35)]">
        <h1 className="m-0 text-3xl font-bold text-slate-100">Check your email.</h1>
        <p className="mb-6 mt-1 text-slate-400">We sent a verification code to {email || "your email"}.</p>
        <VerifyEmailForm email={email} />
      </section>
    </main>
  );
}
