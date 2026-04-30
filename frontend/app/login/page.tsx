import { getServerSession } from "@/lib/auth/session";
import { isStocvestDevelopment } from "@/lib/auth/stocvest-env";
import { LoginForm } from "@/components/auth/login-form";
import { redirect } from "next/navigation";

export default function LoginPage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#0a0e1a] px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-white/10 bg-[#111827] p-6 shadow-[0_0_30px_rgba(0,0,0,0.35)]">
        <p className="mb-3 text-xl font-extrabold tracking-tight text-[#3b82f6]">STOCVEST</p>
        <h1 className="m-0 text-3xl font-bold text-slate-100">Welcome back.</h1>
        <p className="mb-6 mt-1 text-slate-400">Sign in to your account</p>
        <LoginForm showDevBypass={isStocvestDevelopment()} />
      </section>
    </main>
  );
}
