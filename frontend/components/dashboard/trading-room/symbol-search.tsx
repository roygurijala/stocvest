"use client";

/**
 * Trading Room — reusable symbol typeahead.
 *
 * Debounced search against `/api/stocvest/market/tickers-search`; on pick it
 * hands the symbol back to the caller (which opens the Deep Dive). Used twice:
 * a global search in the session header, and a "look up any symbol" search in
 * the signal feed (so a quiet feed never dead-ends the user).
 */

import { useEffect, useRef, useState } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { useTheme } from "@/lib/theme-provider";
import { isTickerSearchQueryReady } from "@/lib/ticker-search-query";
import { rankSymbolCandidates } from "@/lib/symbol-suggestion-rank";

type Colors = ReturnType<typeof useTheme>["colors"];
type Hit = { symbol: string; name: string };

export function SymbolSearch({
  placeholder,
  onPick,
  colors,
  hint,
  width,
  pill = false
}: {
  placeholder: string;
  onPick: (symbol: string, name?: string | null) => void;
  colors: Colors;
  hint?: string;
  width?: number | string;
  /** Rounded-pill treatment (header global search) vs. boxy (feed search). */
  pill?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!isTickerSearchQueryReady(q)) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      void fetch(`/api/stocvest/market/tickers-search?q=${encodeURIComponent(q)}`, {
        signal: ctrl.signal,
        cache: "no-store"
      })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((json: { items?: Hit[] }) => {
          const raw = Array.isArray(json.items) ? json.items : [];
          // Client-side re-rank: ensures exact ticker (e.g. AAPL) always
          // surfaces before prefix and company-name matches.
          const ranked = rankSymbolCandidates(
            raw.map((h) => ({
              symbol: h.symbol,
              label: h.name ? `${h.symbol} — ${h.name}` : h.symbol,
              name: h.name
            })),
            q
          ) as Array<{ symbol: string; label: string; name: string }>;
          setHits(ranked.slice(0, 8).map((r) => ({ symbol: r.symbol, name: r.name ?? "" })));
          setOpen(true);
        })
        .catch(() => setHits([]));
    }, 260);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (sym: string, name?: string | null) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    onPick(s, name ?? null);
    setQuery("");
    setHits([]);
    setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: "relative", width: width ?? 240, maxWidth: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[2],
          padding: pill ? `${spacing[2]} ${spacing[3]}` : `${spacing[1]} ${spacing[3]}`,
          background: pill ? colors.background : colors.surfaceMuted,
          border: `1px solid ${colors.border}`,
          borderRadius: pill ? borderRadius.full : borderRadius.md
        }}
      >
        <span aria-hidden style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
          ⌕
        </span>
        <input
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const first = hits[0];
              if (first) pick(first.symbol, first.name);
              else if (query.trim()) pick(query);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            color: colors.text,
            fontSize: typography.scale.sm
          }}
        />
      </div>
      {open && hits.length > 0 ? (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 30,
            margin: 0,
            padding: spacing[1],
            listStyle: "none",
            maxHeight: 260,
            overflowY: "auto",
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            boxShadow: "0 12px 32px rgba(0,0,0,0.35)"
          }}
        >
          {hits.map((h) => (
            <li key={h.symbol}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(h.symbol, h.name)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: spacing[2],
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: `${spacing[1]} ${spacing[2]}`,
                  borderRadius: borderRadius.sm,
                  color: colors.text
                }}
              >
                <span style={{ fontWeight: 700, fontSize: typography.scale.sm }}>{h.symbol}</span>
                <span
                  style={{
                    fontSize: typography.scale.xs,
                    color: colors.textMuted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {h.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hint ? (
        <span style={{ display: "block", marginTop: 4, fontSize: 10, color: colors.textMuted }}>{hint}</span>
      ) : null}
    </div>
  );
}
