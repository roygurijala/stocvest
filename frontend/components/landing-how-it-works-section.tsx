"use client";

import { motion } from "framer-motion";

const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace";

const STEPS = [
  { title: "Live Data", desc: "Real-time prices, volume, and NBBO from Polygon.io" },
  { title: "6 Layers", desc: "Technical, News, Macro, Sector, Geopolitical, Internals" },
  { title: "AI Synthesis", desc: "Claude reads all layers and explains its reasoning" },
  { title: "Confluence", desc: "Detects when multiple signals align simultaneously" },
  { title: "You Decide", desc: "Full reasoning shown. You make the final call." }
] as const;

function StepCircle() {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: 56,
        height: 56,
        border: "1px solid rgba(0,180,255,0.25)",
        background: "rgba(0,180,255,0.08)"
      }}
    />
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />;
}

export function LandingHowItWorksSection() {
  return (
    <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-20 md:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p
          className="mb-3 uppercase"
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 4,
            color: "#00d4ff"
          }}
        >
          The engine
        </p>
        <h2
          className="font-extrabold tracking-tight"
          style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 800,
            color: "#e8f4ff",
            letterSpacing: -1
          }}
        >
          Six layers. One clear signal.
        </h2>
        <p className="mx-auto mt-3 max-w-[420px] text-center text-sm text-slate-400">
          Every signal runs through six independent analytical engines simultaneously
        </p>
      </div>

      {/* Desktop: five columns + connectors */}
      <div className="mx-auto mt-14 hidden max-w-6xl md:flex md:items-start">
        {STEPS.map((step, i) => (
          <div key={step.title} className="flex min-w-0 flex-1 items-start">
            {i > 0 ? (
              <div
                className="mt-7 h-px min-w-[6px] flex-1"
                style={{
                  background: "linear-gradient(90deg, rgba(0,180,255,0.4), rgba(0,180,255,0.1))"
                }}
                aria-hidden
              />
            ) : null}
            <div className="flex w-full min-w-0 flex-col items-center px-1 text-center">
              <StepCircle />
              <p
                className="mt-3 uppercase"
                style={{
                  fontSize: 11,
                  letterSpacing: 1.5,
                  color: "#00d4ff",
                  fontFamily: MONO
                }}
              >
                {step.title}
              </p>
              <p className="mt-1 max-w-[150px] text-center text-xs leading-snug text-slate-500">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: vertical stack + left accent */}
      <div className="mx-auto mt-10 flex max-w-md flex-col gap-6 md:hidden">
        {STEPS.map((step, i) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.06 }}
            className="flex gap-4 border-l border-[rgba(0,180,255,0.25)] pl-4"
          >
            <StepCircle />
            <div>
              <p
                className="uppercase"
                style={{
                  fontSize: 11,
                  letterSpacing: 1.5,
                  color: "#00d4ff",
                  fontFamily: MONO
                }}
              >
                {step.title}
              </p>
              <p className="mt-1 text-xs leading-snug text-slate-500">{step.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Signal preview card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="mx-auto mt-12 w-full max-w-[560px]"
        style={{
          background: "#0c1828",
          border: "1px solid rgba(0,180,255,0.12)",
          borderRadius: 12,
          padding: "20px 24px"
        }}
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div>
            <p className="mb-3 uppercase text-slate-500" style={{ fontSize: 9, fontFamily: MONO, letterSpacing: 1 }}>
              Technical
            </p>
            <ul className="space-y-2 text-xs text-slate-300" style={{ fontFamily: MONO }}>
              <li className="flex items-center gap-2">
                <Dot color="#00e87a" /> ORB breakout
              </li>
              <li className="flex items-center gap-2">
                <Dot color="#00e87a" /> Above VWAP
              </li>
              <li className="flex items-center gap-2">
                <Dot color="#00e87a" /> 9 EMA bounce
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-3 uppercase text-slate-500" style={{ fontSize: 9, fontFamily: MONO, letterSpacing: 1 }}>
              Macro · Sector
            </p>
            <ul className="space-y-2 text-xs text-slate-300" style={{ fontFamily: MONO }}>
              <li className="flex items-center gap-2">
                <Dot color="#00e87a" /> Bullish regime
              </li>
              <li className="flex items-center gap-2">
                <Dot color="#00e87a" /> Tech leading
              </li>
              <li className="flex items-center gap-2">
                <Dot color="#f59e0b" /> Fed tomorrow
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-3 uppercase text-slate-500" style={{ fontSize: 9, fontFamily: MONO, letterSpacing: 1 }}>
              News · Internals
            </p>
            <ul className="space-y-2 text-xs text-slate-300" style={{ fontFamily: MONO }}>
              <li className="flex items-center gap-2">
                <Dot color="#00e87a" /> Earnings beat
              </li>
              <li className="flex items-center gap-2">
                <Dot color="#00e87a" /> Breadth positive
              </li>
              <li className="flex items-center gap-2">
                <Dot color="#00e87a" /> VIX declining
              </li>
            </ul>
          </div>
        </div>
        <div
          className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-md text-xs italic text-slate-500">
            Strong technical setup. Macro uncertainty is the primary risk.
          </p>
          <span
            className="shrink-0 self-start font-medium uppercase sm:self-center"
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: 2,
              color: "#00e87a",
              background: "rgba(0,232,122,0.1)",
              border: "1px solid rgba(0,232,122,0.25)",
              padding: "6px 12px",
              borderRadius: 6
            }}
          >
            Bullish · 82
          </span>
        </div>
      </motion.div>
    </section>
  );
}
