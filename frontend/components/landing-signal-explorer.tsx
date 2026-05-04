"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { LandingSignal } from "@/lib/api/landing-signals";
import type { PerformanceSummary } from "@/lib/api/public-signals";

const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function formatSignalWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York"
  });
  const dayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const now = new Date();
  const sigDay = dayFmt.format(d);
  const today = dayFmt.format(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = dayFmt.format(y);
  const time = timeFmt.format(d);
  if (sigDay === yesterday) return `Yesterday · ${time}`;
  if (sigDay === today) return `Today · ${time}`;
  return `${sigDay} · ${time}`;
}

function pctMove(from: number, to: number | null): number | null {
  if (to == null || !Number.isFinite(from) || from === 0) return null;
  return ((to - from) / from) * 100;
}

/** Display string for 1h % move from signal vs follow-up price (always 2 decimals). */
function formatOneHourPctLabel(priceAt: number, priceAfter: number | null): string | null {
  const p = pctMove(priceAt, priceAfter);
  if (p == null) return null;
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}`;
}

function displaySummary(s: string | null, max = 120): string | null {
  if (!s) return null;
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3).trim()}...`;
}

const LAYERS: { key: keyof LandingSignal["layer_scores"]; label: string }[] = [
  { key: "technical", label: "technical" },
  { key: "news", label: "news" },
  { key: "macro", label: "macro" },
  { key: "sector", label: "sector" },
  { key: "geopolitical", label: "geopolitical" },
  { key: "internals", label: "internals" }
];

function barGradient(score: number): string {
  if (score >= 70) return "linear-gradient(90deg, #00e87a, #16a34a)";
  if (score >= 50) return "linear-gradient(90deg, #fbbf24, #d97706)";
  return "linear-gradient(90deg, #f87171, #dc2626)";
}

function dotFill(outcome: LandingSignal["outcome_1h"]): { bg: string; shadow: string } {
  if (outcome === "correct") return { bg: "#00e87a", shadow: "0 0 4px rgba(0,232,122,0.5)" };
  if (outcome === "incorrect") return { bg: "#ff3d5a", shadow: "0 0 4px rgba(255,61,90,0.5)" };
  return { bg: "#f5c542", shadow: "none" };
}

function directionalAccuracyFromSignals(list: LandingSignal[]): number | null {
  const material = list.filter((s) => s.outcome_1h === "correct" || s.outcome_1h === "incorrect");
  if (material.length === 0) return null;
  const correctCount = material.filter((s) => s.outcome_1h === "correct").length;
  return Math.round((100 * correctCount) / material.length);
}

