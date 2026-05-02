"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bot, ChartColumnIncreasing, Newspaper, ShieldCheck } from "lucide-react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { useScrollPosition } from "@/lib/hooks/use-scroll-position";
import { fetchLiveSignals, fetchPerformanceSummary, type PublicSignal, type PublicSignalOutcome, type PerformanceSummary } from "@/lib/api/public-signals";

const radarData = [
  { layer: "Technical", score: 84 },
  { layer: "News Sentiment", score: 78 },
  { layer: "Macro", score: 58 },
  { layer: "Sector", score: 73 },
  { layer: "Geopolitical", score: 49 },
  { layer: "Internals", score: 86 }
];

const comparisonRows = [
  "AI Signal Synthesis",
  "Multi-Broker Execution",
  "Signal Reasoning Transparency",
  "Pre-Market Intelligence Briefing",
  "PDT Guardian",
  "Day and Swing Trading Combined"
];

const outcomeText: Record<PublicSignalOutcome, string> = {
  pending: "⏳ Pending",
  win: "✅ Win",
  loss: "❌ Loss",
  neutral: "➖ Neutral"
};

const demoTickerSignals: PublicSignal[] = [
  { symbol: "AAPL", direction: "long", signal_strength: 65, timestamp_iso: "just-now", outcome: "pending" },
  { symbol: "TSLA", direction: "short", signal_strength: 71, timestamp_iso: "2m-ago", outcome: "pending" },
  { symbol: "NVDA", direction: "long", signal_strength: 78, timestamp_iso: "5m-ago", outcome: "pending" },
  { symbol: "SPY", direction: "neutral", signal_strength: 52, timestamp_iso: "8m-ago", outcome: "pending" },
  { symbol: "MSFT", direction: "long", signal_strength: 68, timestamp_iso: "12m-ago", outcome: "pending" }
];

