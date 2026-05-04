"use client";

import { motion } from "framer-motion";

const ROWS = [
  {
    time: "8:00 AM",
    without: "Open 4 browser tabs, check futures manually across sites",
    with: "Structured morning brief — conditions, calendar context, top watch, PDT snapshot (dashboard)"
  },
  {
    time: "8:30 AM",
    without: "Scan news sites, try to find what's moving pre-market",
    with: "Gap Intelligence scan: ranked gaps, catalyst tagging, quality score (scanner + dashboard)"
  },
  {
    time: "9:30 AM",
    without: "Guess which ORB setups look promising. Act on instinct.",
    with: "Ranked intraday setups with signal strength, confluence when applicable, ORB expiry rules (scanner)"
  },
  {
    time: "After close",
    without: "No record of why trades worked or didn't. Start over tomorrow.",
    with: "Published signal outcomes (1h/1d) plus trade journal from linked brokers — fills logged, analytics summarize P&L"
  }
] as const;

export function LandingBeforeAfterSection() {
  return (
    <section className="border-b border-[rgba(0,180,255,0.06)] px-5 py-12 md:px-10 md:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-[#00b4ff]/80">
          THE DIFFERENCE
        </p>
        <h2 className="mb-3 text-center text-2xl font-extrabold tracking-tight text-slate-50 md:text-4xl">
          The bell rings at 9:30. Your prep shouldn&apos;t start then.
        </h2>
        <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-slate-400 md:text-base">
          Same morning workflow most traders repeat — with STOCVEST doing the structured scan, brief, and logging.
        </p>

        <div
          className="mb-2 grid min-w-0 grid-cols-[1fr_auto_1fr] items-end gap-2 text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] sm:gap-3 sm:text-[11px] sm:tracking-[0.12em] md:text-xs"
          style={{ marginTop: 0, marginBottom: 8 }}
        >
          <p className="min-w-0 break-words text-[#ff6b7d]/90">WITHOUT STOCVEST</p>
          <span className="shrink-0 pb-1 text-center text-sm font-bold text-slate-300 md:text-base" aria-hidden>
            vs
          </span>
          <p className="min-w-0 break-words text-right text-[#00d4ff]">WITH STOCVEST</p>
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
                <div className="landing-before-without px-4 py-4 md:px-5 md:py-4">
                  <span className="mb-1.5 block font-mono text-[11px] font-bold text-[#ff8a9a]">{row.time}</span>
                  <p className="text-[13px] font-medium leading-relaxed text-slate-300 md:text-sm md:leading-relaxed">
                    {row.without}
                  </p>
                </div>

                <div className="flex min-h-[2.5rem] items-center justify-center md:min-h-0 md:flex-col md:py-1">
                  <span className="rounded-full border border-white/15 bg-white/[0.07] px-2.5 py-1 text-xs font-bold text-slate-200 md:hidden">
                    vs
                  </span>
                  <span className="hidden text-sm font-bold text-slate-300 md:inline">vs</span>
                </div>

                <div className="landing-before-with px-4 py-4 md:px-5 md:py-4">
                  <span className="mb-1.5 block font-mono text-[11px] font-bold text-[#5ce1ff]">{row.time}</span>
                  <p className="text-[13px] font-medium leading-relaxed text-slate-100 md:text-sm md:leading-relaxed">
                    {row.with}
                  </p>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
