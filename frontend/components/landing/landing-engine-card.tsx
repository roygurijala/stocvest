"use client";

import {
  landingEngineDemoForMode,
  type LandingDemoLayer,
  type LandingEngineDemo
} from "@/lib/landing/demo-engine-cards";

export type LandingEngineMode = "swing" | "day";

const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function biasClass(bias: LandingEngineDemo["bias"]): string {
  if (bias === "Bullish") return "text-emerald-400";
  if (bias === "Bearish") return "text-rose-400";
  return "text-slate-300";
}

function executionClass(actionable: boolean): string {
  return actionable ? "text-emerald-400" : "text-amber-300";
}

function polarityDot(polarity: LandingDemoLayer["polarity"]): string {
  if (polarity === "supportive") return "text-emerald-400";
  if (polarity === "opposing") return "text-rose-400";
  return "text-slate-500";
}

function LayerRow({ layer }: { layer: LandingDemoLayer }) {
  const pct = Math.max(0, Math.min(100, layer.score));
  return (
    <li className="grid grid-cols-[auto_88px_1fr_36px] items-center gap-2 text-xs">
      <span className={`text-sm leading-none ${polarityDot(layer.polarity)}`} aria-hidden>
        {layer.polarity === "neutral" ? "○" : "●"}
      </span>
      <span className="truncate text-slate-300">{layer.label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <LayerLevelBar pct={pct} />
      </div>
      <span className="text-right tabular-nums text-slate-400" style={{ fontFamily: MONO }}>
        {layer.score}
      </span>
    </li>
  );
}

function LayerLevelBar({ pct }: { pct: number }) {
  return (
    <div
      className="h-1.5 rounded-full bg-gradient-to-r from-cyan-400/80 to-blue-500/90"
      style={{ width: `${pct}%` }}
    />
  );
}

function SetupReadGrid({ demo }: { demo: LandingEngineDemo }) {
  return (
    <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
      <div>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Bias</dt>
        <dd className={`mt-0.5 font-semibold ${biasClass(demo.bias)}`}>{demo.bias}</dd>
      </div>
      <div>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Alignment</dt>
        <dd className="mt-0.5 font-semibold text-slate-100">
          {demo.alignmentLabel} ({demo.aligned}/{demo.total})
        </dd>
      </div>
      <div>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Execution</dt>
        <dd className={`mt-0.5 font-semibold ${executionClass(demo.actionable)}`}>{demo.execution}</dd>
      </div>
    </dl>
  );
}

export function LandingEngineCard({ mode }: { mode: LandingEngineMode }) {
  const demo = landingEngineDemoForMode(mode);
  const testId = mode === "swing" ? "landing-engine-card-swing" : "landing-engine-card-day";

  return (
    <div className="landing-glow-card flex h-full min-h-0 flex-col p-5" data-testid={testId}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Setup read</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xl font-bold text-slate-100">{demo.symbol}</p>
          <p className="text-xs text-slate-400" style={{ fontFamily: MONO }}>
            {demo.metaLine}
          </p>
        </div>
        {typeof demo.readinessScore === "number" ? (
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Readiness</p>
            <p className="text-2xl font-black tabular-nums text-cyan-300">{demo.readinessScore}</p>
          </div>
        ) : null}
      </div>

      <SetupReadGrid demo={demo} />

      <div className="my-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">6-layer breakdown</p>
        <ul className="m-0 list-none space-y-1.5 p-0">
          {demo.layers.map((layer) => (
            <LayerRow key={layer.label} layer={layer} />
          ))}
        </ul>
      </div>

      {demo.geoCallout ? (
        <div className="mb-3 rounded-lg border border-slate-500/35 bg-slate-800/40 p-3 text-xs text-slate-200">
          <p className="m-0 font-semibold text-slate-400">{demo.geoCallout.title}</p>
          <p className="m-0 mt-1.5 leading-relaxed">{demo.geoCallout.body}</p>
        </div>
      ) : null}

      <p className="mb-2 text-sm leading-snug text-slate-300">{demo.narrative}</p>

      {demo.blockerLine ? (
        <p className="mb-2 text-sm leading-snug text-amber-200/90">
          <span aria-hidden>⚠ </span>
          {demo.blockerLine}
        </p>
      ) : null}

      {demo.levelsLine ? (
        <p className="border-t border-white/10 pt-3 text-xs text-slate-300" style={{ fontFamily: MONO }}>
          {demo.levelsLine}
        </p>
      ) : null}

      {demo.convictionLine ? (
        <p className="mt-2 text-xs text-slate-400">{demo.convictionLine}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-3 text-sm">
        <span className="text-xs text-slate-500">Illustrative sample — live desk after signup</span>
        <span className="shrink-0 font-semibold text-cyan-300">Open full evidence</span>
      </div>
    </div>
  );
}
