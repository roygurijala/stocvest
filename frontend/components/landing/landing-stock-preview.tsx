"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { LandingDemoVerdict } from "@/lib/landing/demo-verdicts";

const MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

type Props = {
  verdict: LandingDemoVerdict;
  onClose: () => void;
};

function biasColor(bias: LandingDemoVerdict["bias"]): string {
  if (bias === "Bullish") return "text-emerald-400";
  if (bias === "Bearish") return "text-rose-400";
  return "text-slate-300";
}

export function LandingStockPreview({ verdict, onClose }: Props) {
  return (
    <div
      data-testid="landing-stock-preview"
      className="landing-glow-card relative w-full max-w-xl p-5 text-left transition-opacity duration-300"
    >
      <button
        type="button"
        aria-label="Close preview"
        data-testid="landing-stock-preview-close"
        className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
        onClick={onClose}
      >
        <X className="h-5 w-5" aria-hidden />
      </button>

      <p className="pr-8 text-xs uppercase tracking-[0.2em] text-cyan-300/90" style={{ fontFamily: MONO }}>
        Sample system read — live data unlocks after signup
      </p>
      <h3 className="mt-2 text-xl font-bold text-slate-50">
        {verdict.symbol} — current read
      </h3>

      {verdict.limitedPreview ? (
        <div
          className="mt-4 rounded-lg border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-slate-200"
          data-testid="landing-limited-preview"
        >
          <p className="font-semibold text-amber-200">This is a limited preview</p>
          <p className="mt-2 leading-relaxed">
            STOCVEST evaluates 6 layers in real-time.
            <br />
            Full analysis, alignment, and trade levels unlock after signup.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-300">{verdict.headline}</p>

          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
              <dt className="text-slate-400">Bias</dt>
              <dd className={`font-semibold ${biasColor(verdict.bias)}`}>{verdict.bias}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
              <dt className="text-slate-400">Alignment</dt>
              <dd className="font-semibold text-slate-100">
                {verdict.alignmentLabel} ({verdict.alignedLayers}/{verdict.totalLayers})
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
              <dt className="text-slate-400">Execution</dt>
              <dd
                className={`font-semibold ${verdict.actionable ? "text-emerald-400" : "text-amber-300"}`}
              >
                {verdict.execution}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Why {verdict.actionable ? "this matters" : "not yet"}?
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-200">
            {verdict.whyNot.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-cyan-400">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p
        className="mt-4 border-t border-white/10 pt-4 text-center text-sm leading-relaxed text-slate-300"
        data-testid="landing-preview-filter-footer"
      >
        This is exactly how the system filters trades — even when nothing is actionable.
      </p>

      <Link
        href="/signup/agreements"
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#3b82f6] px-4 py-2.5 text-sm font-semibold text-white"
      >
        Get the live verdict — free
      </Link>
    </div>
  );
}
