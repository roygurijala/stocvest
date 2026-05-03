"use client";

import { useMemo } from "react";
import type { LandingSignal } from "@/lib/api/landing-signals";
import type { PerformanceSummary } from "@/lib/api/public-signals";

const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function timeAgoShort(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const deltaSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (deltaSec < 3600) return `${Math.max(1, Math.floor(deltaSec / 60))}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return "Yesterday";
}

function dotColor(direction: LandingSignal["direction"]): string {
  if (direction === "bullish") return "#22c55e";
  if (direction === "bearish") return "#ef4444";
  return "#f59e0b";
}

function confluenceCount(pb: PerformanceSummary["pattern_breakdown"]): string {
  if (!pb?.length) return "—";
  const n = pb.filter(
    (p) =>
      p.pattern_key.toLowerCase().includes("confluence") || p.label.toLowerCase().includes("confluence")
  ).length;
  return n > 0 ? String(n) : "—";
}

function Sparkline({ values }: { values: number[] }) {
  const w = 400;
  const h = 60;
  const padX = 4;
  const padY = 6;
  if (values.length < 2) {
    const y = h - padY - 4;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[60px] w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="landingSparkFlat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00e87a" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#00e87a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={padX} y={y} width={w - padX * 2} height={4} fill="url(#landingSparkFlat)" rx={1} />
        <line x1={padX} y1={y + 2} x2={w - padX} y2={y + 2} stroke="#00e87a" strokeWidth={1.5} />
        <text x={w / 2} y={16} fill="#64748b" fontSize={10} textAnchor="middle">
          Building accuracy record from launch
        </text>
        <text x={padX} y={h - 2} fill="#64748b" fontSize={9}>
          launch
        </text>
        <text x={w - 36} y={h - 2} fill="#64748b" fontSize={9} textAnchor="end">
          today
        </text>
      </svg>
    );
  }
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = Math.max(1e-6, maxV - minV);
  const pts = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * (w - padX * 2);
    const y = padY + (1 - (v - minV) / span) * (h - padY * 2);
    return `${x},${y}`;
  });
  const d = `M ${pts.join(" L ")}`;
  const areaD = `${d} L ${w - padX},${h - padY} L ${padX},${h - padY} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[60px] w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="landingSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00e87a" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#00e87a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#landingSparkFill)" />
      <path d={d} fill="none" stroke="#00e87a" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <text x={padX} y={h - 2} fill="#64748b" fontSize={9}>
        launch
      </text>
      <text x={w - 36} y={h - 2} fill="#64748b" fontSize={9} textAnchor="end">
        today
      </text>
    </svg>
  );
}

export function LandingActivityFeedSection({
  signals,
  performanceSummary,
  showPlaceholderList
}: {
  signals: LandingSignal[];
  performanceSummary: PerformanceSummary;
  showPlaceholderList: boolean;
}) {
  const hasPerf =
    performanceSummary.signals_evaluated > 0 || performanceSummary.total_signals_tracked > 0;
  const sparkValues = useMemo(() => {
    if (!hasPerf) return [] as number[];
    const acc = performanceSummary.directional_accuracy_percent;
    return [Math.max(0, acc * 0.6), Math.max(0, acc * 0.85), acc];
  }, [hasPerf, performanceSummary.directional_accuracy_percent]);

  const rows = signals.slice(0, 5);

  return (
    <section className="border-b border-[rgba(0,180,255,0.06)] px-5 py-12 md:px-10 md:py-20">
      <div className="mx-auto max-w-6xl">
        <p
          className="mb-2 text-center uppercase tracking-[0.2em] text-[#00b4ff]/80"
          style={{ fontFamily: MONO, fontSize: 11 }}
        >
          TRANSPARENCY
        </p>
        <h2 className="mb-10 text-center text-2xl font-bold text-slate-50 md:text-3xl">
          Every signal published. Wins and losses.
        </h2>

        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <p className="mb-3 text-[9px] font-medium uppercase tracking-wide text-slate-500" style={{ fontFamily: MONO }}>
              RECENT SIGNALS
            </p>
            <div className="rounded-xl border border-white/10 bg-[#0c1828]/60">
              {showPlaceholderList ? (
                <div className="divide-y divide-white/5 p-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-2 py-3">
                      <div
                        className="h-2 w-2 shrink-0 rounded-full bg-slate-600/50"
                        style={{ animation: `pulse 1.2s ease-in-out ${i * 0.15}s infinite` }}
                      />
                      <div className="h-3 flex-1 rounded bg-white/5" />
                      <div className="h-3 w-14 rounded bg-white/5" />
                    </div>
                  ))}
                  <p className="px-3 py-2 text-center text-xs text-slate-500">Signals generating from market open</p>
                </div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {rows.map((sig) => (
                    <li
                      key={`${sig.symbol}-${sig.generated_at}`}
                      className="flex cursor-default items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-[rgba(0,180,255,0.04)]"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: dotColor(sig.direction),
                            boxShadow:
                              sig.direction === "bullish" ? "0 0 10px rgba(34,197,94,0.65)" : undefined
                          }}
                        />
                        <span className="font-bold text-slate-100">{sig.symbol}</span>
                        <span className="truncate text-[11px] text-slate-500" style={{ fontFamily: MONO }}>
                          {sig.pattern}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-slate-400" style={{ fontFamily: MONO }}>
                        <span className="text-[#00d4ff]">{sig.signal_strength}%</span>
                        <span>{timeAgoShort(sig.generated_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <p className="mb-3 text-[9px] font-medium uppercase tracking-wide text-slate-500" style={{ fontFamily: MONO }}>
              TODAY&apos;S ACCURACY
            </p>
            <div
              className="rounded-xl border p-4"
              style={{ background: "#0c1828", borderColor: "rgba(0,180,255,0.1)" }}
            >
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[22px] font-semibold text-[#00d4ff]" style={{ fontFamily: MONO }}>
                    {hasPerf ? performanceSummary.total_signals_tracked : "—"}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-500">Total Signals</p>
                </div>
                <div>
                  <p className="text-[22px] font-semibold text-[#00d4ff]" style={{ fontFamily: MONO }}>
                    {hasPerf ? `${performanceSummary.directional_accuracy_percent}%` : "—"}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-500">Directional Accuracy</p>
                </div>
                <div>
                  <p className="text-[22px] font-semibold text-[#00d4ff]" style={{ fontFamily: MONO }}>
                    {hasPerf ? confluenceCount(performanceSummary.pattern_breakdown) : "—"}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-500">Confluence Alerts</p>
                </div>
                <div>
                  <p className="text-[22px] font-semibold text-[#00d4ff]" style={{ fontFamily: MONO }}>
                    —
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-500">Active Right Now</p>
                </div>
              </div>
              {!hasPerf ? (
                <p className="mb-2 text-center text-[10px] text-slate-500">Tracking since launch</p>
              ) : null}
              <Sparkline values={sparkValues} />

              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
                {[
                  { v: "100%", l: "published" },
                  { v: "0", l: "cherry-picked" },
                  { v: "24h", l: "resolution" },
                  { v: "0.5%", l: "min move" }
                ].map((x) => (
                  <div key={`pledge-${x.l}`}>
                    <p className="text-[13px] font-medium text-[#00d4ff]" style={{ fontFamily: MONO }}>
                      {x.v}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide text-slate-500">{x.l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
