"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { StocvestLogo } from "@/components/brand/stocvest-logo";
import { LandingStockPreview } from "@/components/landing/landing-stock-preview";
import {
  genericLandingDemoVerdict,
  normalizeLandingTicker,
  resolveLandingDemoVerdict
} from "@/lib/landing/demo-verdicts";

const QUICK_PICKS = ["NFLX", "AAPL", "NVDA"] as const;

type TickerHit = { symbol: string; name: string };

export function LandingHeroSearch() {
  const [query, setQuery] = useState("");
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TickerHit[]>([]);

  const normalized = useMemo(() => normalizeLandingTicker(query), [query]);

  const verdict = useMemo(() => {
    if (!activeSymbol) return null;
    return resolveLandingDemoVerdict(activeSymbol) ?? genericLandingDemoVerdict(activeSymbol);
  }, [activeSymbol]);

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
    if (!value.trim()) {
      setActiveSymbol(null);
      setSuggestions([]);
    }
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
    <section className="mx-auto flex min-h-[88vh] max-w-7xl flex-col items-center px-4 pb-12 pt-24 text-center md:px-8 md:pt-28">
      <StocvestLogo variant="hero" href="/" priority className="mb-6 md:mb-8" />
      <p className="mb-3 max-w-2xl text-base font-medium text-amber-200/95 md:text-lg">
        Stop wasting trades that shouldn&apos;t be taken.
      </p>
      <h1 className="max-w-4xl text-3xl font-black leading-tight md:text-5xl lg:text-6xl">
        We tell you when to trade — and when to stay out.
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-300 md:text-xl">
        Most platforms give you signals. STOCVEST tells you if the trade is worth taking at all.
      </p>

      <div className="relative mt-8 w-full max-w-xl">
        <label htmlFor="landing-stock-search" className="sr-only">
          Type any stock to preview the system
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-black/40 px-3 py-2 shadow-[0_0_32px_rgba(59,130,246,0.15)]">
          <Search className="h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
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

      <p className="mt-4 text-sm text-slate-400">Try full examples:</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {QUICK_PICKS.map((sym) => (
          <button
            key={sym}
            type="button"
            className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-1.5 text-sm font-semibold text-cyan-100 hover:border-cyan-400/70"
            onClick={() => applySymbol(sym)}
          >
            {sym}
          </button>
        ))}
      </div>

      {verdict ? (
        <div className="mt-8 flex w-full justify-center">
          <LandingStockPreview verdict={verdict} onClose={dismissPreview} />
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/signup/agreements" className="rounded-md bg-[#3b82f6] px-6 py-3 font-semibold">
          Start Free — No Card Required
        </Link>
        <a href="#how-it-works" className="rounded-md border border-white/30 px-6 py-3 font-semibold">
          See your first 5 minutes
        </a>
      </div>
    </section>
  );
}
