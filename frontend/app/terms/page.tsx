import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#0a0e1a] px-4 py-16 text-slate-100 md:px-8">
      <div className="mx-auto grid max-w-4xl gap-6">
        <Link href="/" className="text-sm text-[#3b82f6] hover:underline">
          ← Back to home
        </Link>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100/95">
          ⚠️ This Terms of Service is a working draft. It is pending review by a licensed securities attorney before this platform accepts
          paid subscribers.
        </div>
        <h1 className="text-3xl font-bold md:text-4xl">Terms of Service</h1>
        <section className="rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">1. Nature of Service</h2>
          <p className="mt-3 text-slate-300">
            STOCVEST provides signal intelligence tools and market data analysis for informational purposes only. STOCVEST LLC is not a
            registered investment adviser under the Investment Advisers Act of 1940 or any applicable state securities law.
          </p>
        </section>
        <section className="rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">2. Not Investment Advice</h2>
          <p className="mt-3 text-slate-300">
            Nothing on this platform constitutes investment advice, a securities recommendation, or a solicitation to buy or sell any
            security. All signals, analyses, briefings, and reference levels are provided for informational and educational purposes.
          </p>
        </section>
        <section className="rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">3. User Responsibility</h2>
          <p className="mt-3 text-slate-300">
            You are solely responsible for all trading decisions and their outcomes. You should consult a licensed financial adviser before
            making investment decisions.
          </p>
        </section>
        <section className="rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">4. No Warranty on Signal Accuracy</h2>
          <p className="mt-3 text-slate-300">
            STOCVEST makes no representations or warranties regarding the accuracy, completeness, or fitness for purpose of any signal or
            analysis. Past signal accuracy does not guarantee future results.
          </p>
        </section>
        <section className="rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">5. Limitation of Liability</h2>
          <p className="mt-3 text-slate-300">
            TO THE FULLEST EXTENT PERMITTED BY LAW, STOCVEST LLC SHALL NOT BE LIABLE FOR ANY TRADING LOSSES, LOST PROFITS, OR ANY INDIRECT,
            INCIDENTAL, OR CONSEQUENTIAL DAMAGES ARISING FROM USE OF THIS PLATFORM.
          </p>
        </section>
        <p className="text-sm text-slate-400">
          This placeholder copy must be reviewed and replaced by a licensed attorney before launch.
        </p>
      </div>
    </main>
  );
}
