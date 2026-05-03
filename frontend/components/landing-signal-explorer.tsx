"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LandingSignal } from "@/lib/api/landing-signals";

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

export function LandingSignalExplorer({
  signals,
  usedApiFallback
}: {
  signals: LandingSignal[];
  usedApiFallback: boolean;
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
  const movePct = useMemo(
    () => (current ? pctMove(current.price_at_signal, current.price_1h_after) : null),
    [current]
  );

  if (!current) return null;

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
          The engine in action — real signals, real outcomes
        </h2>
        <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-slate-400 md:text-base">
          Every signal we generated yesterday, tracked against what actually happened
        </p>

        <div
          className="mb-4 flex flex-wrap gap-1 border-b border-[rgba(0,180,255,0.12)]"
          role="tablist"
          aria-label="Signals"
        >
          {signals.map((sig, i) => (
            <button
              key={`${sig.symbol}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className="relative px-3 py-2 transition-transform"
              style={{
                fontFamily: MONO,
                fontSize: 12,
                letterSpacing: "1px",
                color: i === active ? "#e2e8f0" : "#64748b",
                transform: i === active ? "translateY(-2px)" : undefined
              }}
            >
              [{sig.symbol}]
              {usedApiFallback ? (
                <span className="ml-1 rounded bg-white/10 px-1 text-[9px] font-normal text-slate-400">Example</span>
              ) : null}
              {i === active ? (
                <span
                  className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                  style={{ background: "#00d4ff", boxShadow: "0 0 12px rgba(0,212,255,0.6)" }}
                />
              ) : null}
            </button>
          ))}
        </div>

        <div
          className="mb-6 rounded-xl border p-6"
          style={{
            background: "#0c1828",
            borderColor: "rgba(0,180,255,0.12)",
            borderRadius: 12,
            padding: 24
          }}
        >
          <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-2xl font-bold tracking-[2px] text-slate-50">{current.symbol}</p>
              <p className="mt-1 text-sm text-slate-400">{formatSignalWhen(current.generated_at)}</p>
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
                <span className="font-semibold">✓ CORRECT — price moved as signaled</span>
                <p className="mt-1 text-xs text-slate-300">
                  ${current.price_at_signal.toFixed(2)} → $
                  {current.price_1h_after != null ? current.price_1h_after.toFixed(2) : "—"}
                  {movePct != null ? ` · ${movePct >= 0 ? "+" : ""}${movePct.toFixed(2)}% in 1h` : null}
                </p>
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
                <span className="font-semibold">✗ MISSED — price moved opposite</span>
                <p className="mt-1 text-xs text-slate-300">
                  ${current.price_at_signal.toFixed(2)} → $
                  {current.price_1h_after != null ? current.price_1h_after.toFixed(2) : "—"}
                  {movePct != null ? ` · ${movePct >= 0 ? "+" : ""}${movePct.toFixed(2)}% in 1h` : null}
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

        {usedApiFallback ? (
          <p className="mb-6 text-center text-xs text-slate-500">
            Live signal history begins building from market open today
          </p>
        ) : null}

        <div
          className="flex flex-col gap-4 rounded-[10px] border p-5 md:flex-row md:items-center md:justify-between md:px-6"
          style={{
            background: "linear-gradient(135deg, rgba(0,119,204,0.1), rgba(0,180,255,0.05))",
            borderColor: "rgba(0,180,255,0.2)"
          }}
        >
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