function timeAgo(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "just now";
  const deltaSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

export function LandingPage() {
  const isScrolled = useScrollPosition(24);
  const [signals, setSignals] = useState<PublicSignal[]>([]);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [recent, perf] = await Promise.all([fetchLiveSignals(), fetchPerformanceSummary()]);
      if (!active) return;
      setSignals(recent);
      setSummary(perf);
    };
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const tickerSignals = useMemo(() => {
    if (signals.length === 0) {
      return [...demoTickerSignals, ...demoTickerSignals];
    }
    return [...signals, ...signals];
  }, [signals]);

  const winRateTone =
    (summary?.directional_accuracy_percent ?? 0) > 60
      ? "text-[#22c55e]"
      : (summary?.directional_accuracy_percent ?? 0) >= 50
        ? "text-[#f59e0b]"
        : "text-[#ef4444]";

  return (
    <main className="bg-[#0a0e1a] text-slate-100">
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
          isScrolled ? "border-b border-white/10 bg-[#0a0e1a]/95 backdrop-blur" : "bg-transparent"
        }`}
      >
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-4 md:px-8">
          <p className="text-lg font-extrabold tracking-tight text-[#3b82f6] sm:text-xl">STOCVEST</p>
          <div className="hidden items-center gap-5 text-sm text-slate-300 md:flex">
            <Link href="/how-it-works" className="hover:text-white">
              How It Works
            </Link>
            <Link href="/performance" className="hover:text-white">
              Performance
            </Link>
          </div>
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

      <section id="live-signals" className="mx-auto max-w-7xl px-4 pb-8 md:px-8">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="mb-1 text-xs text-slate-400">Example signals shown — live signals appear as they are generated</p>
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-300">
            <span>Live Signals — Updated in real time</span>
          </div>
          <div className="ticker-mask overflow-hidden rounded-lg border border-white/10 bg-black/20">
            <div className="ticker-track flex gap-2 px-2 py-2">
              {tickerSignals.map((signal, idx) => {
                const dir =
                  signal.direction === "long"
                    ? "bg-[#22c55e]/15 text-[#22c55e]"
                    : signal.direction === "short"
                      ? "bg-[#ef4444]/15 text-[#ef4444]"
                      : "bg-slate-500/20 text-slate-300";
                const isPlaceholder = signals.length === 0;
                return (
                  <div
                    key={`${signal.symbol}-${idx}`}
                    className={`inline-flex min-w-[250px] items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm ${isPlaceholder ? "animate-pulse opacity-90" : ""}`}
                  >
                    <span className="font-semibold">{signal.symbol}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${dir}`}>{signal.direction}</span>
                    <span className="text-slate-300">{`${Math.round(signal.signal_strength)}%`}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      {isPlaceholder
                        ? signal.timestamp_iso === "just-now"
                          ? "Just now"
                          : signal.timestamp_iso.replace("-", " ")
                        : timeAgo(signal.timestamp_iso)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 md:px-8">
        <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <h2 className="text-3xl font-bold md:text-4xl">Every signal. Tracked and published.</h2>
          <p className="mt-2 text-slate-300">We show our winners and our losses. No cherry-picking.</p>
        </motion.div>
        {signals.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-6 text-slate-300">
            Signal history tracking begins at launch. Our first signals are being generated now. Check back soon.
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[780px] bg-white/5 text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-slate-300">
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Signal Strength</th>
                  <th className="px-4 py-3">Date and Time</th>
                  <th className="px-4 py-3">Outcome</th>
                </tr>
              </thead>
              <motion.tbody
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
              >
                {signals.map((row) => (
                  <motion.tr
                    key={`${row.symbol}-${row.timestamp_iso}`}
                    variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
                    className="border-b border-white/10"
                  >
                    <td className="px-4 py-3 font-semibold">{row.symbol}</td>
                    <td className="px-4 py-3 capitalize text-slate-300">{row.direction}</td>
                    <td className="px-4 py-3">{Math.round(row.signal_strength)}%</td>
                    <td className="px-4 py-3 text-slate-300">{new Date(row.timestamp_iso).toLocaleString()}</td>
                    <td className="px-4 py-3">{outcomeText[row.outcome]}</td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </table>
          </div>
        )}
        {signals.length > 0 ? (
          <>
            <p className={`mt-4 text-sm font-semibold ${winRateTone}`}>
              {summary?.win_count ?? 0} directionally correct out of {summary?.signals_evaluated ?? 0} evaluated signals ={" "}
              {(summary?.directional_accuracy_percent ?? 0).toFixed(1)}% directional accuracy
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Based on {summary?.total_signals_tracked ?? 0} signals since {summary?.launch_date ?? new Date().toISOString().slice(0, 10)}. Small sample size — accuracy improves as
              our history grows. Past performance does not guarantee future results.
            </p>
          </>
        ) : null}
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
        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-10 text-center text-3xl font-bold md:text-4xl">
          Six layers of intelligence. One synthesized signal readout.
        </motion.h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <motion.article
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="order-1 rounded-xl border border-white/10 bg-transparent p-4 lg:order-none md:p-6"
          >
            <div className="mx-auto h-56 max-w-full sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#1e3a5f" />
                  <PolarAngleAxis dataKey="layer" tick={{ fill: "#ffffff", fontSize: 12 }} />
                  <Radar dataKey="score" stroke="rgba(59,130,246,0.8)" fill="rgba(59,130,246,0.2)" fillOpacity={1} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
              className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300"
            >
              {radarData.map((d) => (
                <motion.span key={d.layer} variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }} className="rounded-full border border-white/20 px-2 py-1">
                  {d.layer}
                </motion.span>
              ))}
            </motion.div>
          </motion.article>
          <motion.article
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="order-2 rounded-xl border border-white/10 bg-white/5 p-6 lg:order-none"
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xl font-bold">AAPL</span>
              <span className="rounded-full bg-[#22c55e]/20 px-2 py-1 text-xs font-semibold text-[#22c55e]">Bullish</span>
              <span className="text-sm text-slate-300">82% signal strength</span>
            </div>
            <div className="mb-4">
              <div className="h-2 w-full rounded-full bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: "82%" }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.1 }}
                  className="h-2 rounded-full bg-[#3b82f6]"
                />
              </div>
            </div>
            <p className="italic text-slate-300">
              Strong technical pattern with supportive catalyst data. Macro uncertainty is the primary risk factor in the signal layers.
            </p>
          </motion.article>
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
      <style jsx>{`
        .ticker-mask {
          position: relative;
        }
        .ticker-track {
          width: max-content;
          animation: stocvestTicker 28s linear infinite;
        }
        @keyframes stocvestTicker {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </main>
  );
}
