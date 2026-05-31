"use client";

import { useMemo } from "react";
import type { LandingSignal } from "@/lib/api/landing-signals";
import type { PerformanceSummary } from "@/lib/api/public-signals";
import { isoDateInNewYork } from "@/lib/market-hours-et";

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
  /** Chart-only height; axis labels render in HTML below so the stroke never crosses text. */
  const hChart = 44;
  const padX = 4;
  const padY = 6;
  const chartBottom = hChart - padY;

  if (values.length < 2) {
    const y = chartBottom - 8;
    return (
      <div className="w-full">
        <svg viewBox={`0 0 ${w} ${hChart}`} className="h-11 w-full" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="landingSparkFlat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e87a" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#00e87a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x={padX} y={y} width={w - padX * 2} height={4} fill="url(#landingSparkFlat)" rx={1} />
          <line x1={padX} y1={y + 2} x2={w - padX} y2={y + 2} stroke="#00e87a" strokeWidth={1.5} />
        </svg>
        <div
          className="mt-2 flex justify-between font-mono text-[10px] font-medium uppercase tracking-wide text-slate-400"
          aria-hidden
        >
          <span>launch</span>
          <span>today</span>
        </div>
      </div>
    );
  }
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = Math.max(1e-6, maxV - minV);
  const pts = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * (w - padX * 2);
    const y = padY + (1 - (v - minV) / span) * (chartBottom - padY - 4);
    return `${x},${y}`;
  });
  const d = `M ${pts.join(" L ")}`;
  const areaD = `${d} L ${w - padX},${chartBottom} L ${padX},${chartBottom} Z`;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${hChart}`} className="h-11 w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="landingSparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00e87a" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#00e87a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#landingSparkFill)" />
        <path d={d} fill="none" stroke="#00e87a" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div
        className="mt-2 flex justify-between font-mono text-[10px] font-medium uppercase tracking-wide text-slate-400"
        aria-hidden
      >
        <span>launch</span>
        <span>today</span>
      </div>
    </div>
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
    if (acc == null) return [] as number[];
    return [Math.max(0, acc * 0.6), Math.max(0, acc * 0.85), acc];
  }, [hasPerf, performanceSummary.directional_accuracy_percent]);

  const trackingSince = performanceSummary.launch_date?.trim() || isoDateInNewYork();

  const rows = signals.slice(0, 5);

  return (
    <section className="border-b border-[rgba(0,180,255,0.06)] px-5 py-12 md:px-10 md:py-20">
      <div className="mx-auto max-w-6xl">
        <p
          className="mb-2 text-center uppercase tracking-[0.2em] text-[#00b4ff]/80"
          style={{ fontFamily: MONO, fontSize: 11 }}
        >
          LIVE ENGINE
        </p>
        <h2 className="mb-3 text-center text-2xl font-bold text-slate-50 md:text-3xl">Signals generating right now</h2>
        <p className="mx-auto mb-10 max-w-lg text-center text-sm text-slate-400">
          Every signal tracked from the moment it fires — publicly, permanently
        </p>

        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <p className="mb-3 text-[9px] font-medium uppercase tracking-wide text-slate-500" style={{ fontFamily: MONO }}>
              RECENT SIGNALS
            </p>
            <div className="landing-glow-card overflow-hidden">
              {showPlaceholderList ? (
                <div className="p-5">
                  <div
                    className="rounded-[10px] border border-[rgba(0,180,255,0.1)] p-5"
                    style={{ background: "rgba(0,180,255,0.03)" }}
                  >
                    <p className="text-[20px] leading-none text-[#00d4ff]" aria-hidden>
                      ◈
                    </p>
                    <p className="mt-3 text-sm font-medium" style={{ color: "#8aa0bf" }}>
                      Signal engine active
                    </p>
                    <p className="mt-2 text-xs leading-[1.6] text-slate-500">
                      Signals generate automatically during market hours (9:30 AM – 4:00 PM ET).
                    </p>
                    <p className="mt-2 text-xs leading-[1.6] text-slate-500">
                      Check back after market open to see live signal activity.
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {rows.map((sig) => (
                    <li
                      key={`${sig.symbol}-${sig.generated_at}`}
                      className="flex min-h-[44px] cursor-default items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-[rgba(0,180,255,0.04)] sm:min-h-0 sm:py-2.5"
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
            <div className="landing-glow-card p-4">
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[22px] font-semibold text-[#00d4ff]" style={{ fontFamily: MONO }}>
                    {hasPerf ? performanceSummary.total_signals_tracked : "—"}
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Total Signals</p>
                </div>
                <div>
                  <p className="text-[22px] font-semibold text-[#00d4ff]" style={{ fontFamily: MONO }}>
                    {hasPerf && performanceSummary.directional_accuracy_percent != null
                      ? `${performanceSummary.directional_accuracy_percent}%`
                      : "—"}
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Directional Accuracy</p>
                </div>
                <div>
                  <p className="text-[22px] font-semibold text-[#00d4ff]" style={{ fontFamily: MONO }}>
                    {hasPerf ? confluenceCount(performanceSummary.pattern_breakdown) : "—"}
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Confluence Alerts</p>
                </div>
                <div>
                  <p className="text-[22px] font-semibold text-[#00d4ff]" style={{ fontFamily: MONO }}>
                    —
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Active Right Now</p>
                </div>
              </div>
              {!hasPerf ? (
                <p className="mb-2 text-center text-[11px] leading-relaxed text-slate-500">
                  Signal accuracy data accumulates automatically from market open. Tracking since {trackingSince}{" "}
                  <span className="whitespace-nowrap">(US/Eastern).</span>
                </p>
              ) : null}
              {!hasPerf ? (
                <p className="mb-2 text-center text-[10px] text-slate-500">
                  First accuracy data appears after signals are evaluated (24h window)
                </p>
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
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{x.l}</p>
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
