import Link from "next/link";
import { Brain, Database, Eye, Layers3, MousePointerClick, TrendingUp } from "lucide-react";

const steps = [
  {
    title: "Step 1 — Real-Time Market Data",
    description:
      "Every signal starts with live data from Polygon.io — real-time prices, volume, NBBO quotes, and 1-minute bars. No delayed data. No estimates.",
    badge: "Powered by Polygon.io",
    icon: Database
  },
  {
    title: "Step 2 — Six Independent Signal Layers",
    description:
      "Six separate analytical engines run simultaneously — Technical indicators, News sentiment, Macro conditions, Sector rotation, Geopolitical risk, and Market internals. Each layer forms an independent view.",
    icon: Layers3
  },
  {
    title: "Step 3 — AI Synthesis",
    description:
      "Claude AI (by Anthropic) reads all six layers and synthesizes them into a single plain-English signal summary. It highlights conflicts, weighs evidence, and explains how the layers align — as structured narrative, not a directive.",
    badge: "Powered by Anthropic Claude",
    icon: Brain
  },
  {
    title: "Step 4 — Full Reasoning Transparency",
    description:
      "Every signal comes with a complete breakdown. You see exactly which data points drove the readout, which layers agree, which conflict, and what the risk factors are. No black boxes.",
    icon: Eye
  },
  {
    title: "Step 5 — You Decide",
    description:
      "STOCVEST never auto-executes trades. Every order requires your explicit confirmation. You see the reasoning, you evaluate it, you decide. We provide intelligence — you provide judgment.",
    icon: MousePointerClick
  },
  {
    title: "Step 6 — Continuous Learning",
    description:
      "Every signal is tracked against real market outcomes. Over time the system learns which signal combinations predict moves most accurately and continuously improves. Your results make the platform better for everyone.",
    icon: TrendingUp
  }
];

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0a0e1a] px-4 py-14 text-slate-100 md:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-sm text-[#3b82f6] hover:underline">
          ← Back to home
        </Link>
        <h1 className="mt-5 text-4xl font-black md:text-6xl">How STOCVEST Works</h1>
        <p className="mt-3 max-w-3xl text-slate-300 md:text-xl">
          Institutional-grade intelligence built on transparent, verifiable methodology
        </p>

        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          {steps.map((step) => (
            <article key={step.title} className="rounded-xl border border-white/10 bg-white/5 p-6">
              <step.icon className="mb-3 h-8 w-8 text-[#3b82f6]" />
              <h2 className="text-xl font-bold">{step.title}</h2>
              <p className="mt-2 text-slate-300">{step.description}</p>
              {step.badge ? <p className="mt-4 inline-block rounded-full border border-white/20 px-3 py-1 text-xs text-slate-300">{step.badge}</p> : null}
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-2 text-xs text-slate-300">
          {["Powered by Polygon.io", "AI by Anthropic Claude", "Infrastructure on AWS", "STOCVEST LLC — Delaware registered"].map((item) => (
            <span key={item} className="rounded-full border border-white/20 bg-white/5 px-3 py-1">
              {item}
            </span>
          ))}
        </div>

        <p className="mt-5 max-w-4xl text-sm text-slate-400">
          STOCVEST is a signal intelligence platform, not a registered investment advisor. Signals are research tools to inform your trading decisions. You are solely responsible for all trading
          activity in your accounts.
        </p>

        <Link
          href="/signup"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-md bg-[#3b82f6] px-6 py-3 font-semibold text-white"
        >
          Get Started
        </Link>
      </div>
    </main>
  );
}
