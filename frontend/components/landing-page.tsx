"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import { useState } from "react";
import { Bot, ChartColumnIncreasing, Newspaper, ShieldCheck } from "lucide-react";
import { LandingActivityFeedSection } from "@/components/landing-activity-feed";
import { LandingBeforeAfterSection } from "@/components/landing-before-after";
import { LandingHowItWorksSection } from "@/components/landing-how-it-works-section";
import { LandingPerformanceSection } from "@/components/landing-performance-section";
import { LandingSignalExplorer } from "@/components/landing-signal-explorer";
import type { LandingSignal } from "@/lib/api/landing-signals";
import { useScrollPosition } from "@/lib/hooks/use-scroll-position";
import type { PerformanceSummary } from "@/lib/api/public-signals";

const MONO_TABLE =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

type ComparisonCell = { kind: "check" } | { kind: "dash" } | { kind: "note"; text: string };

type ComparisonRowDef = {
  capability: string;
  stocvest: ComparisonCell;
  webull: ComparisonCell;
  tradingview: ComparisonCell;
  unusualWhales: ComparisonCell;
};

type ComparisonGroupDef = { title: string; rows: ComparisonRowDef[] };

type LandingPlanTier = "Free" | "Pro" | "Institutional";

const LANDING_PRICING_PLANS: Array<{
  tier: LandingPlanTier;
  price: string;
  features: string[];
}> = [
  { tier: "Free", price: "$0/month", features: ["3 signals per day", "Basic scanner", "1 broker"] },
  {
    tier: "Pro",
    price: "$49/month",
    features: ["Unlimited signals", "All signal layers", "Backtesting", "Alerts", "3 brokers"]
  },
  {
    tier: "Institutional",
    price: "$199/month",
    features: ["Everything in Pro", "API access", "Webhooks", "Priority support"]
  }
];

const LANDING_COMPARISON_GROUPS: ComparisonGroupDef[] = [
  {
    title: "INTELLIGENCE",
    rows: [
      {
        capability: "AI signal synthesis with reasoning",
        stocvest: { kind: "check" },
        webull: { kind: "dash" },
        tradingview: { kind: "dash" },
        unusualWhales: { kind: "dash" }
      },
      {
        capability: "Pre-market gap intelligence + catalyst",
        stocvest: { kind: "check" },
        webull: { kind: "note", text: "partial" },
        tradingview: { kind: "note", text: "screener" },
        unusualWhales: { kind: "dash" }
      },
      {
        capability: "Confluence detection (multi-signal)",
        stocvest: { kind: "check" },
        webull: { kind: "dash" },
        tradingview: { kind: "dash" },
        unusualWhales: { kind: "dash" }
      },
      {
        capability: "Market regime detection",
        stocvest: { kind: "check" },
        webull: { kind: "dash" },
        tradingview: { kind: "dash" },
        unusualWhales: { kind: "dash" }
      }
    ]
  },
  {
    title: "EXECUTION",
    rows: [
      {
        capability: "Works with your existing broker",
        stocvest: { kind: "check" },
        webull: { kind: "note", text: "own broker" },
        tradingview: { kind: "dash" },
        unusualWhales: { kind: "dash" }
      },
      {
        capability: "PDT Guardian (hard block)",
        stocvest: { kind: "check" },
        webull: { kind: "note", text: "warning only" },
        tradingview: { kind: "dash" },
        unusualWhales: { kind: "dash" }
      }
    ]
  },
  {
    title: "TRANSPARENCY",
    rows: [
      {
        capability: "Published signal accuracy (wins + losses)",
        stocvest: { kind: "check" },
        webull: { kind: "dash" },
        tradingview: { kind: "dash" },
        unusualWhales: { kind: "note", text: "partial" }
      },
      {
        capability: "Automatic trade journal",
        stocvest: { kind: "check" },
        webull: { kind: "note", text: "basic" },
        tradingview: { kind: "dash" },
        unusualWhales: { kind: "dash" }
      }
    ]
  }
];

