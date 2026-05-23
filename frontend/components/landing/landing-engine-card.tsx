"use client";

const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export type LandingEngineMode = "swing" | "day";

function layerRow(label: string, pct: number) {
  return (
    <div className="grid grid-cols-[120px_1fr_40px] items-center gap-2 text-xs" key={label}>
      <span style={{ fontFamily: MONO, color: "#8aa0bf" }}>{label}</span>
      <div className="h-2 rounded-full bg-white/10">
        <div className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-right text-slate-200" style={{ fontFamily: MONO }}>
        {pct}%
      </span>
    </div>
  );
}

export function LandingEngineCard({ mode }: { mode: LandingEngineMode }) {
  if (mode === "day") {
    return (
      <div className="landing-glow-card flex h-full min-h-0 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xl font-bold text-slate-100">AAPL · DAY SIGNAL</p>
            <p className="text-xs text-slate-400" style={{ fontFamily: MONO }}>
              9:38 AM · confluence_alert
            </p>
          </div>
          <p className="text-3xl font-black text-cyan-300">79</p>
        </div>
        <div className="my-4 space-y-2">
          {[
            ["TECHNICAL", 88],
            ["NEWS", 82],
            ["MACRO", 71],
            ["SECTOR", 85],
            ["GEOPOLITICAL", 54],
            ["INTERNALS", 76]
          ].map(([l, p]) => layerRow(String(l), Number(p)))}
        </div>
        <p className="mb-3 text-sm italic text-slate-300">
          &quot;ORB breakout confirmed above VWAP with earnings catalyst still active. Tech sector leading. 4 of 6 layers aligned
          bullish.&quot;
        </p>
        <p className="border-t border-white/10 pt-3 text-xs text-slate-300" style={{ fontFamily: MONO }}>
          Entry $195-$197 · Stop $192 · R/R 2.4:1
        </p>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="font-bold text-emerald-400">BULLISH · 79/100</span>
          <span className="text-cyan-300">[View Evidence]</span>
        </div>
      </div>
    );
  }

  return (
    <div className="landing-glow-card flex h-full min-h-0 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xl font-bold text-slate-100">NVDA · SWING SIGNAL</p>
          <p className="text-xs text-slate-400" style={{ fontFamily: MONO }}>
            Forming 6 days · Updated just now
          </p>
        </div>
        <p className="text-3xl font-black text-cyan-300">84</p>
      </div>
      <div className="my-4 space-y-2">
        {[
          ["TECHNICAL", 91],
          ["NEWS", 78],
          ["MACRO", 68],
          ["SECTOR", 87],
          ["GEOPOLITICAL", 32],
          ["INTERNALS", 88]
        ].map(([l, p]) => layerRow(String(l), Number(p)))}
      </div>
      <div className="mb-3 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100">
        ⚠ GEO LAYER: Semiconductors carry 1.8× weight on US-China trade tension. PINS would score 0.4×. Same news. Different stock. Different
        exposure.
      </div>
      <p className="mb-3 text-sm italic text-slate-300">
        &quot;Strong daily structure and earnings momentum. Geo headwind partially offsets bullish thesis. Watch for trade policy headlines this
        week.&quot;
      </p>
      <p className="border-t border-white/10 pt-3 text-xs text-slate-300" style={{ fontFamily: MONO }}>
        Entry $112-$118 · Stop $108 · R/R 2.8:1
      </p>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="font-bold text-emerald-400">BULLISH · 84/100</span>
        <span className="text-cyan-300">[View Evidence]</span>
      </div>
    </div>
  );
}
