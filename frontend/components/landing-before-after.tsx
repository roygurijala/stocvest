"use client";

import { motion } from "framer-motion";

const ROWS = [
  {
    time: "8:00 AM",
    without: "Open 4 browser tabs, check futures manually across sites",
    with: "Morning brief delivered — conditions, events, top watch, PDT status"
  },
  {
    time: "8:30 AM",
    without: "Scan news sites, try to find what's moving pre-market",
    with: "Gap Intelligence shows quality gaps with matched catalysts and quality score"
  },
  {
    time: "9:30 AM",
    without: "Guess which ORB setups look promising. Act on instinct.",
    with: "Ranked intraday setups with signal strength, confluence alerts, expiry"
  },
  {
    time: "After close",
    without: "No record of why trades worked or didn't. Start over tomorrow.",
    with: "Signal replay shows every call — correct and incorrect. Engine improves."
  }
] as const;

export function LandingBeforeAfterSection() {
  return (
    <section className="border-b border-[rgba(0,180,255,0.06)] px-5 py-12 md:px-10 md:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-[#00b4ff]/80">
          THE DIFFERENCE
        </p>
        <h2 className="mb-3 text-center text-2xl font-bold text-slate-50 md:text-3xl">Your 9 AM. Before and after.</h2>
        <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-slate-400 md:text-base">
          Every serious trader does the same research every morning. STOCVEST does it for you.
        </p>

        <div className="mb-2 hidden grid-cols-[1fr_auto_1fr] items-end gap-3 text-[10px] font-semibold uppercase tracking-[2px] md:grid">
          <p className="text-[#4a6080]">Without STOCVEST</p>
          <span className="pb-1 text-center text-slate-500">vs</span>
          <p className="text-right text-[#00d4ff]">With STOCVEST</p>
        </div>

        <div className="space-y-2 md:space-y-2">
          {ROWS.map((row, i) => (
            <motion.article
              key={row.time}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="space-y-2 md:space-y-0"
            >
              <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-stretch md:gap-3">
                <div
                  className="rounded-lg border px-4 py-3.5 md:rounded-lg"
                  style={{
                    background: "rgba(255,61,90,0.03)",
                    borderColor: "rgba(255,61,90,0.08)"
                  }}
                >
                  <span className="mb-1 block font-mono text-[10px] font-semibold text-[#ff3d5a]/70">{row.time}</span>
                  <p className="text-xs leading-relaxed text-[#4a6080] md:text-[12px] md:leading-[1.6]">{row.without}</p>
                </div>

                <div className="flex items-center justify-center md:flex-col md:py-1">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400 md:hidden">
                    vs
                  </span>
                  <span className="hidden text-xs text-slate-500 md:inline">vs</span>
                </div>

                <div
                  className="rounded-lg border px-4 py-3.5"
                  style={{
                    background: "rgba(0,180,255,0.03)",
                    borderColor: "rgba(0,180,255,0.1)"
                  }}
                >
                  <span className="mb-1 block font-mono text-[10px] font-semibold text-[#00d4ff]">{row.time}</span>
                  <p className="text-xs leading-relaxed text-[#c8dff0] md:text-[12px] md:leading-[1.6]">{row.with}</p>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
