"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bot, ChartColumnIncreasing, Newspaper, ShieldCheck } from "lucide-react";
import { LandingActivityFeedSection } from "@/components/landing-activity-feed";
import { LandingBeforeAfterSection } from "@/components/landing-before-after";
import { LandingHowItWorksSection } from "@/components/landing-how-it-works-section";
import { LandingPerformanceSection } from "@/components/landing-performance-section";
import { LandingSignalExplorer } from "@/components/landing-signal-explorer";
import type { LandingSignal } from "@/lib/api/landing-signals";
import { useScrollPosition } from "@/lib/hooks/use-scroll-position";
import type { PerformanceSummary } from "@/lib/api/public-signals";

const comparisonRows = [
  "AI Signal Synthesis",
  "Multi-Broker Execution",
  "Signal Reasoning Transparency",
  "Pre-Market Intelligence Briefing",
  "PDT Guardian",
  "Day and Swing Trading Combined"
];

export type LandingPageProps = {
  explorerSignals: LandingSignal[];
  activitySignals: LandingSignal[];
  usedApiFallback: boolean;
  performanceSummary: PerformanceSummary;
};

export function LandingPage({
  explorerSignals,
  activitySignals,
  usedApiFallback,
  performanceSummary
}: LandingPageProps) {
  const isScrolled = useScrollPosition(24);

  return (
    <main className="bg-[#0a0e1a] text-slate-100">
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
          isScrolled ? "border-b border-white/10 bg-[#0a0e1a]/95 backdrop-blur" : "bg-transparent"
        }`}
      >
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-4 md:px-8">
          <p className="text-lg font-extrabold tracking-tight text-[#3b82f6] sm:text-xl">STOCVEST</p>
          <div className="flex items-center gap-2 md:gap-3">
            <Link href="/login" className="rounded-md border border-white/20 px-4 py-2 text-sm hover:border-white/40">
              Login
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_24px_rgba(59,130,246,0.4)] transition hover:shadow-[0_0_30px_rgba(59,130,246,0.7)]"
            >
              Get Started
            </Link>
          </div>
        </nav>
      </header>

      <section className="relative flex min-h-screen items-center overflow-hidden px-4 pt-24 md:px-8">
        <div className="absolute inset-0">
          {Array.from({ length: 48 }).map((_, idx) => (
            <motion.span
              key={idx}
              className="absolute h-1 w-1 rounded-full bg-[#3b82f6]/60"
              style={{
                left: `${(idx * 11) % 100}%`,
                top: `${(idx * 19) % 100}%`
              }}
              animate={{ y: [0, -30, 0], opacity: [0.22, 0.8, 0.22] }}
              transition={{ duration: 3.5 + (idx % 5), repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
          {Array.from({ length: 26 }).map((_, idx) => (
            <motion.span
              key={`candle-${idx}`}
              className="absolute w-px bg-white/10"
              style={{
                left: `${4 + idx * 3.7}%`,
                bottom: `${(idx * 7) % 45}%`,
                height: `${28 + (idx % 8) * 14}px`
              }}
              animate={{ y: [0, -14, 0], opacity: [0.05, 0.09, 0.05] }}
              transition={{ duration: 6 + (idx % 4), repeat: Infinity, ease: "easeInOut", delay: idx * 0.12 }}
            />
          ))}
        </div>
        <div className="relative mx-auto grid w-full max-w-7xl gap-8">
          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-4xl text-3xl font-black leading-tight sm:text-4xl md:text-6xl"
          >
            Trade with institutional intelligence.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="max-w-3xl text-base text-slate-300 sm:text-lg md:text-2xl"
          >
            Six signal layers. AI synthesis. Multi-broker execution. Built for traders who want data-driven signal intelligence.
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="flex w-full max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:flex-wrap"
          >
            <Link
              href="/signup"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#3b82f6] px-6 py-3 text-center font-semibold shadow-[0_0_24px_rgba(59,130,246,0.5)] transition hover:shadow-[0_0_35px_rgba(59,130,246,0.8)]"
            >
              Start Free Trial
            </Link>
            <Link
              href="#the-problem"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300/30 px-6 py-3 text-center font-semibold hover:border-slate-200/60"
            >
              Learn More
            </Link>
          </motion.div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-400 sm:text-xs">
            {["Real-time data by Polygon.io", "AI by Anthropic Claude", "Infrastructure on AWS", "STOCVEST LLC", "Not investment advice"].map((b) => (
              <span key={b} className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                {b}
              </span>
            ))}
          </div>
        </div>
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 1.4 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-slate-300"
        >
          ↓
        </motion.div>
      </section>

      <LandingHowItWorksSection />

      <LandingSignalExplorer signals={explorerSignals} usedApiFallback={usedApiFallback} />

      <LandingBeforeAfterSection />

      <LandingActivityFeedSection
        signals={activitySignals}
        performanceSummary={performanceSummary}
        showPlaceholderList={usedApiFallback}
      />

      <LandingPerformanceSection summary={performanceSummary} />

      <section className="mx-auto max-w-7xl px-4 py-20 md:px-8">
        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-8 text-center text-3xl font-bold md:text-4xl">
          Finally built for serious traders.
        </motion.h2>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[720px] bg-white/5 text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="px-4 py-3">Capability</th>
                <th className="bg-[#3b82f6]/20 px-4 py-3">STOCVEST</th>
                <th className="px-4 py-3">ThinkorSwim</th>
                <th className="px-4 py-3">Unusual Whales</th>
                <th className="px-4 py-3">Finviz</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row, idx) => (
                <motion.tr
                  key={row}
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.08 }}
                  className="border-b border-white/10"
                >
                  <td className="px-4 py-3">{row}</td>
                  <td className="bg-[#3b82f6]/15 px-4 py-3 text-[#22c55e]">✓</td>
                  <td className="px-4 py-3 text-slate-400">✕</td>
                  <td className="px-4 py-3 text-slate-400">✕</td>
                  <td className="px-4 py-3 text-slate-400">✕</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="the-problem" className="mx-auto max-w-7xl px-4 py-20 md:px-8">
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-10 text-center">
          <h2 className="text-3xl font-bold md:text-4xl">Most platforms show you data. STOCVEST surfaces the signals — you make the call.</h2>
        </motion.div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { icon: ChartColumnIncreasing, a: "They give you charts", b: "We surface signal patterns" },
            { icon: Newspaper, a: "They show you news", b: "We show signal relevance" },
            { icon: Bot, a: "They use static rules", b: "We use AI synthesis" }
          ].map((item, i) => (
            <motion.article
              key={item.a}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="rounded-xl border border-white/10 border-l-2 border-l-[#3b82f6] bg-[#111827] p-6"
            >
              <item.icon className="mb-3 h-8 w-8 text-[#3b82f6]" />
              <p className="text-sm text-[#6b7280]">{item.a}</p>
              <p className="text-xl font-bold text-[#3b82f6]">{item.b}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 md:px-8">
        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-3 text-center text-3xl font-bold md:text-4xl">
          Every morning at 8 AM. Before the market opens.
        </motion.h2>
        <motion.article initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mx-auto max-w-3xl rounded-xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-lg font-semibold">Sample Intelligence Briefing</h3>
          <p className="mb-4 text-xs italic text-slate-400">Real briefings delivered daily at 8 AM ET to logged-in users</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="mb-2 text-sm text-slate-400">Gap Signal Candidates</p>
              <p>NVDA +4.2%</p>
              <p>AMD +2.8%</p>
              <p>TSLA -1.9%</p>
            </div>
            <div>
              <p className="mb-2 text-sm text-slate-400">News Catalysts</p>
              <p>
                AAPL <span className="text-[#22c55e]">Positive</span>
              </p>
              <p>
                MSFT <span className="text-[#22c55e]">Positive</span>
              </p>
              <p>
                META <span className="text-[#f59e0b]">Mixed</span>
              </p>
            </div>
            <div>
              <p className="mb-2 text-sm text-slate-400">Top Active Signal</p>
              <p className="font-semibold">AAPL ORB Long</p>
              <p className="text-[#3b82f6]">82% signal strength</p>
            </div>
          </div>
        </motion.article>
        <p className="mt-4 text-center text-slate-300">
          Every trading day at 8 AM ET, STOCVEST delivers your pre-market intelligence briefing automatically. No manual research required.
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 text-center md:px-8">
        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-6 text-3xl font-bold md:text-4xl">
          Trade safely. Always.
        </motion.h2>
        <motion.div
          animate={{ boxShadow: ["0 0 0 rgba(34,197,94,0.2)", "0 0 40px rgba(34,197,94,0.45)", "0 0 0 rgba(34,197,94,0.2)"] }}
          transition={{ duration: 2.2, repeat: Infinity }}
          className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-[#22c55e]/10"
        >
          <ShieldCheck className="h-12 w-12 text-[#22c55e]" />
        </motion.div>
        <p className="mb-6 text-slate-300">PDT rule enforced at the broker layer. Hard block not a suggestion.</p>
        <div className="mx-auto max-w-md rounded-xl border border-white/10 bg-white/5 p-4 text-left">
          <p className="text-[#22c55e]">Day trades used: 0 of 3</p>
          <p>Status: Clear to trade</p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 md:px-8">
        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-8 text-center text-3xl font-bold md:text-4xl">
          Simple pricing. No hidden fees.
        </motion.h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[
            { tier: "Free", price: "$0/month", features: ["3 signals per day", "Basic scanner", "1 broker"] },
            {
              tier: "Pro",
              price: "$49/month",
              features: ["Unlimited signals", "All signal layers", "Backtesting", "Alerts", "3 brokers"],
              recommended: true
            },
            {
              tier: "Institutional",
              price: "$199/month",
              features: ["Everything in Pro", "API access", "Webhooks", "Priority support"]
            }
          ].map((plan) => (
            <motion.article
              key={plan.tier}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className={`relative flex flex-col rounded-xl border bg-white/5 p-6 ${plan.recommended ? "border-2 border-[#3b82f6] bg-[#0f172a] shadow-[0_0_20px_rgba(59,130,246,0.4)] lg:scale-105" : "border-white/10"}`}
            >
              {plan.recommended ? <p className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold uppercase tracking-wide text-[#3b82f6]">Most Popular</p> : null}
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xl font-semibold">{plan.tier}</h3>
                {plan.recommended ? <span className="rounded-full bg-[#3b82f6] px-3 py-1 text-sm font-bold text-white">Popular</span> : null}
              </div>
              <p className={`mb-3 text-2xl font-bold ${plan.recommended ? "text-[#3b82f6]" : ""}`}>{plan.price}</p>
              <ul className="mb-4 space-y-1 text-slate-300">
                {plan.features.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
              <Link
                href="/login"
                className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#3b82f6] px-4 py-2 text-sm font-semibold sm:w-auto"
              >
                Get Started
              </Link>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-black/20 px-4 py-20 text-center md:px-8">
        <h2 className="mb-4 text-3xl font-bold md:text-4xl">Stop guessing. Start trading with intelligence.</h2>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#3b82f6] px-6 py-3 font-semibold"
        >
          Create Your Free Account
        </Link>
        <p className="mt-3 text-slate-300">No credit card required for free tier</p>
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
