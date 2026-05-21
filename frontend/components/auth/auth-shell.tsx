import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { StocvestTitle } from "@/components/brand/stocvest-title";

export type AuthSignupStep = "agreements" | "account";

export function AuthShell({
  children,
  title,
  subtitle,
  signupStep,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** When set, shows a two-step registration progress (agreements → account). */
  signupStep?: AuthSignupStep;
}) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#050810] px-4 py-10 sm:py-14">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.45), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(6,182,212,0.12), transparent 50%)",
        }}
        aria-hidden
      />
      <div className="relative z-10 mx-auto flex w-full max-w-lg flex-col items-stretch">
        <Link
          href="/"
          className="mb-6 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-200"
        >
          <ChevronLeft size={16} strokeWidth={2} />
          Back to home
        </Link>

        {signupStep ? (
          <div className="mb-6 flex rounded-lg border border-white/10 bg-white/[0.04] p-1 text-xs font-medium text-slate-400">
            <span
              className={`flex-1 rounded-md px-3 py-2 text-center ${
                signupStep === "agreements" ? "bg-[#1e293b] text-cyan-200 shadow-sm" : ""
              }`}
            >
              1 · Agreements
            </span>
            <span
              className={`flex-1 rounded-md px-3 py-2 text-center ${
                signupStep === "account" ? "bg-[#1e293b] text-cyan-200 shadow-sm" : ""
              }`}
            >
              2 · Account
            </span>
          </div>
        ) : null}

        <section className="stocvest-edge-line-card border border-white/[0.08] bg-[#0c1222]/95 p-5 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.75)] backdrop-blur-sm sm:p-7">
          <div className="mb-5 flex justify-center">
            <StocvestTitle href="/" size="display" />
          </div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mb-6 mt-2 text-sm leading-relaxed text-slate-400 sm:text-base">{subtitle}</p> : <div className="mb-6" />}
          {children}
        </section>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-500">
          Encrypted session after sign-in · Signals are informational only, not investment advice ·{" "}
          <Link href="/terms" className="text-slate-400 underline-offset-2 hover:text-slate-300 hover:underline">
            Terms
          </Link>
          {" · "}
          <Link href="/privacy" className="text-slate-400 underline-offset-2 hover:text-slate-300 hover:underline">
            Privacy
          </Link>
        </p>
      </div>
    </main>
  );
}
