"use client";

const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function LandingAssistantDemo() {
  return (
    <div className="landing-glow-card flex h-full flex-col p-5 text-left">
      <p className="text-xs uppercase tracking-widest text-cyan-300/80" style={{ fontFamily: MONO }}>
        Assistant · example
      </p>
      <div className="mt-4 flex flex-1 flex-col justify-center space-y-4 text-sm">
        <div className="rounded-lg bg-white/5 px-3 py-2 text-slate-200">
          <span className="font-semibold text-cyan-300">You:</span> Why isn&apos;t NFLX actionable?
        </div>
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/20 px-3 py-3 text-slate-100">
          <span className="font-semibold text-emerald-300">Assistant:</span>
          <p className="mt-2 leading-relaxed">
            The setup is bearish and aligned, but the reward does not justify the risk. You&apos;d need a target near $424 to meet the system
            threshold. Best adjustment: wait for a better entry rather than force the trade.
          </p>
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500">Restraint in action — not another buy signal.</p>
    </div>
  );
}
