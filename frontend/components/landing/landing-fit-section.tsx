const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function LandingFitSection() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-14 md:px-8 md:py-20" data-testid="landing-fit-section">
      <p className="mb-2 text-center text-xs uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: MONO }}>
        FIT
      </p>
      <h2 className="mb-8 text-center text-2xl font-bold md:text-4xl">Built for disciplined traders</h2>
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <div className="landing-glow-card p-6">
          <p className="mb-3 font-semibold text-emerald-300/90">Built for:</p>
          <ul className="space-y-2 text-sm leading-relaxed text-slate-200">
            <li>• Traders who value patience over activity</li>
            <li>• Traders who want clear decision frameworks</li>
            <li>• Traders tired of false signals and overtrading</li>
          </ul>
        </div>
        <div className="landing-glow-card p-6">
          <p className="mb-3 font-semibold text-slate-400">Not ideal for:</p>
          <ul className="space-y-2 text-sm leading-relaxed text-slate-300">
            <li>• Constant action seekers</li>
            <li>• Pure indicator-based trading</li>
            <li>• Prediction-driven trading</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
