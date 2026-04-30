import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#0a0e1a] px-4 py-16 text-slate-100 md:px-8">
      <div className="mx-auto grid max-w-4xl gap-6">
        <Link href="/" className="text-sm text-[#3b82f6] hover:underline">
          ← Back to home
        </Link>
        <h1 className="text-3xl font-bold md:text-4xl">Terms of Service</h1>
        <section className="rounded-xl border border-white/10 bg-white/5 p-6">
          <p className="text-slate-300">
            STOCVEST is a software platform that provides signal intelligence and workflow tools. STOCVEST is not a
            registered investment advisor, broker-dealer, or fund manager.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-300">
            <li>Signals and analytics are for informational purposes only and are not investment advice.</li>
            <li>Users are solely responsible for their own trading decisions and risk management.</li>
            <li>Orders are placed in the user&apos;s own brokerage account when enabled by the user.</li>
            <li>Use of the platform is subject to ongoing product updates and legal policy revisions.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
