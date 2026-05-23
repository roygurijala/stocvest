const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function LandingPhilosophySection() {
  return (
    <section className="border-y border-white/10 bg-black/20 px-4 py-14 md:px-8 md:py-20" data-testid="landing-philosophy">
      <div className="mx-auto max-w-5xl">
        <p className="mb-2 text-center text-xs uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: MONO }}>
          RESTRAINT
        </p>
        <h2 className="text-center text-2xl font-bold md:text-4xl">Inactivity is intentional.</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="landing-glow-card border-rose-500/20 p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-rose-300/90">Typical signal platform</p>
            <p className="mt-3 font-mono text-sm leading-relaxed text-slate-300">
              NVDA: Bullish signal. RSI 65. EMA cross. <span className="text-rose-300">Buy.</span>
            </p>
          </div>
          <div className="landing-glow-card border-cyan-500/25 p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">STOCVEST</p>
            <p className="mt-3 font-mono text-sm leading-relaxed text-slate-200">
              NVDA: Bullish bias — geo layer flags semiconductor trade tension. R/R at current entry ~0.8:1.{" "}
              <span className="font-semibold text-amber-300">Not actionable. Wait.</span>
            </p>
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-slate-400 md:text-base">
          Typical week: <span className="font-semibold text-slate-200">0–2 actionable</span> ·{" "}
          <span className="font-semibold text-slate-200">3–8 developing</span> · quiet days by design. The engine is live even when the desk
          is quiet.
        </p>
      </div>
    </section>
  );
}
