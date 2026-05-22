"use client";

import Link from "next/link";

const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function LandingAssistantSection() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:px-8" data-testid="landing-assistant-section">
      <h2 className="text-center text-2xl font-bold md:text-3xl">Not just signals — reasoning on demand</h2>
      <p className="mx-auto mt-3 max-w-2xl text-center text-slate-300">
        Every platform tells you what&apos;s happening. We tell you what to do about it — and why.
      </p>
      <div className="landing-glow-card mx-auto mt-8 max-w-2xl p-5 text-left">
        <p className="text-xs uppercase tracking-widest text-cyan-300/80" style={{ fontFamily: MONO }}>
          Assistant · example
        </p>
        <div className="mt-4 space-y-4 text-sm">
          <div className="rounded-lg bg-white/5 px-3 py-2 text-slate-200">
            <span className="font-semibold text-cyan-300">You:</span> Why isn&apos;t NFLX actionable?
          </div>
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/20 px-3 py-3 text-slate-100">
            <span className="font-semibold text-emerald-300">Assistant:</span>
            <p className="mt-2 leading-relaxed">
              The setup is bearish and aligned, but the reward does not justify the risk. You&apos;d need a
              target near $424 to meet the system threshold. Best adjustment: wait for a better entry rather
              than force the trade.
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Signed-in users get full context from your watchlist and live signal cards.
        </p>
        <Link
          href="/signup/agreements"
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-[#3b82f6] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Unlock the assistant — free
        </Link>
      </div>
    </section>
  );
}
