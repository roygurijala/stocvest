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
    <main className="grid min-h-screen place-items-center overflow-x-hidden bg-[#0a0e1a] px-4 py-8 sm:py-10">
      <section className="stocvest-edge-line-card w-full max-w-full bg-[#111827] p-4 sm:max-w-md sm:p-6">
        <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-[#6b7280] transition hover:text-white">
          <ChevronLeft size={14} />
          Back to home
        </Link>
        <p className="mb-3 text-xl font-extrabold tracking-tight text-[#3b82f6]">STOCVEST</p>
        <h1 className="m-0 text-2xl font-bold text-slate-100 sm:text-3xl">Welcome back.</h1>
        <p className="mb-6 mt-1 text-slate-400">Sign in to your account</p>
        {searchParams?.message ? <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{searchParams.message}</p> : null}
        <LoginForm showDevBypass={isStocvestDevelopment()} />
      </section>
    </main>
  );
}