function ComparisonCellView({ cell }: { cell: ComparisonCell }) {
  if (cell.kind === "check") {
    return <span style={{ color: "#00e87a", fontSize: 14 }}>✓</span>;
  }
  if (cell.kind === "dash") {
    return (
      <span style={{ color: "#2a4060", fontSize: 13 }} className="select-none">
        —
      </span>
    );
  }
  return (
    <span
      className="italic"
      style={{ color: "#f5c542", fontSize: 10, fontFamily: MONO_TABLE }}
    >
      {cell.text}
    </span>
  );
}

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
  const [selectedPlanTier, setSelectedPlanTier] = useState<LandingPlanTier>("Pro");

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

      <LandingSignalExplorer
        signals={explorerSignals}
        usedApiFallback={usedApiFallback}
        performanceSummary={performanceSummary}
      />

      <LandingBeforeAfterSection />

      <LandingActivityFeedSection
        signals={activitySignals}
        performanceSummary={performanceSummary}
        showPlaceholderList={activitySignals.length === 0}
      />

      <LandingPerformanceSection summary={performanceSummary} />

      <section className="mx-auto max-w-7xl px-4 py-20 md:px-8">
        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-8 text-center text-3xl font-bold md:text-4xl">
          Finally built for serious traders.
        </motion.h2>
        <div className="landing-glow-card overflow-x-auto">
          <table className="w-full min-w-[880px] bg-white/[0.03] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th
                  className="px-4 py-3 font-normal"
                  style={{ fontFamily: MONO_TABLE, color: "#4a6080" }}
                >
                  Capability
                </th>
                <th
                  className="px-4 py-3 text-center font-normal"
                  style={{
                    fontFamily: MONO_TABLE,
                    color: "#00d4ff",
                    background: "rgba(0,180,255,0.08)"
                  }}
                >
                  STOCVEST
                </th>
                <th className="px-4 py-3 text-center font-normal" style={{ fontFamily: MONO_TABLE, color: "#4a6080" }}>
                  Webull
                </th>
                <th className="px-4 py-3 text-center font-normal" style={{ fontFamily: MONO_TABLE, color: "#4a6080" }}>
                  TradingView
                </th>
                <th className="px-4 py-3 text-center font-normal" style={{ fontFamily: MONO_TABLE, color: "#4a6080" }}>
                  Unusual Whales
                </th>
              </tr>
            </thead>
            <tbody>
              {LANDING_COMPARISON_GROUPS.flatMap((group, gi) => {
                const categoryRow = (
                  <tr key={`cat-${group.title}`} className="bg-transparent">
                    <td
                      colSpan={5}
                      className="px-[14px] pb-1 pt-[10px] font-normal uppercase"
                      style={{
                        fontFamily: MONO_TABLE,
                        fontSize: 9,
                        color: "#2a4060",
                        letterSpacing: "0.06em"
                      }}
                    >
                      {group.title}
                    </td>
                  </tr>
                );
                const dataRows = group.rows.map((row, ri) => {
                  const isLast =
                    gi === LANDING_COMPARISON_GROUPS.length - 1 && ri === group.rows.length - 1;
                  const stCellStyle: CSSProperties = {
                    background: "rgba(0,180,255,0.04)",
                    borderLeft: "1px solid rgba(0,180,255,0.1)",
                    borderRight: "1px solid rgba(0,180,255,0.1)"
                  };
                  if (isLast) {
                    stCellStyle.borderBottomLeftRadius = 8;
                    stCellStyle.borderBottomRightRadius = 8;
                  }
                  return (
                    <motion.tr
                      key={`${group.title}-${row.capability}`}
                      initial={{ opacity: 0, x: -12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: (gi * 4 + ri) * 0.05 }}
                      className="border-b border-white/[0.06] transition-colors duration-100 hover:bg-[rgba(255,255,255,0.01)]"
                    >
                      <td className="px-4 py-3 text-slate-200">{row.capability}</td>
                      <td className="px-4 py-3 text-center align-middle" style={stCellStyle}>
                        <ComparisonCellView cell={row.stocvest} />
                      </td>
                      <td className="px-4 py-3 text-center align-middle">
                        <ComparisonCellView cell={row.webull} />
                      </td>
                      <td className="px-4 py-3 text-center align-middle">
                        <ComparisonCellView cell={row.tradingview} />
                      </td>
                      <td className="px-4 py-3 text-center align-middle">
                        <ComparisonCellView cell={row.unusualWhales} />
                      </td>
                    </motion.tr>
                  );
                });
                return [categoryRow, ...dataRows];
              })}
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
              className="landing-glow-card p-6"
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
        <motion.article
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="landing-glow-card mx-auto max-w-3xl p-6"
        >
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
        <div className="landing-glow-card mx-auto max-w-md p-4 text-left">
          <p className="text-[#22c55e]">Day trades used: 0 of 3</p>
          <p>Status: Clear to trade</p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 md:px-8">
        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-8 text-center text-3xl font-bold md:text-4xl">
          Simple pricing. No hidden fees.
        </motion.h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {LANDING_PRICING_PLANS.map((plan) => {
            const isSelected = plan.tier === selectedPlanTier;
            const isPro = plan.tier === "Pro";
            return (
              <motion.article
                key={plan.tier}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                onClick={() => setSelectedPlanTier(plan.tier)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedPlanTier(plan.tier);
                  }
                }}
                className={`landing-glow-card relative flex flex-col p-6 cursor-pointer outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0e1a] ${
                  isSelected ? "ring-2 ring-[#3b82f6] ring-offset-2 ring-offset-[#0a0e1a] lg:scale-[1.03]" : "ring-0 ring-offset-0 lg:scale-100"
                }`}
              >
                {isPro ? (
                  <p className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold uppercase tracking-wide text-[#3b82f6]">
                    Most Popular
                  </p>
                ) : null}
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xl font-semibold">{plan.tier}</h3>
                  {isPro ? <span className="rounded-full bg-[#3b82f6] px-3 py-1 text-sm font-bold text-white">Popular</span> : null}
                </div>
                <p className={`mb-3 text-2xl font-bold ${isSelected ? "text-[#3b82f6]" : ""}`}>{plan.price}</p>
                <ul className="mb-4 space-y-1 text-slate-300">
                  {plan.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
                <Link
                  href="/login"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#3b82f6] px-4 py-2 text-sm font-semibold sm:w-auto"
                >
                  Get Started
                </Link>
              </motion.article>
            );
          })}
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