export function LandingSignalExplorer({
  signals,
  usedApiFallback,
  performanceSummary
}: {
  signals: LandingSignal[];
  usedApiFallback: boolean;
  performanceSummary: PerformanceSummary;
}) {
  const [active, setActive] = useState(0);
  const [barReveal, setBarReveal] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    setBarReveal(0);
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      raf.current = requestAnimationFrame(() => setBarReveal(1));
    });
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [active]);

  const current = signals[active] ?? signals[0];

  const stripDots = useMemo(() => signals.slice(0, 20), [signals]);
  const moreCount = Math.max(0, signals.length - 20);

  const accuracyPct = useMemo(() => {
    if (performanceSummary.signals_evaluated > 0) {
      return Math.round(performanceSummary.directional_accuracy_percent);
    }
    const local = directionalAccuracyFromSignals(signals);
    return local != null ? local : null;
  }, [performanceSummary.directional_accuracy_percent, performanceSummary.signals_evaluated, signals]);

  if (!current) return null;

  const oneHourPctLabel = formatOneHourPctLabel(current.price_at_signal, current.price_1h_after);

  const tabButtonBase: CSSProperties = {
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: 14,
    letterSpacing: "0.06em",
    padding: "10px 18px",
    borderRadius: 10,
    border: "1px solid transparent",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease"
  };

  return (
    <section className="border-b border-[rgba(0,180,255,0.06)] px-5 py-12 md:px-10 md:py-20">
      <div className="mx-auto max-w-5xl">
        <p
          className="mb-2 text-center uppercase tracking-[0.2em] text-[#00b4ff]/90"
          style={{ fontFamily: MONO, fontSize: 11 }}
        >
          YESTERDAY&apos;S SIGNALS
        </p>
        <h2 className="mb-3 text-center text-2xl font-bold leading-tight text-slate-50 md:text-3xl">
          Signal outcome tracking — evaluated signals from yesterday
        </h2>
        <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-slate-400 md:text-base">
          Historical signal data: each row is compared to subsequent price movement (1h window in this view).
        </p>

        {/* Track record strip */}
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] text-slate-500" style={{ fontFamily: MONO }}>
              Yesterday · {signals.length} signal{signals.length === 1 ? "" : "s"} generated
            </p>
            <p className="text-[11px]" style={{ fontFamily: MONO, color: accuracyPct != null ? "#00e87a" : "#64748b" }}>
              {accuracyPct != null ? `${accuracyPct}% directional accuracy` : "— directional accuracy"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-[3px]">
            {stripDots.map((sig, i) => {
              const { bg, shadow } = dotFill(sig.outcome_1h);
              const selected = i === active;
              return (
                <button
                  key={`${sig.symbol}-${sig.generated_at}-${i}`}
                  type="button"
                  aria-label={`Signal ${i + 1} ${sig.symbol}`}
                  aria-pressed={selected}
                  onClick={() => setActive(i)}
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <span
                    className="block rounded-full"
                    style={{
                      width: 10,
                      height: 10,
                      background: bg,
                      boxShadow: shadow,
                      transform: selected ? "scale(1.4)" : undefined,
                      outline: selected ? "2px solid #fff" : undefined,
                      outlineOffset: selected ? 1 : undefined
                    }}
                  />
                </button>
              );
            })}
            {moreCount > 0 ? (
              <span className="pl-1 text-[10px] text-slate-500" style={{ fontFamily: MONO }}>
                +{moreCount} more
              </span>
            ) : null}
          </div>
        </div>

        <div className="mb-2 flex flex-wrap gap-2.5" role="tablist" aria-label="Signals">
          {signals.map((sig, i) => {
            const isActive = i === active;
            const dotColor =
              sig.direction === "bearish" ? "#ff3d5a" : sig.direction === "neutral" ? "#f5c542" : "#00e87a";
            return (
              <button
                key={`${sig.symbol}-${i}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(i)}
                className="inline-flex items-center gap-2.5 tabular-nums"
                style={{
                  ...tabButtonBase,
                  background: isActive
                    ? "linear-gradient(165deg, rgba(0,212,255,0.16) 0%, rgba(15,23,42,0.92) 55%)"
                    : "rgba(15,23,42,0.55)",
                  color: isActive ? "#f1f5f9" : "#94a3b8",
                  borderColor: isActive ? "rgba(0,212,255,0.55)" : "rgba(71,85,105,0.5)",
                  boxShadow: isActive ? "0 0 0 1px rgba(0,212,255,0.35), 0 10px 28px rgba(0,0,0,0.35)" : "none",
                  fontWeight: isActive ? 800 : 600
                }}
              >
                <span
                  className="shrink-0 rounded-full ring-1 ring-white/10"
                  style={{
                    width: 7,
                    height: 7,
                    background: dotColor,
                    boxShadow: isActive ? `0 0 10px ${dotColor}88` : "none"
                  }}
                />
                {sig.symbol}
              </button>
            );
          })}
        </div>
        <p className="mb-4 text-[10px] italic" style={{ fontFamily: MONO, color: "#4a6080" }}>
          {usedApiFallback
            ? "Showing 5 example signals — 4 correct, 1 incorrect. Live history builds from market open."
            : `Showing ${signals.length} signals from yesterday · ${
                accuracyPct != null ? `${accuracyPct}% directional accuracy` : "— directional accuracy"
              }`}
        </p>

        <div className="landing-glow-card mb-6 p-6">
          <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-2xl font-bold tracking-[2px] text-slate-50">{current.symbol}</p>
              <p className="mt-1 text-sm text-slate-500" style={{ fontFamily: MONO }}>
                {formatSignalWhen(current.generated_at)} · {current.pattern}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 sm:justify-end">
              <span
                className="rounded px-2 py-1 text-xs font-bold uppercase tracking-wide"
                style={{
                  background:
                    current.direction === "bullish"
                      ? "rgba(34,197,94,0.15)"
                      : current.direction === "bearish"
                        ? "rgba(239,68,68,0.15)"
                        : "rgba(245,158,11,0.15)",
                  color:
                    current.direction === "bullish"
                      ? "#4ade80"
                      : current.direction === "bearish"
                        ? "#f87171"
                        : "#fbbf24"
                }}
              >
                {current.direction === "bullish"
                  ? "BULLISH"
                  : current.direction === "bearish"
                    ? "BEARISH"
                    : "NEUTRAL"}
              </span>
              <div className="text-right">
                <p
                  className="text-[32px] font-bold leading-none"
                  style={{
                    fontFamily: MONO,
                    color:
                      current.direction === "bullish"
                        ? "#4ade80"
                        : current.direction === "bearish"
                          ? "#f87171"
                          : "#fbbf24"
                  }}
                >
                  {current.signal_strength}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">strength</p>
              </div>
            </div>
          </div>

          <div className="mb-6">
            {current.outcome_1h === "correct" ? (
              <div
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: "rgba(34,197,94,0.35)",
                  background: "rgba(34,197,94,0.08)",
                  color: "#86efac"
                }}
              >
                <span className="font-semibold">Outcome: Correct — price moved as signaled</span>
                <p className="mt-1 text-xs text-slate-300">
                  ${current.price_at_signal.toFixed(2)} → $
                  {current.price_1h_after != null ? current.price_1h_after.toFixed(2) : "—"}
                  {oneHourPctLabel != null ? ` · ${oneHourPctLabel}% in 1h` : null}
                </p>
                {usedApiFallback ? (
                  <p className="mt-1 text-[10px] italic text-slate-500">(example data)</p>
                ) : null}
              </div>
            ) : null}
            {current.outcome_1h === "incorrect" ? (
              <div
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: "rgba(248,113,113,0.4)",
                  background: "rgba(239,68,68,0.08)",
                  color: "#fecaca"
                }}
              >
                <span className="font-semibold">Price moved opposite the signal direction</span>
                <p className="mt-1 text-xs text-slate-300">
                  ${current.price_at_signal.toFixed(2)} → $
                  {current.price_1h_after != null ? current.price_1h_after.toFixed(2) : "—"}
                  {oneHourPctLabel != null ? ` · ${oneHourPctLabel}% in 1h` : null}
                </p>
              </div>
            ) : null}
            {current.outcome_1h === "neutral" ? (
              <div
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: "rgba(245,158,11,0.35)",
                  background: "rgba(245,158,11,0.08)",
                  color: "#fde68a"
                }}
              >
                <span className="font-semibold">~ NEUTRAL — insufficient movement</span>
                <p className="mt-1 text-xs text-slate-300">
                  ${current.price_at_signal.toFixed(2)} → $
                  {current.price_1h_after != null ? current.price_1h_after.toFixed(2) : "—"}
                  {oneHourPctLabel != null ? ` · ${oneHourPctLabel}% in 1h` : null}
                </p>
              </div>
            ) : null}
          </div>

          <div className="mb-6 space-y-3">
            {LAYERS.map(({ key, label }, idx) => {
              const score = current.layer_scores[key];
              const w = barReveal * score;
              return (
                <div key={`${active}-${key}`} className="flex items-center gap-3">
                  <span
                    className="w-[88px] shrink-0 text-[11px] uppercase text-slate-500"
                    style={{ fontFamily: MONO }}
                  >
                    {label}
                  </span>
                  <div className="h-2 min-w-0 flex-1 rounded-full bg-white/5">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${w}%`,
                        background: barGradient(score),
                        transition: "width 0.6s ease-out",
                        transitionDelay: `${idx * 80}ms`
                      }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-xs text-slate-300" style={{ fontFamily: MONO }}>
                    {score}%
                  </span>
                </div>
              );
            })}
          </div>

          {displaySummary(current.ai_summary) ? (
            <blockquote className="mb-4 border-l-2 border-[rgba(0,180,255,0.2)] pl-3 text-[13px] italic leading-[1.7] text-slate-400">
              &ldquo;{displaySummary(current.ai_summary)}&rdquo;
            </blockquote>
          ) : null}

          <p className="text-[9px] text-slate-500" style={{ fontFamily: MONO }}>
            Signal data for informational purposes only · Not investment advice
          </p>
        </div>

        <div className="landing-glow-card-gate flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <p className="font-bold text-slate-100">Today&apos;s signals are generating live</p>
            <p className="mt-1 max-w-xl text-sm text-slate-400">
              These are yesterday&apos;s results. Sign up free to see signals as they fire during market hours.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href="/signup"
              className="inline-flex min-h-10 items-center justify-center rounded-md px-5 py-2 text-center text-sm font-semibold text-white"
              style={{ background: "#0077cc", boxShadow: "0 0 20px rgba(0,180,255,0.25)" }}
            >
              Start Free — No Card Required
            </Link>
            <a href="#how-it-works" className="text-center text-sm text-[#00d4ff] hover:underline sm:px-2">
              See how it works ↓
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
