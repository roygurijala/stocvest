"use client";

import Link from "next/link";
import { Columns2, TrendingUp, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CuteLoader } from "@/components/cute-loader";
import { APP_TOP_BAR_LAYOUT_HEIGHT } from "@/components/top-bar";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { borderRadius, colorTokens, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { watchlistSignalsOpenAriaLabel, watchlistToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import { useTheme } from "@/lib/theme-provider";

const WATCHLIST_MAX_SYMBOLS = 50;

type WatchlistRow = {
  watchlist_id: string;
  name: string;
  symbols: string[];
  is_default: boolean;
};

const QUICK = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA"];

type MaturationRow = {
  state?: string;
  readiness_label?: string;
  label?: string;
};

type MaturationAlertFeedItem = {
  title: string;
  created_at: string;
  symbol?: string | null;
};

type SymbolCandidate = { symbol: string; label: string };

type ThemeColors = (typeof colorTokens)["dark"];

type WatchlistViewMode = "swing" | "day" | "both";

function normalizeTickerInput(raw: string): string | null {
  const u = raw.trim().toUpperCase();
  if (!u) return null;
  if (/^[A-Z]{1,6}$/.test(u)) return u;
  if (/^[A-Z]{1,5}\.[A-Z]$/.test(u)) return u;
  return null;
}

function normalizeTickerFromApi(raw: string): string | null {
  const u = raw.trim().toUpperCase();
  if (!u) return null;
  const narrow = normalizeTickerInput(u);
  if (narrow) return narrow;
  if (/^[A-Z]{1,10}$/.test(u)) return u;
  if (/^[A-Z0-9]{1,8}\.[A-Z]{1,3}$/.test(u)) return u;
  return null;
}

const STATE_RANK: Record<string, number> = {
  actionable: 5,
  developing: 4,
  re_evaluating: 3,
  not_aligned: 2,
  invalidated: 1
};

function stateRank(state: string | undefined): number {
  return STATE_RANK[(state || "").toLowerCase()] ?? 0;
}

function maturationAccent(state: string | undefined, colors: ThemeColors): string {
  switch ((state || "").toLowerCase()) {
    case "actionable":
      return colors.bullish;
    case "developing":
    case "re_evaluating":
      return "#f59e0b";
    case "not_aligned":
      return colors.textMuted;
    case "invalidated":
      return colors.textMuted;
    default:
      return colors.textMuted;
  }
}

function formatStateLabel(m: MaturationRow | undefined): string {
  const raw = (m?.label || m?.state || "").trim();
  if (!raw) return "—";
  return raw.replace(/_/g, " ");
}

function displayStateForSymbol(
  sym: string,
  viewMode: WatchlistViewMode,
  swing: Record<string, MaturationRow>,
  day: Record<string, MaturationRow>
): string | undefined {
  const s = swing[sym]?.state;
  const d = day[sym]?.state;
  if (viewMode === "swing") return s;
  if (viewMode === "day") return d;
  if (stateRank(s) >= stateRank(d)) return s || d;
  return d || s;
}

function tradingModeForSignalsNav(viewMode: WatchlistViewMode, dualDesk: boolean): "day" | "swing" | undefined {
  if (!dualDesk) return "swing";
  if (viewMode === "day") return "day";
  return "swing";
}

type WatchlistsPageClientProps = {
  /** Swing + Day Pro (and full access): Swing / Day / Both maturation toggles + dual rows. */
  dualDeskMaturation?: boolean;
  /** Short plan label for the header chip, e.g. ``Swing + Day Pro``. */
  planBadgeLabel?: string;
};

export function WatchlistsPageClient(props: WatchlistsPageClientProps = {}) {
  const { dualDeskMaturation = false, planBadgeLabel = "Free" } = props;
  const { colors, theme } = useTheme();
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [addInput, setAddInput] = useState("");
  const [symErr, setSymErr] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [maturationSwing, setMaturationSwing] = useState<Record<string, MaturationRow>>({});
  const [maturationDay, setMaturationDay] = useState<Record<string, MaturationRow>>({});
  const [maturationFetchStatus, setMaturationFetchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<WatchlistViewMode>("swing");
  const [maturationAlerts, setMaturationAlerts] = useState<MaturationAlertFeedItem[]>([]);
  const [maturationAlertsStatus, setMaturationAlertsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [tickerSuggest, setTickerSuggest] = useState<SymbolCandidate[]>([]);
  const [tickerSuggestOpen, setTickerSuggestOpen] = useState(false);
  const [tickerSuggestLoading, setTickerSuggestLoading] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addWrapRef = useRef<HTMLDivElement | null>(null);

  usePublishAssistantContext({ page: "dashboard/watchlists" });

  useEffect(() => {
    if (!dualDeskMaturation && viewMode !== "swing") setViewMode("swing");
  }, [dualDeskMaturation, viewMode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stocvest/watchlists", { cache: "no-store" });
      const data = (await res.json()) as { watchlists?: WatchlistRow[]; message?: string };
      if (!res.ok) throw new Error(data.message || "Failed to load watchlists");
      const list = data.watchlists ?? [];
      setRows(list);
      setActiveId((id) => id && list.some((w) => w.watchlist_id === id) ? id : list[0]?.watchlist_id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => rows.find((w) => w.watchlist_id === activeId) ?? rows[0] ?? null, [rows, activeId]);

  useEffect(() => {
    if (!active?.is_default || active.symbols.length === 0) {
      setMaturationSwing({});
      setMaturationDay({});
      setMaturationFetchStatus("idle");
      setLastEvaluatedAt(null);
      return;
    }
    setMaturationFetchStatus("loading");
    let cancelled = false;
    void (async () => {
      try {
        if (dualDeskMaturation) {
          const [swRes, dyRes] = await Promise.all([
            fetch(`/api/stocvest/watchlists/maturation-summary?${new URLSearchParams({ mode: "swing" })}`, {
              cache: "no-store"
            }),
            fetch(`/api/stocvest/watchlists/maturation-summary?${new URLSearchParams({ mode: "day" })}`, {
              cache: "no-store"
            })
          ]);
          const swData = (await swRes.json().catch(() => ({}))) as { by_symbol?: Record<string, MaturationRow> };
          const dyData = (await dyRes.json().catch(() => ({}))) as { by_symbol?: Record<string, MaturationRow> };
          if (cancelled) return;
          if (!swRes.ok || !dyRes.ok) {
            setMaturationSwing({});
            setMaturationDay({});
            setMaturationFetchStatus("error");
            return;
          }
          setMaturationSwing(swData.by_symbol ?? {});
          setMaturationDay(dyData.by_symbol ?? {});
        } else {
          const res = await fetch(`/api/stocvest/watchlists/maturation-summary?${new URLSearchParams({ mode: "swing" })}`, {
            cache: "no-store"
          });
          const data = (await res.json().catch(() => ({}))) as { by_symbol?: Record<string, MaturationRow> };
          if (cancelled) return;
          if (!res.ok) {
            setMaturationSwing({});
            setMaturationDay({});
            setMaturationFetchStatus("error");
            return;
          }
          setMaturationSwing(data.by_symbol ?? {});
          setMaturationDay({});
        }
        setMaturationFetchStatus("ready");
        setLastEvaluatedAt(new Date());
      } catch {
        if (!cancelled) {
          setMaturationSwing({});
          setMaturationDay({});
          setMaturationFetchStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.watchlist_id, active?.is_default, active?.symbols?.join(",") ?? "", dualDeskMaturation]);

  useEffect(() => {
    if (!active?.is_default || active.symbols.length === 0) {
      setMaturationAlerts([]);
      setMaturationAlertsStatus("idle");
      return;
    }
    setMaturationAlertsStatus("loading");
    let cancelled = false;
    void (async () => {
      try {
        const listSyms = active.symbols
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
          .slice(0, 50);
        const qs = new URLSearchParams({
          limit: "12",
          alert_type: "watchlist_maturation",
          symbols: listSyms.join(",")
        });
        const res = await fetch(`/api/stocvest/alerts/history?${qs.toString()}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { alerts?: unknown[] };
        if (cancelled) return;
        if (!res.ok) {
          setMaturationAlerts([]);
          setMaturationAlertsStatus("error");
          return;
        }
        const out: MaturationAlertFeedItem[] = [];
        for (const raw of data.alerts ?? []) {
          if (!raw || typeof raw !== "object") continue;
          const a = raw as Record<string, unknown>;
          if (String(a.alert_type ?? "").trim() !== "watchlist_maturation") continue;
          const sym = String(a.symbol ?? "")
            .trim()
            .toUpperCase();
          if (!sym) continue;
          out.push({
            title: String(a.title ?? "Maturation update"),
            created_at: String(a.created_at ?? ""),
            symbol: sym
          });
        }
        setMaturationAlerts(out.slice(0, 8));
        setMaturationAlertsStatus("ready");
      } catch {
        if (!cancelled) {
          setMaturationAlerts([]);
          setMaturationAlertsStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.watchlist_id, active?.is_default, active?.symbols?.join(",") ?? ""]);

  useEffect(() => {
    const q = addInput.trim();
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (q.length < 1) {
      setTickerSuggest([]);
      setTickerSuggestOpen(false);
      setTickerSuggestLoading(false);
      return;
    }
    suggestTimer.current = setTimeout(() => {
      void (async () => {
        setTickerSuggestLoading(true);
        try {
          const res = await fetch(`/api/stocvest/market/tickers-search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
          const data = (await res.json().catch(() => ({}))) as { results?: unknown[] };
          const rawList = Array.isArray(data.results) ? data.results : [];
          const out: SymbolCandidate[] = [];
          for (const item of rawList) {
            if (!item || typeof item !== "object") continue;
            const o = item as Record<string, unknown>;
            const sym = normalizeTickerFromApi(String(o.symbol ?? ""));
            if (!sym) continue;
            const name = String(o.name ?? o.description ?? "").trim();
            out.push({ symbol: sym, label: name ? `${sym} — ${name}` : sym });
            if (out.length >= 8) break;
          }
          setTickerSuggest(out);
          setTickerSuggestOpen(out.length > 0);
        } catch {
          setTickerSuggest([]);
          setTickerSuggestOpen(false);
        } finally {
          setTickerSuggestLoading(false);
        }
      })();
    }, 220);
    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, [addInput]);

  useEffect(() => {
    function onDocMouseDown(ev: MouseEvent) {
      const el = addWrapRef.current;
      if (!el || !el.contains(ev.target as Node)) {
        setTickerSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  async function patchWatchlist(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/stocvest/watchlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { message?: string }).message || "Update failed");
    return data as WatchlistRow;
  }

  async function createWatchlist() {
    const name = newName.trim() || "New Watchlist";
    const res = await fetch("/api/stocvest/watchlists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, symbols: [], is_default: rows.length === 0 })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data as { message?: string }).message || "Could not create");
      return;
    }
    setNewOpen(false);
    setNewName("");
    await load();
    setActiveId((data as WatchlistRow).watchlist_id);
  }

  async function addSymbol(symRaw: string) {
    if (!active) return;
    const sym = symRaw.trim().toUpperCase();
    setSymErr(null);
    if (!sym || sym.length > 6 || !/^[A-Z]+$/.test(sym)) {
      setSymErr("Use 1–6 uppercase letters.");
      return;
    }
    const prev = rows;
    const optimistic = rows.map((w) =>
      w.watchlist_id === active.watchlist_id ? { ...w, symbols: w.symbols.includes(sym) ? w.symbols : [...w.symbols, sym] } : w
    );
    setRows(optimistic);
    try {
      const res = await fetch(`/api/stocvest/watchlists/${encodeURIComponent(active.watchlist_id)}/symbols`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: sym })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400) {
        setRows(prev);
        setSymErr((data as { message?: string }).message || "Limit reached");
        return;
      }
      if (!res.ok) {
        setRows(prev);
        setSymErr("Add failed");
        return;
      }
      setRows((r) => r.map((w) => (w.watchlist_id === active.watchlist_id ? (data as WatchlistRow) : w)));
    } catch {
      setRows(prev);
      setSymErr("Network error");
    }
    setAddInput("");
    setTickerSuggestOpen(false);
  }

  async function removeSymbol(sym: string) {
    if (!active) return;
    const prev = rows;
    setRows((r) =>
      r.map((w) => (w.watchlist_id === active.watchlist_id ? { ...w, symbols: w.symbols.filter((s) => s !== sym) } : w))
    );
    try {
      const res = await fetch(
        `/api/stocvest/watchlists/${encodeURIComponent(active.watchlist_id)}/symbols/${encodeURIComponent(sym)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRows(prev);
        setError((data as { message?: string }).message || "Remove failed");
        return;
      }
      setRows((r) => r.map((w) => (w.watchlist_id === active.watchlist_id ? (data as WatchlistRow) : w)));
    } catch {
      setRows(prev);
    }
  }

  async function setDefault() {
    if (!active) return;
    await patchWatchlist(active.watchlist_id, { is_default: true });
    await load();
  }

  async function deleteList() {
    if (!active) return;
    if (!window.confirm("Delete this watchlist?")) return;
    try {
      const res = await fetch(`/api/stocvest/watchlists/${encodeURIComponent(active.watchlist_id)}`, {
        method: "DELETE"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { message?: string }).message || "Cannot delete");
        return;
      }
      await load();
    } catch {
      setError("Delete failed");
    }
  }

  async function saveRename(name: string) {
    if (!active) return;
    await patchWatchlist(active.watchlist_id, { name });
    setRename(null);
    await load();
  }

  const evaluatedLabel = useMemo(() => {
    if (!active?.is_default || active.symbols.length === 0) return null;
    if (maturationFetchStatus === "loading") return "Loading…";
    if (maturationFetchStatus === "error") return "Unavailable";
    if (!lastEvaluatedAt) return null;
    return lastEvaluatedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }, [active?.is_default, active?.symbols?.length, maturationFetchStatus, lastEvaluatedAt]);

  const sortedSymbols = useMemo(() => {
    if (!active) return [];
    const syms = active.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!active.is_default || maturationFetchStatus !== "ready") {
      return [...syms].sort();
    }
    const rankFor = (sym: string) => {
      const disp = displayStateForSymbol(sym, viewMode, maturationSwing, maturationDay);
      return stateRank(disp);
    };
    return [...syms].sort((a, b) => {
      const dr = rankFor(b) - rankFor(a);
      if (dr !== 0) return dr;
      return a.localeCompare(b);
    });
  }, [active, maturationFetchStatus, maturationSwing, maturationDay, viewMode]);

  const statusCounts = useMemo(() => {
    const keys = ["actionable", "developing", "not_aligned", "invalidated"] as const;
    const out: Record<(typeof keys)[number], number> = {
      actionable: 0,
      developing: 0,
      not_aligned: 0,
      invalidated: 0
    };
    if (!active?.is_default || maturationFetchStatus !== "ready") return out;
    for (const sym of active.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)) {
      const disp = (displayStateForSymbol(sym, viewMode, maturationSwing, maturationDay) || "").toLowerCase();
      if (disp === "actionable") out.actionable += 1;
      else if (disp === "developing" || disp === "re_evaluating") out.developing += 1;
      else if (disp === "not_aligned") out.not_aligned += 1;
      else if (disp === "invalidated") out.invalidated += 1;
    }
    return out;
  }, [active, maturationFetchStatus, maturationSwing, maturationDay, viewMode]);

  const tabBtn = (mode: WatchlistViewMode, label: string, icon: ReactNode) => {
    const on = viewMode === mode;
    return (
      <button
        type="button"
        onClick={() => setViewMode(mode)}
        className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold sm:flex-none sm:px-3 sm:text-sm"
        style={{
          border: `1px solid ${on ? "rgba(0,180,255,0.45)" : colors.border}`,
          background: on ? "rgba(0,180,255,0.12)" : colors.surfaceMuted,
          color: on ? colors.accent : colors.textMuted,
          cursor: "pointer"
        }}
      >
        {icon}
        {label}
      </button>
    );
  };

  if (loading) {
    return <CuteLoader label="Loading watchlist" sublabel="Syncing your symbols" compact />;
  }
  if (error && !rows.length) {
    return <p style={{ color: colors.bearish }}>{error}</p>;
  }

  const slotUsed = active?.symbols.length ?? 0;
  const slotsLeft = Math.max(0, WATCHLIST_MAX_SYMBOLS - slotUsed);
  const headerStickyStyle = {
    top: APP_TOP_BAR_LAYOUT_HEIGHT,
    background: colors.background,
    borderBottom: `1px solid ${colors.border}`
  } as const;

  return (
    <div className="flex min-h-0 min-w-0 flex-col" style={{ gap: spacing[3] }}>
      {newOpen ? (
        <div
          className={surfaceGlowClassName}
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "flex",
            flexWrap: "wrap",
            gap: spacing[2],
            alignItems: "center"
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Watchlist name"
            className="min-h-11 rounded-md border px-3"
            style={{ borderColor: colors.border, background: colors.surfaceMuted, color: colors.text, minWidth: 200 }}
          />
          <button type="button" className="min-h-11 rounded-md px-3" style={{ border: `1px solid ${colors.border}` }} onClick={() => void createWatchlist()}>
            Create
          </button>
          <button type="button" className="min-h-11 rounded-md px-3 text-sm" style={{ color: colors.textMuted }} onClick={() => setNewOpen(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {active ? (
        <>
          <header className="sticky z-20 -mx-4 px-4 pb-3 pt-0 lg:-mx-6 lg:px-6" style={headerStickyStyle}>
            <div className="flex flex-wrap items-start justify-between gap-2 pb-2">
              <div className="min-w-0">
                <h1 className="m-0 truncate text-xl font-bold tracking-tight sm:text-2xl" style={{ color: colors.text }}>
                  Watchlist
                </h1>
                {rows.length > 1 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {rows.map((w) => {
                      const isAct = active?.watchlist_id === w.watchlist_id;
                      return (
                        <button
                          key={w.watchlist_id}
                          type="button"
                          onClick={() => setActiveId(w.watchlist_id)}
                          className="rounded-md px-2.5 py-1 text-xs font-semibold"
                          style={{
                            border: `1px solid ${isAct ? "rgba(0,180,255,0.45)" : colors.border}`,
                            background: isAct ? "rgba(0,180,255,0.1)" : colors.surface,
                            color: isAct ? colors.accent : colors.text
                          }}
                        >
                          {w.is_default ? "★ " : ""}
                          {w.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold tabular-nums sm:text-sm"
                  style={{
                    background: colors.surfaceMuted,
                    border: `1px solid ${colors.border}`,
                    color: colors.text
                  }}
                >
                  {planBadgeLabel} · {slotUsed}/{WATCHLIST_MAX_SYMBOLS}
                </span>
                <button
                  type="button"
                  className="min-h-9 rounded-md px-3 text-xs font-semibold sm:text-sm"
                  style={{ border: `1px solid ${colors.border}`, color: colors.text }}
                  onClick={() => setNewOpen(true)}
                >
                  + List
                </button>
              </div>
            </div>

            <div ref={addWrapRef} className="relative pb-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <input
                  value={addInput}
                  onChange={(e) => setAddInput(e.target.value.toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 12))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addSymbol(addInput);
                  }}
                  onFocus={() => {
                    if (tickerSuggest.length) setTickerSuggestOpen(true);
                  }}
                  placeholder="Add ticker — MSFT, AMD, JPM…"
                  className="min-h-11 w-full flex-1 rounded-lg border px-3"
                  style={{
                    borderColor: colors.border,
                    background: colors.surface,
                    color: colors.text,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    letterSpacing: "0.04em",
                    fontWeight: 600
                  }}
                  aria-autocomplete="list"
                  aria-expanded={tickerSuggestOpen}
                />
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded-lg px-5 text-sm font-bold sm:w-auto"
                  style={{
                    background: colors.accent,
                    color: theme === "light" ? "#ffffff" : "#041018",
                    border: "none",
                    cursor: "pointer"
                  }}
                  onClick={() => void addSymbol(addInput)}
                >
                  Add
                </button>
              </div>
              {tickerSuggestOpen && tickerSuggest.length > 0 ? (
                <ul
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-auto rounded-lg border shadow-lg sm:right-auto sm:min-w-[min(100%,420px)]"
                  style={{
                    background: colors.surface,
                    borderColor: colors.border
                  }}
                  role="listbox"
                >
                  {tickerSuggest.map((c) => (
                    <li key={c.symbol} role="option">
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:brightness-110"
                        style={{ color: colors.text }}
                        onClick={() => {
                          setAddInput(c.symbol);
                          setTickerSuggestOpen(false);
                          void addSymbol(c.symbol);
                        }}
                      >
                        {c.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {tickerSuggestLoading ? (
                <p className="m-0 pt-1 text-xs" style={{ color: colors.textMuted }}>
                  Searching…
                </p>
              ) : null}
              {symErr ? (
                <p className="m-0 pt-1 text-xs" style={{ color: colors.bearish }}>
                  {symErr}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5 sm:gap-2">
                {tabBtn("swing", "Swing", <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden />)}
                {dualDeskMaturation ? (
                  <>
                    {tabBtn("day", "Day", <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden />)}
                    {tabBtn("both", "Both", <Columns2 className="h-3.5 w-3.5 shrink-0" aria-hidden />)}
                  </>
                ) : null}
              </div>
              {evaluatedLabel ? (
                <span className="shrink-0 text-xs tabular-nums sm:text-sm" style={{ color: colors.textMuted }}>
                  Evaluated {evaluatedLabel}
                </span>
              ) : null}
            </div>
          </header>

          <div style={{ display: "grid", gap: spacing[3] }}>
            {active && !active.is_default && rows.length > 1 ? (
              <p
                className="m-0 rounded-lg border px-3 py-2 text-sm leading-snug"
                style={{ borderColor: colors.border, background: colors.surfaceMuted, color: colors.textMuted }}
              >
                <strong style={{ color: colors.text }}>Maturation</strong> (readiness vs the engine) is shown only on your{" "}
                <strong>default</strong> watchlist (★). Switch lists above to see per-symbol status on the default list.
              </p>
            ) : null}

            {active.is_default && active.symbols.length > 0 ? (
              <div
                className="grid gap-3 rounded-xl border px-3 py-3 sm:grid-cols-2 sm:px-4"
                style={{ borderColor: colors.border, background: colors.surface }}
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: colors.bullish }}>
                      {statusCounts.actionable}
                    </p>
                    <p className="m-0 text-[10px] font-bold uppercase tracking-wider sm:text-xs" style={{ color: colors.textMuted }}>
                      Actionable
                    </p>
                  </div>
                  <div>
                    <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: "#f59e0b" }}>
                      {statusCounts.developing}
                    </p>
                    <p className="m-0 text-[10px] font-bold uppercase tracking-wider sm:text-xs" style={{ color: colors.textMuted }}>
                      Developing
                    </p>
                  </div>
                  <div>
                    <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: colors.textMuted }}>
                      {statusCounts.not_aligned}
                    </p>
                    <p className="m-0 text-[10px] font-bold uppercase tracking-wider sm:text-xs" style={{ color: colors.textMuted }}>
                      Not aligned
                    </p>
                  </div>
                  <div>
                    <p className="m-0 text-2xl font-bold tabular-nums" style={{ color: colors.textMuted }}>
                      {statusCounts.invalidated}
                    </p>
                    <p className="m-0 text-[10px] font-bold uppercase tracking-wider sm:text-xs" style={{ color: colors.textMuted }}>
                      Invalidated
                    </p>
                  </div>
                </div>
                <div className="flex flex-col justify-center gap-1 sm:border-l sm:pl-4" style={{ borderColor: colors.border }}>
                  <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: colors.surfaceMuted }}>
                    <div
                      className="h-full rounded-full transition-[width]"
                      style={{
                        width: `${Math.min(100, (slotUsed / WATCHLIST_MAX_SYMBOLS) * 100)}%`,
                        background: colors.accent
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs" style={{ color: colors.textMuted }}>
                    <span>
                      {slotUsed} of {WATCHLIST_MAX_SYMBOLS} symbol slots used
                    </span>
                    <span className="tabular-nums">{slotsLeft} left</span>
                  </div>
                </div>
              </div>
            ) : null}

            {active.is_default && active.symbols.length > 0 ? (
              <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
                <span className="font-semibold" style={{ color: "#a78bfa" }}>
                  ■
                </span>{" "}
                Swing{" "}
                {dualDeskMaturation ? (
                  <>
                    <span className="font-semibold" style={{ color: "#2dd4bf" }}>
                      ■
                    </span>{" "}
                    Day ·{" "}
                  </>
                ) : null}
                Sorted by best maturation state
                {viewMode === "both" || viewMode === "day" ? " (per active tab)" : ""}.
              </p>
            ) : null}

            <article
              className={surfaceGlowClassName}
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: colors.border }}>
                <div className="min-w-0">
                  {rename === active.watchlist_id ? (
                    <input
                      autoFocus
                      defaultValue={active.name}
                      onBlur={(e) => void saveRename(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="min-h-10 w-full max-w-xs rounded-md border px-2 text-base font-semibold"
                      style={{ borderColor: colors.border, color: colors.text }}
                    />
                  ) : (
                    <h2
                      className="m-0 cursor-pointer text-lg font-semibold"
                      style={{ color: colors.text }}
                      onClick={() => setRename(active.watchlist_id)}
                      title="Click to rename"
                    >
                      {active.name}
                    </h2>
                  )}
                  <p className="m-0 mt-0.5 text-xs" style={{ color: colors.textMuted }}>
                    {active.is_default ? "Default · powers scanner & gap intel" : "Custom list"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!active.is_default ? (
                    <button
                      type="button"
                      className="min-h-9 rounded-md border px-3 text-xs font-semibold"
                      style={{ borderColor: colors.border, color: colors.text }}
                      onClick={() => void setDefault()}
                    >
                      Set default
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="min-h-9 rounded-md border px-3 text-xs font-semibold"
                    style={{ borderColor: colors.bearish, color: colors.bearish }}
                    onClick={() => void deleteList()}
                  >
                    Delete list
                  </button>
                </div>
              </div>

              {active.is_default && active.symbols.length > 0 ? (
                <div
                  data-testid="watchlist-maturation-alerts-feed"
                  className="mx-4 mt-3 rounded-lg border px-3 py-2"
                  style={{ borderColor: "rgba(0, 180, 255, 0.22)", background: "rgba(0, 180, 255, 0.06)" }}
                >
                  <p className="m-0 text-[10px] font-bold uppercase tracking-wider" style={{ color: colors.textMuted }}>
                    Recent maturation alerts
                  </p>
                  {maturationAlertsStatus === "loading" ? (
                    <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
                      Loading…
                    </p>
                  ) : null}
                  {maturationAlertsStatus === "error" ? (
                    <p className="m-0 mt-1 text-xs" style={{ color: colors.bearish }}>
                      Could not load alert history.
                    </p>
                  ) : null}
                  {maturationAlertsStatus === "ready" && maturationAlerts.length === 0 ? (
                    <p className="m-0 mt-1 text-xs leading-snug" style={{ color: colors.textMuted }}>
                      No maturation emails yet. They appear when readiness changes after you run evidence from Signals.
                    </p>
                  ) : null}
                  {maturationAlertsStatus === "ready" && maturationAlerts.length > 0 ? (
                    <ul className="m-0 mt-1 list-disc space-y-1 pl-4 text-xs" style={{ color: colors.text }}>
                      {maturationAlerts.map((row, i) => (
                        <li key={`${row.created_at}-${i}`}>
                          <Link
                            href={watchlistToSignalsHref(row.symbol ?? "", tradingModeForSignalsNav(viewMode, dualDeskMaturation))}
                            prefetch={false}
                            aria-label={watchlistSignalsOpenAriaLabel(row.symbol ?? "")}
                            style={{ color: colors.text, fontWeight: 700, textDecoration: "none" }}
                            className="hover:underline"
                          >
                            {row.symbol}
                          </Link>
                          <span style={{ color: colors.textMuted }}> — {row.title}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="m-0 mt-2 text-[10px]">
                    <Link href="/dashboard/settings#alerts" style={{ color: colors.accent, fontWeight: 600 }}>
                      Alert preferences
                    </Link>
                  </p>
                </div>
              ) : null}

              <div className="p-3 sm:p-4">
                {active.symbols.length === 0 ? (
                  <div>
                    <p className="m-0 mb-3 text-sm" style={{ color: colors.textMuted }}>
                      No symbols yet. Use the bar above or tap a popular name.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void addSymbol(s)}
                          className="min-h-10 rounded-md border px-3 text-sm font-bold tracking-wide"
                          style={{ borderColor: colors.accent, color: colors.text }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {sortedSymbols.map((s) => {
                      const symU = s.trim().toUpperCase();
                      const ms = active.is_default ? maturationSwing[symU] : undefined;
                      const md = active.is_default && dualDeskMaturation ? maturationDay[symU] : undefined;
                      const displaySt = active.is_default
                        ? displayStateForSymbol(symU, viewMode, maturationSwing, maturationDay)
                        : undefined;
                      const accent = maturationAccent(displaySt, colors as ThemeColors);
                      const href = watchlistToSignalsHref(s, tradingModeForSignalsNav(viewMode, dualDeskMaturation));
                      const rowLine = (mode: "swing" | "day", m: MaturationRow | undefined) => (
                        <div className="flex min-w-0 flex-wrap items-baseline gap-2 text-xs sm:text-sm">
                          <span
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                            style={{
                              background: mode === "swing" ? "rgba(167,139,250,0.2)" : "rgba(45,212,191,0.15)",
                              color: mode === "swing" ? "#c4b5fd" : "#5eead4"
                            }}
                          >
                            {mode === "swing" ? "Swing" : "Day"}
                          </span>
                          <span className="min-w-0 text-[11px] font-medium leading-snug sm:text-sm" style={{ color: colors.text }}>
                            ● {formatStateLabel(m)}
                            {m?.readiness_label ? (
                              <span
                                className="text-[10px] font-normal sm:text-xs"
                                style={{ color: colors.textMuted }}
                                title={m.readiness_label}
                              >
                                {" "}
                                · {m.readiness_label.length > 48 ? `${m.readiness_label.slice(0, 48)}…` : m.readiness_label}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      );
                      return (
                        <li key={s}>
                          <div className="relative flex items-stretch gap-3 rounded-xl border px-3 py-3 transition hover:brightness-[1.03] sm:px-4" style={{ borderColor: colors.border, background: colors.background }}>
                            <Link
                              href={href}
                              prefetch={false}
                              className="absolute inset-0 z-0 rounded-xl"
                              aria-label={watchlistSignalsOpenAriaLabel(s)}
                            >
                              <span className="sr-only">Open {symU} on Signals</span>
                            </Link>
                            <span className="relative z-[1] mt-1 h-2.5 w-2.5 shrink-0 rounded-full pointer-events-none" style={{ background: accent }} aria-hidden />
                            <div className="relative z-[1] min-w-0 flex-1 pointer-events-none">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="font-mono text-lg font-bold tracking-wide">{symU}</span>
                                {maturationFetchStatus === "loading" && active.is_default ? (
                                  <span className="text-[10px] uppercase" style={{ color: colors.textMuted }}>
                                    …
                                  </span>
                                ) : null}
                              </div>
                              {active.is_default && (viewMode === "both" || viewMode === "swing" || !dualDeskMaturation) ? (
                                <div className="mt-2 space-y-1.5">{rowLine("swing", ms)}</div>
                              ) : null}
                              {active.is_default && dualDeskMaturation && (viewMode === "both" || viewMode === "day") ? (
                                <div className={viewMode === "both" ? "mt-2 space-y-1.5" : "mt-2 space-y-1.5"}>{rowLine("day", md)}</div>
                              ) : null}
                              {!active.is_default ? (
                                <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
                                  Open Signals for full context.
                                </p>
                              ) : null}
                            </div>
                            {evaluatedLabel && active.is_default ? (
                              <span className="relative z-[1] hidden shrink-0 self-start pt-1 text-xs tabular-nums pointer-events-none sm:inline" style={{ color: colors.textMuted }}>
                                {evaluatedLabel}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className="relative z-10 shrink-0 self-start rounded p-1.5 text-lg leading-none hover:bg-white/5"
                              style={{ color: colors.textMuted }}
                              aria-label={`Remove ${s}`}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void removeSymbol(s);
                              }}
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </article>

            <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
              Default watchlist symbols feed the scanner. Maturation reflects your last evidence run or the scheduled refresh.
              <Link href="/dashboard/signals" className="ml-1 font-semibold" style={{ color: colors.accent }}>
                Open Signals
              </Link>
            </p>
          </div>
        </>
      ) : (
        <p style={{ color: colors.textMuted }}>No watchlists yet. Create one with + List.</p>
      )}
    </div>
  );
}
