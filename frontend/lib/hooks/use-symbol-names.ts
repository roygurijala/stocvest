"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Shared client-side resolver for ticker → company name.
 *
 * Company names are decorative, so this is best-effort: results are cached for
 * the session, lookups coalesce across components, and any failure simply leaves
 * the symbol without a name (callers fall back to the bare ticker).
 */

const NAME_CACHE = new Map<string, string>(); // symbol -> resolved company name
const RESOLVED = new Set<string>(); // symbols already looked up (resolved or empty)
const INFLIGHT = new Map<string, Promise<void>>();

const MAX_PER_REQUEST = 60;

function normalize(sym: string): string {
  return sym.trim().toUpperCase();
}

function looksLikeTicker(sym: string): boolean {
  const core = sym.replace(/\./g, "");
  return sym.length >= 1 && sym.length <= 12 && /^[A-Z]+$/.test(core);
}

async function fetchChunk(chunk: string[]): Promise<void> {
  try {
    const res = await fetch(
      `/api/stocvest/market/symbol-names?symbols=${encodeURIComponent(chunk.join(","))}`,
      { cache: "no-store" }
    );
    const data = (await res.json().catch(() => ({}))) as {
      names?: Record<string, string>;
      degraded?: boolean;
    };
    if (data.degraded) return;
    const names = data.names ?? {};
    for (const sym of chunk) {
      RESOLVED.add(sym);
      const nm = names[sym];
      if (nm && typeof nm === "string") NAME_CACHE.set(sym, nm);
    }
  } catch {
    // Transient failure — leave unresolved so a later mount can retry.
  }
}

async function ensureNames(symbols: string[]): Promise<void> {
  const need = symbols.filter((s) => !RESOLVED.has(s) && !INFLIGHT.has(s) && looksLikeTicker(s));
  const promises: Promise<void>[] = [];

  for (let i = 0; i < need.length; i += MAX_PER_REQUEST) {
    const chunk = need.slice(i, i + MAX_PER_REQUEST);
    const p = fetchChunk(chunk).finally(() => {
      for (const sym of chunk) INFLIGHT.delete(sym);
    });
    for (const sym of chunk) INFLIGHT.set(sym, p);
    promises.push(p);
  }

  // Also wait on any in-flight lookups for symbols we requested but didn't start.
  for (const sym of symbols) {
    const pending = INFLIGHT.get(sym);
    if (pending && !promises.includes(pending)) promises.push(pending);
  }

  await Promise.all(promises);
}

/**
 * Resolve company names for the given tickers. Returns a `{ SYMBOL: name }` map
 * containing only symbols whose name is known. Re-renders as names arrive.
 */
export function useSymbolNames(input: string[] | string | undefined | null): Record<string, string> {
  const symbols = useMemo(() => {
    const arr = Array.isArray(input) ? input : input ? [input] : [];
    return Array.from(new Set(arr.map(normalize).filter(Boolean)));
  }, [Array.isArray(input) ? input.join(",") : (input ?? "")]);

  const key = symbols.join(",");
  const [, setTick] = useState(0);

  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    void ensureNames(symbols).then(() => {
      if (!cancelled) setTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const out: Record<string, string> = {};
  for (const sym of symbols) {
    const nm = NAME_CACHE.get(sym);
    if (nm) out[sym] = nm;
  }
  return out;
}

/** Resolve a single ticker's company name (or `undefined` while/if unknown). */
export function useSymbolName(symbol: string | undefined | null): string | undefined {
  const map = useSymbolNames(symbol ?? undefined);
  if (!symbol) return undefined;
  return map[normalize(symbol)];
}
