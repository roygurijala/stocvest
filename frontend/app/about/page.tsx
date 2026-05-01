import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0a0e1a] px-4 py-14 text-slate-100 md:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-sm text-[#3b82f6] hover:underline">
          ← Back to home
        </Link>

        <h1 className="mt-5 text-4xl font-black md:text-6xl">About STOCVEST</h1>

        <section className="mt-8 rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-bold">Built by a trader, for traders</h2>
          <p className="mt-3 text-slate-300">
            STOCVEST was built out of frustration with fragmented trading tools. Most traders use 4-5 different platforms simultaneously — one for charts, one for news, one for options flow, one
            for execution. We built one platform that does all of it, powered by AI that explains its reasoning.
          </p>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "Transparency over black boxes",
              body: "Every signal shows its full reasoning. You always know why."
            },
            {
              title: "Safety over speed",
              body: "PDT Guardian, paper trading mode, and order confirmation gates protect you from yourself."
            },
            {
              title: "Intelligence over noise",
              body: "Six signal layers synthesized by AI cuts through market noise to surface only the highest-conviction setups."
            }
          ].map((card) => (
            <article key={card.title} className="rounded-xl border border-white/10 bg-white/5 p-6">
              <h3 className="text-xl font-bold">{card.title}</h3>
              <p className="mt-2 text-slate-300">{card.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-bold">Built on best-in-class infrastructure</h2>
          <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-300">
            <li>Polygon.io — Real-time market data</li>
            <li>Anthropic Claude — AI signal synthesis</li>
            <li>AWS — Enterprise infrastructure</li>
            <li>IBKR and ETrade — Direct broker execution</li>
          </ul>
        </section>

        <section className="mt-6 rounded-xl border border-white/10 bg-white/5 p-6 text-slate-300">
          <p>STOCVEST LLC is a Delaware registered company.</p>
          <p className="mt-2">We are a signal intelligence platform, not a registered investment advisor.</p>
          <p className="mt-2">
            Contact: <a href="mailto:support@stocvest.app">support@stocvest.app</a>
          </p>
        </section>
      </div>
    </main>
  );
}
