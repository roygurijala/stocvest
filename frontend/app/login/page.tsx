import { getServerSession } from "@/lib/auth/session";
import { isStocvestDevelopment } from "@/lib/auth/stocvest-env";
import { LoginForm } from "@/components/auth/login-form";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";

export default function LoginPage({ searchParams }: { searchParams?: { message?: string } }) {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#0a0e1a] px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-white/10 bg-[#111827] p-6 shadow-[0_0_30px_rgba(0,0,0,0.35)]">
        <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-[#6b7280] transition hover:text-white">
          <ChevronLeft size={14} />
          Back to home
        </Link>
        <p className="mb-3 text-xl font-extrabold tracking-tight text-[#3b82f6]">STOCVEST</p>
        <h1 className="m-0 text-3xl font-bold text-slate-100">Welcome back.</h1>
        <p className="mb-6 mt-1 text-slate-400">Sign in to your account</p>
        {searchParams?.message ? <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{searchParams.message}</p> : null}
        <LoginForm showDevBypass={isStocvestDevelopment()} />
      </section>
    </main>
  );
}
