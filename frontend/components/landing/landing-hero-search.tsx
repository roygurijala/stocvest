"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { LandingStockPreview } from "@/components/landing/landing-stock-preview";
import {
  genericLandingDemoVerdict,
  normalizeLandingTicker,
  resolveLandingDemoVerdict
} from "@/lib/landing/demo-verdicts";

const QUICK_PICKS = ["NFLX", "AAPL", "NVDA"] as const;

const CORE_PHILOSOPHY = ["Judgment", "Restraint", "Gating", "Permission"] as const;

type TickerHit = { symbol: string; name: string };

export function LandingHeroSearch() {
  const [query, setQuery] = useState("");
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TickerHit[]>([]);

  const normalized = useMemo(() => normalizeLandingTicker(query), [query]);

  const verdict = useMemo(() => {
    if (!activeSymbol) return null;
    const q = normalizeLandingTicker(query);
    if (!q || q !== activeSymbol) return null;
    return resolveLandingDemoVerdict(activeSymbol) ?? genericLandingDemoVerdict(activeSymbol);
  }, [activeSymbol, query]);

  const dismissPreview = useCallback(() => {
    setActiveSymbol(null);
    setQuery("");
    setSuggestions([]);
  }, []);

  const applySymbol = useCallback((sym: string) => {
    const t = normalizeLandingTicker(sym);
    if (!t) return;
    setQuery(t);
    setActiveSymbol(t);
    setSuggestions([]);
  }, []);

  const onQueryChange = useCallback((value: string) => {
    setQuery(value);
    const t = normalizeLandingTicker(value);
    if (!value.trim()) {
      setActiveSymbol(null);
      setSuggestions([]);
      return;
    }
    setActiveSymbol((prev) => (prev && t !== prev ? null : prev));
  }, []);

  useEffect(() => {
    if (!normalized) {
      setActiveSymbol(null);
      return;
    }
    if (resolveLandingDemoVerdict(normalized)) {
      setActiveSymbol(normalized);
    }
  }, [normalized]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      void fetch(`/api/public/tickers-search?q=${encodeURIComponent(q)}`, {
        signal: ctrl.signal,
        cache: "no-store"
      })
        .then((r) => r.json())
        .then((json: { items?: TickerHit[] }) => {
          setSuggestions(Array.isArray(json.items) ? json.items.slice(0, 8) : []);
        })
        .catch(() => setSuggestions([]));
    }, 280);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  return (
    <section
      className="mx-auto flex min-h-[72vh] max-w-7xl flex-col items-center px-4 pb-10 pt-24 text-center md:px-8 md:pt-28"
      data-testid="landing-hero"
    >
      <p
        className="mb-5 text-[11px] font-semibold uppercase tracking-[0.28em] md:text-xs"
        data-testid="landing-hero-motto"
      >
        {CORE_PHILOSOPHY.map((word, index) => (
          <span key={word}>
            {index > 0 ? (
              <span className="mx-2 font-normal text-slate-600/90" aria-hidden>
                ·
              </span>
            ) : null}
            <span className="bg-gradient-to-r from-cyan-200/95 via-cyan-300/90 to-blue-400/85 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(34,211,238,0.22)]">
              {word}
            </span>
          </span>
        ))}
      </p>

      <h1
        className="max-w-3xl text-[1.75rem] font-bold leading-snug tracking-tight text-slate-50 md:text-4xl md:leading-tight lg:text-[2.75rem]"
        data-testid="landing-hero-headline"
      >
        We tell you when to trade—
        <br className="hidden sm:inline" />
        <span className="sm:ml-0"> and when to stay out.</span>
      </h1>

      <p
        className="mx-auto mb-6 mt-3 max-w-[560px] text-sm leading-relaxed text-slate-400 md:text-base"
        data-testid="landing-hero-subtext"
      >
        Most platforms give you signals. STOCVEST tells you if the trade is worth taking at all.
      </p>

      <div className="relative mb-4 mt-1 w-full max-w-xl">
        <label htmlFor="landing-stock-search" className="sr-only">
          Type any stock to preview the system
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-black/40 px-3 py-3 shadow-[0_0_32px_rgba(59,130,246,0.18)]">
          <Search className="h-5 w-5 shrink-0 text-cyan-400/90" aria-hidden />
          <input
            id="landing-stock-search"
            data-testid="landing-stock-search"
            type="search"
            autoComplete="off"
            placeholder="Type any stock to preview the system"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && normalized) applySymbol(normalized);
              if (e.key === "Escape") dismissPreview();
            }}
            className="min-w-0 flex-1 bg-transparent text-base text-slate-100 outline-none placeholder:text-slate-500"
          />
        </div>
        {suggestions.length > 0 ? (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-white/15 bg-[#0c1222] py-1 text-left shadow-xl"
          >
            {suggestions.map((hit) => (
              <li key={hit.symbol}>
                <button
                  type="button"
                  role="option"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
                  onClick={() => applySymbol(hit.symbol)}
                >
                  <span className="font-semibold">{hit.symbol}</span>
                  <span className="truncate text-xs text-slate-500">{hit.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div
        className="mb-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm text-slate-500"
        data-testid="landing-hero-examples"
      >
        <span className="text-xs text-slate-500/80">Try:</span>
        {QUICK_PICKS.map((sym, index) => (
          <span key={sym} className="inline-flex items-center gap-2">
            {index > 0 ? <span className="text-slate-600" aria-hidden>/</span> : null}
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-400 opacity-70 transition hover:text-slate-200 hover:opacity-100"
              onClick={() => applySymbol(sym)}
            >
              {sym}
            </button>
          </span>
        ))}
      </div>

      {verdict ? (
        <div className="mb-6 flex w-full justify-center">
          <LandingStockPreview verdict={verdict} onClose={dismissPreview} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-col items-center gap-3" data-testid="landing-hero-cta">
        <Link
          href="/signup/agreements"
          className="rounded-md bg-[#3b82f6] px-7 py-3.5 text-base font-semibold text-white shadow-[0_0_24px_rgba(59,130,246,0.35)] transition hover:bg-[#2563eb]"
        >
          Start Free — No Card Required
        </Link>
        <a href="#see-it-work" className="text-sm text-slate-500 transition hover:text-slate-300">
          See the engine live ↓
        </a>
      </div>
    </section>
  );
}
