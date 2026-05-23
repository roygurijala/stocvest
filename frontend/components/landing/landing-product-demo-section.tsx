"use client";

import { useState } from "react";
import { LandingAssistantDemo } from "@/components/landing/landing-assistant-demo";
import { LandingEngineCard, type LandingEngineMode } from "@/components/landing/landing-engine-card";

const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function LandingProductDemoSection() {
  const [engineTab, setEngineTab] = useState<LandingEngineMode>("swing");

  return (
    <section id="see-it-work" className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-20" data-testid="landing-product-demo">
      <p className="mb-2 text-center text-xs uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: MONO }}>
        SEE IT WORK
      </p>
      <h2 className="text-center text-2xl font-bold md:text-4xl">Six layers. One verdict. Reasoning when you ask.</h2>
      <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-slate-400 md:text-base">
        Live-style examples — no essay required.
      </p>
      <div
        className="mt-10 grid gap-x-6 gap-y-4 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:items-stretch"
        data-testid="landing-product-demo-grid"
      >
        <div className="flex h-10 items-center gap-2">
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
        <div className="hidden h-10 lg:block" aria-hidden />
        <LandingEngineCard mode={engineTab} />
        <LandingAssistantDemo />
      </div>
    </section>
  );
}
