"use client";

import Link from "next/link";
import { useState } from "react";
import { MoonStar, Zap } from "lucide-react";
import type { LandingSignal } from "@/lib/api/landing-signals";
import type { PerformanceSummary } from "@/lib/api/public-signals";
import { useScrollPosition } from "@/lib/hooks/use-scroll-position";

const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

type LandingMode = "swing" | "day";

export type LandingPageProps = {
  explorerSignals: LandingSignal[];
  activitySignals: LandingSignal[];
  usedApiFallback: boolean;
  performanceSummary: PerformanceSummary;
  foundingMemberCount: number | null;
};

function hasEnoughAccuracyData(summary: PerformanceSummary): boolean {
  return summary.signals_evaluated >= 20;
}

function signalModeBadge(s: LandingSignal): "SWING" | "DAY" {
  const p = s.pattern.toLowerCase();
  if (p.includes("daily") || p.includes("swing") || p.includes("ema") || p.includes("weekly")) return "SWING";
  return "DAY";
}

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

function EngineCard({ mode }: { mode: LandingMode }) {
  if (mode === "day") {
    return (
      <div className="landing-glow-card p-5">
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
          "ORB breakout confirmed above VWAP with earnings catalyst still active. Tech sector leading. 4 of 6 layers aligned bullish."
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
    <div className="landing-glow-card p-5">
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
        ⚠ GEO LAYER: Semiconductors carry 1.8× weight on US-China trade tension. PINS would score 0.4×. Same news. Different stock. Different exposure.
      </div>
      <p className="mb-3 text-sm italic text-slate-300">
        "Strong daily structure and earnings momentum. Geo headwind partially offsets bullish thesis. Watch for trade policy headlines this week."
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

export function LandingPage({
  explorerSignals: _explorerSignals,
  activitySignals,
  usedApiFallback: _usedApiFallback,
  performanceSummary,
  foundingMemberCount: _foundingMemberCount
}: LandingPageProps) {
  const isScrolled = useScrollPosition(24);
  const [engineTab, setEngineTab] = useState<LandingMode>("swing");
  const enoughAccuracy = hasEnoughAccuracyData(performanceSummary);
  const recentSignals = activitySignals.slice(0, 5);
  const trustBadges = [
    "Real-time data · Polygon.io",
    "AI synthesis · Anthropic Claude",
    "Infrastructure · AWS",
    "STOCVEST LLC",
    "Not investment advice"
  ];

  return (
    <main className="bg-[#070d18] text-slate-100">
      <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${isScrolled ? "border-b border-white/10 bg-[#070d18]/95 backdrop-blur" : "bg-transparent"}`}>
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-4 md:px-8">
          <p className="text-lg font-extrabold tracking-tight text-[#3b82f6] sm:text-xl">STOCVEST</p>
          <div className="flex items-center gap-2 md:gap-3">
            <Link href="/login" className="rounded-md border border-white/20 px-4 py-2 text-sm hover:border-white/40">Login</Link>
            <Link href="/register" className="rounded-md bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white">Get Started</Link>
          </div>
        </nav>
      </header>

      {/* 1 · Hero — decision-first */}
      <section className="mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-4 pt-24 md:px-8">
        <h1 className="max-w-4xl text-4xl font-black leading-tight md:text-6xl">
          Know when to trade — and when to stay out.
          <br />
          Intelligence for swing and day traders who don&apos;t guess.
        </h1>
        <p className="mt-5 max-w-3xl text-lg text-slate-300">
          STOCVEST evaluates every setup across six independent layers — and only surfaces trades when they agree. Built for traders who want
          alignment, not noise.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/register" className="rounded-md bg-[#3b82f6] px-6 py-3 font-semibold">
            Start Free — No Card Required
          </Link>
          <a href="#the-engine" className="rounded-md border border-white/30 px-6 py-3 font-semibold">
            See How It Works
          </a>
        </div>
        <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-300">
          {trustBadges.map((b) => (
            <span key={b} className="rounded-full border border-white/15 bg-white/5 px-2 py-1">
              {b}
            </span>
          ))}
        </div>
      </section>

      {/* 2 · Swing vs Day */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:px-8">
        <p className="mb-2 text-center text-xs uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: MONO }}>
          TWO TRADING STYLES
        </p>
        <h2 className="mb-4 text-center text-3xl font-bold md:text-4xl">Your style. Your timeframe. The same six-layer intelligence.</h2>
        <p className="mx-auto mb-8 max-w-3xl text-center text-base leading-relaxed text-slate-300">
          Same intelligence engine. Different time horizons.
          <br />
          Discipline stays constant — execution adapts.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="landing-glow-card p-6">
            <div className="mb-3 flex items-center gap-2">
              <MoonStar className="h-5 w-5 text-cyan-300" />
              <span className="text-xs uppercase tracking-[0.2em] text-cyan-300" style={{ fontFamily: MONO }}>
                SWING TRADING
              </span>
            </div>
            <p className="mb-4 text-sm text-slate-300">Plan tonight. Trade this week.</p>
            <ul className="space-y-2 text-sm text-slate-200">
              <li>• Daily bar scanner — daily structure shifts and momentum recovery</li>
              <li>• Pattern maturity tracking — &quot;Forming 6 days&quot;</li>
              <li>• 5-day news context with recency weighting</li>
              <li>• Weekly sector rotation context</li>
              <li>• Entry zone + stop + target on every setup</li>
              <li>• Check once a day — alerts when levels hit</li>
            </ul>
          </div>
          <div
            className="landing-glow-card p-6"
            style={{ borderLeftColor: "rgba(245,158,11,0.9)", borderBottomColor: "rgba(245,158,11,0.9)" }}
          >
            <div className="mb-3 flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-300" />
              <span className="text-xs uppercase tracking-[0.2em] text-amber-300" style={{ fontFamily: MONO }}>
                DAY TRADING
              </span>
            </div>
            <p className="mb-4 text-sm text-slate-300">Pre-market ready. Act at open.</p>
            <ul className="space-y-2 text-sm text-slate-200">
              <li>• Pre-market gap scanner — ranked by catalyst</li>
              <li>• ORB breakout + VWAP setup detection</li>
              <li>• Real-time intraday confluence scoring</li>
              <li>• 8 AM intelligence brief every trading day</li>
              <li>• Ranked setups with signal strength at open</li>
              <li>• Intraday alerts as signals fire</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Who it is for */}
      <section className="border-y border-white/10 bg-black/25 px-4 py-16 md:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="mb-2 text-center text-xs uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: MONO }}>
            FIT
          </p>
          <h2 className="mb-8 text-center text-3xl font-bold md:text-4xl">Who STOCVEST is for — and who it isn&apos;t</h2>
          <div className="grid gap-8 md:grid-cols-2 md:gap-12">
            <div>
              <p className="mb-3 font-semibold text-emerald-300/90">Built for traders who:</p>
              <ul className="space-y-2 text-sm leading-relaxed text-slate-200">
                <li>• value restraint over constant action</li>
                <li>• want to understand why a trade exists</li>
                <li>• trade defined plans on defined timeframes</li>
              </ul>
            </div>
            <div>
              <p className="mb-3 font-semibold text-slate-400">Not built for:</p>
              <ul className="space-y-2 text-sm leading-relaxed text-slate-300">
                <li>• gambling</li>
                <li>• prediction chasing</li>
                <li>• indicator tinkering</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 4 · How traders use STOCVEST */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:px-8">
        <p className="mb-2 text-center text-xs uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: MONO }}>
          WORKFLOW
        </p>
        <h2 className="mb-8 text-center text-3xl font-bold md:text-4xl">How traders use STOCVEST</h2>
        <ol className="mx-auto grid max-w-4xl gap-4 text-sm text-slate-200 md:grid-cols-2">
          <li className="landing-glow-card p-4">
            <span className="font-mono text-xs text-cyan-300">01</span>
            <p className="mt-2 leading-relaxed">Start from context — indices, regime, and the morning brief so you know the tape you&apos;re operating in.</p>
          </li>
          <li className="landing-glow-card p-4">
            <span className="font-mono text-xs text-cyan-300">02</span>
            <p className="mt-2 leading-relaxed">Scan gaps and setups when your plan says to look — not on every tick.</p>
          </li>
          <li className="landing-glow-card p-4">
            <span className="font-mono text-xs text-cyan-300">03</span>
            <p className="mt-2 leading-relaxed">Open evidence only when layers align; read the composite and the conflicts, not a single headline.</p>
          </li>
          <li className="landing-glow-card p-4">
            <span className="font-mono text-xs text-cyan-300">04</span>
            <p className="mt-2 leading-relaxed">Execute from your own rules — or step aside when alignment isn&apos;t there.</p>
          </li>
        </ol>
      </section>

      {/* 5 · Six-layer engine + example card */}
      <section id="the-engine" className="mx-auto max-w-7xl px-4 py-16 md:px-8">
        <p className="mb-2 text-center text-xs uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: MONO }}>
          THE ENGINE
        </p>
        <p className="mx-auto mb-4 max-w-3xl text-center text-base leading-relaxed text-slate-300">
          Most traders lose money not because they lack data — but because they rely on only one or two perspectives at a time.
        </p>
        <h2 className="text-center text-3xl font-bold md:text-5xl">Every other platform gives you data. We give you a verdict.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm font-medium text-slate-200">
          You see the reasoning behind every call — nothing is hidden.
        </p>
        <p className="mx-auto mt-4 max-w-3xl text-center text-slate-300">
          Six independent engines analyze every setup simultaneously. One composite score. One directional call. Full reasoning shown — always.
        </p>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-slate-400">
          Here&apos;s what alignment looks like when all six layers are considered together.
        </p>
        <div className="mx-auto mt-4 max-w-4xl">
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              className={`rounded-md px-4 py-2 text-sm font-semibold ${engineTab === "swing" ? "bg-cyan-500/20 text-cyan-200" : "bg-white/5 text-slate-300"}`}
              onClick={() => setEngineTab("swing")}
            >
              SWING
            </button>
            <button
              type="button"
              className={`rounded-md px-4 py-2 text-sm font-semibold ${engineTab === "day" ? "bg-cyan-500/20 text-cyan-200" : "bg-white/5 text-slate-300"}`}
              onClick={() => setEngineTab("day")}
            >
              DAY
            </button>
          </div>
          <EngineCard mode={engineTab} />
        </div>
        <p className="mx-auto mt-4 max-w-3xl text-center text-xs leading-relaxed text-slate-500">
          Most traders review this card briefly — or not at all — depending on experience level. The platform holds the full depth when you need
          it.
        </p>
        <div className="mt-8 rounded-lg border border-amber-300/40 bg-amber-300/10 p-5 text-sm text-amber-100">
          <p className="font-semibold">The geo layer isn&apos;t a generic market risk flag.</p>
          <p className="mt-2">It knows NVDA faces semiconductor trade restrictions at 1.8× sensitivity. PINS (social media) faces almost none at 0.4×.</p>
          <p className="mt-2">Same world event. Two completely different reads.</p>
          <p className="mt-2 font-semibold">No other retail trading platform does this.</p>
        </div>
      </section>

      {/* 6 · Pricing */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:px-8">
        <h2 className="mb-2 text-center text-3xl font-bold md:text-4xl">Simple pricing. Both modes included.</h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm text-slate-400">Early member pricing for initial members at signup.</p>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="landing-pricing-card p-6">
            <h3 className="text-xl font-bold">Free</h3>
            <p className="mt-1 text-sm text-slate-400">Understand the system</p>
            <p className="mt-2 text-3xl font-black text-cyan-300">$0/month</p>
            <ul className="mt-3 space-y-1 text-sm text-slate-300">
              <li>• Limited access to swing signals</li>
              <li>• Limited access to day signals</li>
              <li>• Limited evidence views per day</li>
              <li>• Basic scanner results</li>
              <li>• Signal evidence cards</li>
              <li>• Public signal track record</li>
            </ul>
            <Link href="/register" className="mt-4 inline-flex rounded-md bg-[#3b82f6] px-4 py-2 font-semibold">
              Get Started Free
            </Link>
          </div>
          <div className="landing-pricing-card landing-pricing-card--selected p-6">
            <p className="text-xs font-bold uppercase tracking-wide text-cyan-300">Most Popular</p>
            <h3 className="text-xl font-bold">Swing Pro</h3>
            <p className="mt-1 text-sm text-slate-400">Commit to disciplined swing trading</p>
            <p className="mt-2 text-sm text-slate-400 line-through">$49/month</p>
            <p className="text-3xl font-black text-cyan-300">$29/month</p>
            <p className="text-xs text-slate-400">Early member rate · reg. $49</p>
            <ul className="mt-3 space-y-1 text-sm text-slate-300">
              <li>• Full swing signal access</li>
              <li>• Full daily bar scanner</li>
              <li>• AI signal explanations (paid feature)</li>
              <li>• Swing trading alerts</li>
            </ul>
            <Link href="/register" className="mt-4 inline-flex rounded-md bg-[#3b82f6] px-4 py-2 font-semibold">
              Choose Swing Pro
            </Link>
          </div>
          <div className="landing-pricing-card p-6">
            <h3 className="text-xl font-bold">Swing + Day Pro</h3>
            <p className="mt-1 text-sm text-slate-400">Full-spectrum market intelligence</p>
            <p className="mt-2 text-sm text-slate-400 line-through">$99/month</p>
            <p className="text-3xl font-black text-cyan-300">$59/month</p>
            <p className="text-xs text-slate-400">Early member rate · reg. $99</p>
            <ul className="mt-3 space-y-1 text-sm text-slate-300">
              <li>• Everything in Swing Pro</li>
              <li>• Full day-trading signal access</li>
              <li>• Pre-market gap scanner</li>
              <li>• Intraday real-time signals</li>
              <li>• Day trading alerts</li>
              <li>• Priority support</li>
            </ul>
            <Link href="/register" className="mt-4 inline-flex rounded-md bg-[#3b82f6] px-4 py-2 font-semibold">
              Choose Swing + Day Pro
            </Link>
          </div>
        </div>
      </section>

      {/* 7 · Live engine */}
      <section className="mx-auto max-w-7xl px-4 py-16 md:px-8">
        <p className="mb-2 text-center text-xs uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: MONO }}>
          LIVE ENGINE
        </p>
        <h2 className="text-center text-3xl font-bold md:text-4xl">Signals generating right now</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-slate-400">
          Signals appear only when conditions align — inactivity is intentional.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="landing-glow-card p-4">
            {recentSignals.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-slate-300">Signal engine active</div>
            ) : (
              <ul className="space-y-2">
                {recentSignals.map((s, i) => (
                  <li key={`${s.symbol}-${i}`} className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{s.symbol}</span>
                      <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px]">{signalModeBadge(s)}</span>
                    </div>
                    <span className="text-cyan-300" style={{ fontFamily: MONO }}>
                      {s.signal_strength}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="landing-glow-card p-4">
            {!enoughAccuracy ? (
              <div className="text-sm text-slate-300">
                <p>Signal tracking began {performanceSummary.launch_date || "recently"}.</p>
                <p className="mt-2">Swing signals evaluate at daily close. Day signals evaluate within 24 hours.</p>
                <p className="mt-2">Live accuracy appears here automatically as signals complete their evaluation window.</p>
              </div>
            ) : (
              <p className="text-sm text-slate-300">Directional Accuracy: {performanceSummary.directional_accuracy_percent}%</p>
            )}
          </div>
        </div>
      </section>

      {/* 8 · Final CTA */}
      <section className="border-t border-white/10 bg-black/20 px-4 py-20 text-center md:px-8">
        <h2 className="mb-4 text-3xl font-bold md:text-4xl">Trade when layers align. Wait when they don&apos;t.</h2>
        <Link href="/register" className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#3b82f6] px-6 py-3 font-semibold">
          Create Your Free Account
        </Link>
        <p className="mt-3 text-slate-300">Explore the platform free. No credit card required.</p>
      </section>

      <footer className="flex flex-col items-center gap-3 px-4 py-8 text-sm text-slate-400 md:flex-row md:justify-between md:px-8">
        <span>Copyright 2026 STOCVEST LLC</span>
        <div className="flex max-w-full flex-wrap justify-center gap-x-4 gap-y-2">
          <Link href="/about">About</Link>
          <Link href="/how-it-works">How It Works</Link>
          <Link href="/performance">Performance</Link>
          <Link href="/security">Security</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <span>Not investment advice</span>
        </div>
      </footer>
    </main>
  );
}
