import Link from "next/link";
import { AGREEMENTS_BUNDLE_VERSION, isSignupLegalEmbedSearch, withSignupLegalEmbed } from "@/lib/legal-agreements";

export default function RiskDisclosurePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const embed = isSignupLegalEmbedSearch(searchParams);
  const termsHref = embed ? withSignupLegalEmbed("/terms") : "/terms";

  return (
    <main className="min-h-screen bg-[#0a0e1a] px-4 py-16 text-slate-100 md:px-8">
      <div className="mx-auto grid max-w-3xl gap-6">
        {embed ? null : (
          <>
            <Link href="/signup/agreements" className="text-sm text-[#3b82f6] hover:underline">
              ← Back to signup agreements
            </Link>
            <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
              ← Home
            </Link>
          </>
        )}
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100/95">
          ⚠️ Summary for onboarding only. This is not a substitute for the full{" "}
          <Link href={termsHref} className="text-amber-200 underline">
            Terms of Service
          </Link>
          . Counsel must review all legal copy before paid launch.
        </div>
        <h1 className="text-3xl font-bold md:text-4xl">Risk disclosure</h1>
        <p className="text-sm text-slate-400">Document bundle version: {AGREEMENTS_BUNDLE_VERSION}</p>
        <section className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-300">
          <ul className="m-0 list-disc space-y-3 pl-6">
            <li>Trading stocks and other instruments involves substantial risk of loss.</li>
            <li>Past signal outcomes or backtests do not guarantee future results.</li>
            <li>STOCVEST does not provide investment advice, personalized recommendations, or trade execution.</li>
            <li>You are solely responsible for your trading decisions and for compliance with applicable laws and regulations.</li>
            <li>Market data may be delayed or incomplete; analytical outputs may be wrong or outdated.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
