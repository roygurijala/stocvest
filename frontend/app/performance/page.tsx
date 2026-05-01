"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchLiveSignals, fetchPerformanceSummary, type PerformanceSummary, type PublicSignal } from "@/lib/api/public-signals";

function fmtMaybePrice(v: number | null | undefined): string {
  return typeof v === "number" ? `$${v.toFixed(2)}` : "—";
}

function outcomeLabel(outcome: PublicSignal["outcome"]): string {
  if (outcome === "win") return "✅ Win";
  if (outcome === "loss") return "❌ Loss";
  if (outcome === "neutral") return "➖ Neutral";
  return "⏳ Pending";
}

export default function PerformancePage() {
  const [signals, setSignals] = useState<PublicSignal[]>([]);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [s, p] = await Promise.all([fetchLiveSignals(), fetchPerformanceSummary()]);
      if (!active) return;
      setSignals(s.slice(0, 20));
      setSummary(p);
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const launchDate = summary?.launch_date ?? new Date().toISOString().slice(0, 10);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0a0e1a] px-4 py-14 text-slate-100 md:px-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/" className="text-sm text-[#3b82f6] hover:underline">
          ← Back to home
        </Link>
        <h1 className="mt-5 text-4xl font-black md:text-6xl">Signal Performance</h1>
        <p className="mt-3 max-w-4xl text-slate-300 md:text-xl">
          Every signal we generate is tracked against real market outcomes. Published transparently — wins and losses.
        </p>

        <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Total Signals</p>
            <p className="mt-2 text-2xl font-bold">{summary?.total_signals_tracked ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Win Rate</p>
            <p className="mt-2 text-2xl font-bold">{summary ? `${summary.win_rate_percent.toFixed(1)}%` : "—"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Signals Resolved</p>
            <p className="mt-2 text-2xl font-bold">{summary?.total_resolved ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Tracking Since</p>
            <p className="mt-2 text-2xl font-bold">{launchDate}</p>
          </div>
        </section>

        {signals.length === 0 ? (
          <section className="mt-8 rounded-xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-bold">Performance Tracking Starts Now</h2>
            <p className="mt-3 text-slate-300">
              We launched on {launchDate}. Signal performance data accumulates from our first day.
              <br />
              Every signal generated from this point is tracked against real market outcomes.
              <br />
              Check back in 7 days for our first week of performance data.
            </p>
            <Link href="/#live-signals" className="mt-5 inline-block rounded-md border border-white/20 px-4 py-2 text-sm hover:border-white/40">
              View Live Signals
            </Link>
          </section>
        ) : (
          <section className="mt-8 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[980px] bg-white/5 text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-slate-300">
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Date and Time</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Price at Signal</th>
                  <th className="px-4 py-3">Price Outcome</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((row) => (
                  <tr key={`${row.symbol}-${row.timestamp_iso}`} className="border-b border-white/10">
                    <td className="px-4 py-3 font-semibold">{row.symbol}</td>
                    <td className="px-4 py-3 capitalize">{row.direction}</td>
                    <td className="px-4 py-3">{Math.round(row.confidence)}%</td>
                    <td className="px-4 py-3 text-slate-300">{new Date(row.timestamp_iso).toLocaleString()}</td>
                    <td className="px-4 py-3">{outcomeLabel(row.outcome)}</td>
                    <td className="px-4 py-3">{fmtMaybePrice(row.price_at_signal)}</td>
                    <td className="px-4 py-3">{fmtMaybePrice(row.price_outcome)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="mt-8 rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-bold">Our commitment to transparency</h2>
          <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-300">
            <li>We publish every signal — not just winners</li>
            <li>Small sample sizes are shown with sample count</li>
            <li>Past performance does not guarantee future results</li>
            <li>Win rates are calculated on resolved signals only</li>
            <li>A signal is resolved when price moves more than 0.5% within 24 hours</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
