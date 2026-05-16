"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Columns2, TrendingUp, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CuteLoader } from "@/components/cute-loader";
import { APP_TOP_BAR_LAYOUT_HEIGHT } from "@/components/top-bar";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { borderRadius, colorTokens, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { watchlistSignalsOpenAriaLabel, watchlistToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import type { SnapshotPayload } from "@/lib/api/market";
import { rankSymbolCandidates } from "@/lib/symbol-suggestion-rank";
import {
  dedupeWatchlistSymbolsUpper as dedupeSymbolsUpper,
  formatWatchlistMaturationLabel as formatStateLabel,
  normalizeWatchlistMaturationBySymbol as normalizeMaturationBySymbol,
  parseCompanyNameFromTickerCandidateLabel,
  watchlistQuoteFromSnapshot,
  watchlistSymbolMatchesSearch,
  type WatchlistMaturationRow as MaturationRow,
  type WatchlistViewMode
} from "@/lib/watchlist-page-utils";
import { useTheme } from "@/lib/theme-provider";
import {
  compareSymbolsByPresentationPriority,
  maturationAlertPassesTracking,
  parseMaturationModeFromAlertBody,
  presentationMaturationState,
  shouldShowDeskRow,
  trackingForSymbol,
  type SymbolTrackingMap
} from "@/lib/watchlist-tracking-presentation";

const WATCHLIST_MAX_SYMBOLS = 50;

type WatchlistRow = {
  watchlist_id: string;
  name: string;
  symbols: string[];
  is_default: boolean;
  symbol_tracking?: SymbolTrackingMap;
};

const QUICK = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA"];

type MaturationAlertFeedItem = {
  title: string;
  created_at: string;
  symbol?: string | null;
  mode?: "swing" | "day";
};

type SymbolCandidate = { symbol: string; label: string };

type WatchlistAddSuggestion = SymbolCandidate & { kind: "watchlist" | "add" };

type ThemeColors = (typeof colorTokens)["dark"];

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

function displayStateForSymbol(
  sym: string,
  trackingMap: SymbolTrackingMap | undefined,
  swing: Record<string, MaturationRow>,
  day: Record<string, MaturationRow>,
  dualDesk: boolean
): string | undefined {
  return presentationMaturationState(sym, trackingMap, swing[sym], day[sym], dualDesk);
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
  const searchParams = useSearchParams();
  const { colors, theme } = useTheme();
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState("");
  const [symErr, setSymErr] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [maturationSwing, setMaturationSwing] = useState<Record<string, MaturationRow>>({});
  const [maturationDay, setMaturationDay] = useState<Record<string, MaturationRow>>({});
  const [maturationFetchStatus, setMaturationFetchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<WatchlistViewMode>("swing");
  const [maturationAlerts, setMaturationAlerts] = useState<MaturationAlertFeedItem[]>([]);
  const [maturationAlertsStatus, setMaturationAlertsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [addSuggestOpen, setAddSuggestOpen] = useState(false);
  const [addSuggestHighlight, setAddSuggestHighlight] = useState(0);
  const [addRemoteCandidates, setAddRemoteCandidates] = useState<SymbolCandidate[]>([]);
  const [addRemoteSearchLoading, setAddRemoteSearchLoading] = useState(false);
  const [addRemoteSearchError, setAddRemoteSearchError] = useState<string | null>(null);
  const addComboRef = useRef<HTMLDivElement | null>(null);
  const [snapshotsBySymbol, setSnapshotsBySymbol] = useState<Record<string, SnapshotPayload>>({});
  const [snapshotFetchStatus, setSnapshotFetchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  usePublishAssistantContext({ page: "dashboard/watchlists" });

  useEffect(() => {
    if (loading) return;
    const focus = (searchParams.get("focus") ?? "").trim().toUpperCase();
    if (!focus) return;
    const el = document.getElementById(`watchlist-row-${focus}`);
    if (!el) return;
    window.requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.style.outline = `2px solid ${colors.accent}`;
      window.setTimeout(() => {
        el.style.outline = "";
      }, 2400);
    });
  }, [loading, searchParams, colors.accent]);

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
      let list = data.watchlists ?? [];
      if (list.length === 0) {
        const cr = await fetch("/api/stocvest/watchlists", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "My Watchlist", symbols: [], is_default: true })
        });
        const created = (await cr.json()) as WatchlistRow & { message?: string };
        if (!cr.ok) throw new Error(created.message || "Failed to create watchlist");
        list = [created];
      }
      setRows(
        list.map((w) => ({
          ...w,
          symbols: dedupeSymbolsUpper(w.symbols)
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => rows[0] ?? null, [rows]);

  const activeSymbolsDeduped = useMemo(() => dedupeSymbolsUpper(active?.symbols ?? []), [active?.symbols]);

  const symbolTrackingMap = useMemo((): SymbolTrackingMap => {
    const raw = active?.symbol_tracking;
    if (!raw || typeof raw !== "object") return {};
    const out: SymbolTrackingMap = {};
    for (const sym of activeSymbolsDeduped) {
      const row = raw[sym];
      if (row && typeof row === "object") {
        out[sym] = { swing: Boolean(row.swing), day: Boolean(row.day) };
      }
    }
    return out;
  }, [active?.symbol_tracking, activeSymbolsDeduped]);

  useEffect(() => {
    if (!active?.is_default || activeSymbolsDeduped.length === 0) {
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
          const swJson = (await swRes.json().catch(() => ({}))) as unknown;
          const dyJson = (await dyRes.json().catch(() => ({}))) as unknown;
          if (cancelled) return;
          if (!swRes.ok || !dyRes.ok) {
            setMaturationSwing({});
            setMaturationDay({});
            setMaturationFetchStatus("error");
            return;
          }
          setMaturationSwing(normalizeMaturationBySymbol(swJson));
          setMaturationDay(normalizeMaturationBySymbol(dyJson));
        } else {
          const res = await fetch(`/api/stocvest/watchlists/maturation-summary?${new URLSearchParams({ mode: "swing" })}`, {
            cache: "no-store"
          });
          const json = (await res.json().catch(() => ({}))) as unknown;
          if (cancelled) return;
          if (!res.ok) {
            setMaturationSwing({});
            setMaturationDay({});
            setMaturationFetchStatus("error");
            return;
          }
          setMaturationSwing(normalizeMaturationBySymbol(json));
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
  }, [active?.watchlist_id, active?.is_default, activeSymbolsDeduped.join(","), dualDeskMaturation]);

  useEffect(() => {
    const syms = activeSymbolsDeduped.slice(0, WATCHLIST_MAX_SYMBOLS);
    if (syms.length === 0) {
      setSnapshotsBySymbol({});
      setSnapshotFetchStatus("idle");
      return;
    }
    let cancelled = false;
    setSnapshotFetchStatus("loading");
    void (async () => {
      const merged: Record<string, SnapshotPayload> = {};
      try {
        for (let i = 0; i < syms.length; i += 40) {
          const chunk = syms.slice(i, i + 40);
          if (chunk.length === 0) break;
          const res = await fetch(`/api/stocvest/market/snapshots?symbols=${encodeURIComponent(chunk.join(","))}`, {
            cache: "no-store",
            credentials: "same-origin"
          });
          if (!res.ok) continue;
          const data = (await res.json().catch(() => ({}))) as { snapshots?: unknown[] };
          for (const raw of data.snapshots ?? []) {
            if (!raw || typeof raw !== "object") continue;
            const row = raw as SnapshotPayload;
            const sym = String(row.symbol ?? "")
              .trim()
              .toUpperCase();
            if (sym) merged[sym] = row;
          }
        }
        if (!cancelled) {
          setSnapshotsBySymbol(merged);
          setSnapshotFetchStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setSnapshotsBySymbol({});
          setSnapshotFetchStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.watchlist_id, activeSymbolsDeduped.join(",")]);

  useEffect(() => {
    if (!active?.is_default || activeSymbolsDeduped.length === 0) {
      setMaturationAlerts([]);
      setMaturationAlertsStatus("idle");
      return;
    }
    setMaturationAlertsStatus("loading");
    let cancelled = false;
    void (async () => {
      try {
        const listSyms = activeSymbolsDeduped.slice(0, 50);
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
          const mode = parseMaturationModeFromAlertBody(a.body);
          if (!maturationAlertPassesTracking(sym, mode, symbolTrackingMap, dualDeskMaturation)) continue;
          out.push({
            title: String(a.title ?? "Maturation update"),
            created_at: String(a.created_at ?? ""),
            symbol: sym,
            mode
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
  }, [
    active?.watchlist_id,
    active?.is_default,
    activeSymbolsDeduped.join(","),
    symbolTrackingMap,
    dualDeskMaturation
  ]);

  const localAddCandidates = useMemo((): SymbolCandidate[] => {
    const onList = new Set(activeSymbolsDeduped);
    const m = new Map<string, SymbolCandidate>();
    for (const raw of QUICK) {
      const sym = normalizeTickerFromApi(raw) || normalizeTickerInput(raw);
      if (!sym || onList.has(sym)) continue;
      m.set(sym, { symbol: sym, label: sym });
    }
    return Array.from(m.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [activeSymbolsDeduped]);

  useEffect(() => {
    const q = addDraft.trim();
    if (q.length < 2) {
      setAddRemoteCandidates([]);
      setAddRemoteSearchLoading(false);
      setAddRemoteSearchError(null);
      return;
    }
    let cancelled = false;
    setAddRemoteSearchLoading(true);
    setAddRemoteSearchError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/stocvest/market/tickers-search?q=${encodeURIComponent(q)}`, {
            credentials: "same-origin",
            cache: "no-store"
          });
          if (cancelled) return;
          if (!res.ok) {
            setAddRemoteSearchError(`Search failed (${res.status}). Try a known symbol.`);
            setAddRemoteCandidates([]);
            return;
          }
          const j = (await res.json().catch(() => ({}))) as { items?: unknown; error?: unknown };
          const items = Array.isArray(j.items) ? j.items : [];
          const next: SymbolCandidate[] = [];
          for (const it of items) {
            if (!it || typeof it !== "object") continue;
            const o = it as { symbol?: unknown; name?: unknown };
            const sym = normalizeTickerFromApi(String(o.symbol ?? ""));
            if (!sym) continue;
            const name = String(o.name ?? "").trim();
            next.push({ symbol: sym, label: name ? `${sym} — ${name}` : sym });
          }
          const bodyError = typeof j.error === "string" ? j.error.trim() : "";
          if (!cancelled) {
            setAddRemoteCandidates(next);
            setAddRemoteSearchError(next.length === 0 && bodyError ? bodyError : null);
          }
        } catch {
          if (!cancelled) {
            setAddRemoteCandidates([]);
            setAddRemoteSearchError("Network error while searching tickers.");
          }
        } finally {
          if (!cancelled) setAddRemoteSearchLoading(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setAddRemoteSearchLoading(false);
    };
  }, [addDraft]);

  /** Issuer names from Polygon ticker-search — used when row snapshots are still empty. */
  const remoteCompanyBySymbol = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of addRemoteCandidates) {
      const sym = c.symbol.trim().toUpperCase();
      const nm = parseCompanyNameFromTickerCandidateLabel(c.label, sym);
      if (nm) m.set(sym, nm);
    }
    return m;
  }, [addRemoteCandidates]);

  const addSuggestionRows = useMemo((): WatchlistAddSuggestion[] => {
    const q = addDraft.trim();
    const onListSet = new Set(activeSymbolsDeduped);
    const onListAsCandidates: SymbolCandidate[] = activeSymbolsDeduped.map((sym) => {
      const snap = snapshotsBySymbol[sym];
      const name =
        (snap?.company_name ?? "").trim() || remoteCompanyBySymbol.get(sym) || "";
      const ms = maturationSwing[sym];
      const md = maturationDay[sym];
      let matSnippet = "";
      if (!(viewMode === "both" && dualDeskMaturation)) {
        if (viewMode === "swing" || !dualDeskMaturation) {
          matSnippet = [formatStateLabel(ms), ms?.readiness_label].filter(Boolean).join(" ").trim();
        } else if (viewMode === "day") {
          matSnippet = [formatStateLabel(md), md?.readiness_label].filter(Boolean).join(" ").trim();
        }
      }
      const base = name ? `${sym} — ${name}` : sym;
      const label = matSnippet && matSnippet !== "—" ? `${base} ${matSnippet}` : base;
      return { symbol: sym, label };
    });
    let rankedOnList: WatchlistAddSuggestion[] = [];
    if (q) {
      rankedOnList = rankSymbolCandidates(onListAsCandidates, q)
        .slice(0, 8)
        .map((c) => ({ ...c, kind: "watchlist" as const }));
    }
    const localFiltered = localAddCandidates.filter((c) => !onListSet.has(c.symbol));
    let rankedAdd: WatchlistAddSuggestion[] = [];
    if (!q) {
      rankedAdd = localFiltered.slice(0, 8).map((c) => ({ ...c, kind: "add" as const }));
    } else {
      const seenSym = new Set<string>(rankedOnList.map((r) => r.symbol));
      const merged: SymbolCandidate[] = [];
      for (const c of [...localFiltered, ...addRemoteCandidates]) {
        const sym = c.symbol.toUpperCase();
        if (seenSym.has(sym) || onListSet.has(sym)) continue;
        seenSym.add(sym);
        merged.push(c);
      }
      rankedAdd = rankSymbolCandidates(merged, q)
        .slice(0, 12)
        .map((c) => ({ ...c, kind: "add" as const }));
    }
    return [...rankedOnList, ...rankedAdd];
  }, [
    addDraft,
    addRemoteCandidates,
    localAddCandidates,
    activeSymbolsDeduped,
    snapshotsBySymbol,
    viewMode,
    dualDeskMaturation,
    maturationSwing,
    maturationDay,
    remoteCompanyBySymbol
  ]);

  const isAddCorroborated = useCallback(
    (sym: string) => {
      const u = sym.trim().toUpperCase();
      return addSuggestionRows.some((r) => r.symbol === u && r.kind === "add");
    },
    [addSuggestionRows]
  );

  useEffect(() => {
    if (!addSuggestOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = addComboRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setAddSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [addSuggestOpen]);

  useEffect(() => {
    setAddSuggestHighlight(0);
  }, [addDraft, addSuggestOpen]);

  useEffect(() => {
    setAddSuggestHighlight((h) =>
      addSuggestionRows.length ? Math.min(h, addSuggestionRows.length - 1) : 0
    );
  }, [addSuggestionRows]);

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

  async function addSymbol(symOrRaw: string, options?: { skipCorroboration?: boolean }) {
    if (!active) return;
    const raw = symOrRaw.trim();
    const sym = normalizeTickerFromApi(raw) || normalizeTickerInput(raw);
    setSymErr(null);
    if (!sym) {
      setSymErr("Enter a valid ticker.");
      return;
    }
    if (!options?.skipCorroboration && !isAddCorroborated(sym)) {
      setSymErr("No matching ticker. Choose from the list or verify the symbol.");
      return;
    }
    const cur = dedupeSymbolsUpper(active.symbols);
    if (cur.includes(sym)) {
      setSymErr("That symbol is already on your watchlist.");
      return;
    }
    const prev = rows;
    const w0 = rows[0];
    if (!w0) return;
    const optimistic: WatchlistRow[] = [
      w0.watchlist_id === active.watchlist_id ? { ...w0, symbols: [...cur, sym] } : w0
    ];
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
      setRows((r) => {
        const z = r[0];
        if (!z || z.watchlist_id !== active.watchlist_id) return r;
        const row = data as WatchlistRow;
        return [{ ...row, symbols: dedupeSymbolsUpper(row.symbols) }];
      });
      setAddDraft("");
      setAddSuggestOpen(false);
    } catch {
      setRows(prev);
      setSymErr("Network error");
    }
  }

  async function removeSymbol(sym: string) {
    if (!active) return;
    const prev = rows;
    setRows((r) => {
      const z = r[0];
      if (!z || z.watchlist_id !== active.watchlist_id) return r;
      return [{ ...z, symbols: dedupeSymbolsUpper(z.symbols.filter((s) => s.trim().toUpperCase() !== sym)) }];
    });
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
      setRows((r) => {
        const z = r[0];
        if (!z || z.watchlist_id !== active.watchlist_id) return r;
        const row = data as WatchlistRow;
        return [{ ...row, symbols: dedupeSymbolsUpper(row.symbols) }];
      });
    } catch {
      setRows(prev);
    }
  }

  async function saveRename(name: string) {
    if (!active) return;
    await patchWatchlist(active.watchlist_id, { name });
    setRename(null);
    await load();
  }

  const evaluatedLabel = useMemo(() => {
    if (!active?.is_default || activeSymbolsDeduped.length === 0) return null;
    if (maturationFetchStatus === "loading") return "Loading…";
    if (maturationFetchStatus === "error") return "Unavailable";
    if (!lastEvaluatedAt) return null;
    return lastEvaluatedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }, [active?.is_default, activeSymbolsDeduped.length, maturationFetchStatus, lastEvaluatedAt]);

  const sortedSymbols = useMemo(() => {
    if (!active) return [];
    const syms = activeSymbolsDeduped;
    if (!active.is_default || maturationFetchStatus !== "ready") {
      return [...syms].sort();
    }
    return [...syms].sort((a, b) =>
      compareSymbolsByPresentationPriority(
        a,
        b,
        symbolTrackingMap,
        maturationSwing,
        maturationDay,
        dualDeskMaturation
      )
    );
  }, [
    active,
    activeSymbolsDeduped,
    maturationFetchStatus,
    maturationSwing,
    maturationDay,
    symbolTrackingMap,
    dualDeskMaturation
  ]);

  const filteredSymbolsForList = useMemo(() => {
    const q = addDraft.trim();
    if (!q) return sortedSymbols;
    return sortedSymbols.filter((s) => {
      const symU = s.trim().toUpperCase();
      return watchlistSymbolMatchesSearch(
        symU,
        q,
        viewMode,
        dualDeskMaturation,
        snapshotsBySymbol[symU],
        maturationSwing[symU],
        maturationDay[symU],
        remoteCompanyBySymbol.get(symU)
      );
    });
  }, [
    sortedSymbols,
    addDraft,
    viewMode,
    dualDeskMaturation,
    snapshotsBySymbol,
    maturationSwing,
    maturationDay,
    remoteCompanyBySymbol
  ]);

  const statusCounts = useMemo(() => {
    const keys = ["actionable", "developing", "not_aligned", "invalidated"] as const;
    const out: Record<(typeof keys)[number], number> = {
      actionable: 0,
      developing: 0,
      not_aligned: 0,
      invalidated: 0
    };
    if (!active?.is_default || maturationFetchStatus !== "ready") return out;
    for (const sym of activeSymbolsDeduped) {
      const disp = (
        displayStateForSymbol(sym, symbolTrackingMap, maturationSwing, maturationDay, dualDeskMaturation) || ""
      ).toLowerCase();
      if (disp === "actionable") out.actionable += 1;
      else if (disp === "developing" || disp === "re_evaluating") out.developing += 1;
      else if (disp === "not_aligned") out.not_aligned += 1;
      else if (disp === "invalidated") out.invalidated += 1;
    }
    return out;
  }, [
    active,
    activeSymbolsDeduped,
    maturationFetchStatus,
    maturationSwing,
    maturationDay,
    symbolTrackingMap,
    dualDeskMaturation
  ]);

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

  const slotUsed = activeSymbolsDeduped.length;
  const slotsLeft = Math.max(0, WATCHLIST_MAX_SYMBOLS - slotUsed);
  const headerStickyStyle = {
    top: APP_TOP_BAR_LAYOUT_HEIGHT,
    background: colors.background,
    borderBottom: `1px solid ${colors.border}`
  } as const;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-visible" style={{ gap: spacing[3] }}>
      {active ? (
        <>
          <header
            className="sticky z-30 w-full max-w-none self-start -mx-4 px-4 pb-3 pt-0 lg:-mx-6 lg:px-6"
            style={headerStickyStyle}
          >
            <div className="flex flex-wrap items-start justify-between gap-2 pb-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {rename === active.watchlist_id ? (
                  <input
                    autoFocus
                    defaultValue={active.name}
                    onBlur={(e) => void saveRename(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="min-h-10 w-full max-w-xs rounded-md border px-2 text-base font-semibold"
                    style={{ borderColor: colors.border, color: colors.text, background: colors.surface }}
                    aria-label="Watchlist name"
                  />
                ) : (
                  <>
                    <h1 className="m-0 truncate text-xl font-bold tracking-tight sm:text-2xl" style={{ color: colors.text }}>
                      Watchlist
                    </h1>
                    <button
                      type="button"
                      onClick={() => setRename(active.watchlist_id)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold hover:underline"
                      style={{ color: colors.textMuted }}
                    >
                      Rename list
                    </button>
                  </>
                )}
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
              </div>
            </div>

            <div ref={addComboRef} className="relative pb-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <input
                  id="watchlist-add-ticker"
                  role="combobox"
                  aria-expanded={addSuggestOpen}
                  aria-controls="watchlist-add-ticker-suggestions"
                  aria-autocomplete="list"
                  autoComplete="off"
                  value={addDraft}
                  maxLength={80}
                  onChange={(e) => {
                    setAddDraft(e.target.value);
                    setAddSuggestOpen(true);
                    setSymErr(null);
                  }}
                  onFocus={() => setAddSuggestOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setAddSuggestOpen(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setAddSuggestOpen(false);
                      return;
                    }
                    if (e.key === "ArrowDown" && addSuggestionRows.length) {
                      e.preventDefault();
                      setAddSuggestOpen(true);
                      setAddSuggestHighlight((i) => Math.min(i + 1, addSuggestionRows.length - 1));
                      return;
                    }
                    if (e.key === "ArrowUp" && addSuggestionRows.length) {
                      e.preventDefault();
                      setAddSuggestHighlight((i) => Math.max(i - 1, 0));
                      return;
                    }
                    if (e.key === "Enter") {
                      const pick = addSuggestionRows[addSuggestHighlight];
                      if (pick) {
                        e.preventDefault();
                        if (pick.kind === "watchlist") {
                          document.getElementById(`watchlist-row-${pick.symbol}`)?.scrollIntoView({
                            block: "nearest",
                            behavior: "smooth"
                          });
                          setAddDraft("");
                          setAddSuggestOpen(false);
                          return;
                        }
                        void addSymbol(pick.symbol);
                        return;
                      }
                      const t = normalizeTickerFromApi(addDraft.trim()) || normalizeTickerInput(addDraft.trim());
                      if (!t) return;
                      e.preventDefault();
                      void addSymbol(addDraft.trim());
                    }
                  }}
                  placeholder="Search watchlist or add ticker (symbol first, then name)"
                  className="min-h-11 w-full flex-1 rounded-lg border px-3"
                  style={{
                    borderColor: colors.border,
                    background: colors.surface,
                    color: colors.text,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    letterSpacing: "0.04em",
                    fontWeight: 600
                  }}
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
                  onClick={() => {
                    const pick = addSuggestionRows[addSuggestHighlight];
                    if (pick?.kind === "watchlist") {
                      document.getElementById(`watchlist-row-${pick.symbol}`)?.scrollIntoView({
                        block: "nearest",
                        behavior: "smooth"
                      });
                      setAddDraft("");
                      setAddSuggestOpen(false);
                      return;
                    }
                    if (pick) void addSymbol(pick.symbol);
                    else void addSymbol(addDraft.trim());
                  }}
                >
                  Add
                </button>
              </div>
              {addSuggestOpen &&
              (addSuggestionRows.length > 0 ||
                (addRemoteSearchLoading && addDraft.trim().length >= 2) ||
                (Boolean(addRemoteSearchError) && addDraft.trim().length >= 2)) ? (
                <ul
                  id="watchlist-add-ticker-suggestions"
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border py-1 shadow-lg sm:right-auto sm:min-w-[min(100%,420px)]"
                  style={{
                    background: colors.surface,
                    borderColor: colors.border,
                    boxShadow: "0 12px 40px rgba(0,0,0,0.35)"
                  }}
                >
                  {addRemoteSearchError && addDraft.trim().length >= 2 ? (
                    <li className="px-3 py-2 text-sm leading-snug" style={{ color: colors.bearish }}>
                      {addRemoteSearchError}
                    </li>
                  ) : null}
                  {addRemoteSearchLoading &&
                  addSuggestionRows.length === 0 &&
                  addDraft.trim().length >= 2 &&
                  !addRemoteSearchError ? (
                    <li className="px-3 py-2 text-sm" style={{ color: colors.textMuted }}>
                      Searching…
                    </li>
                  ) : null}
                  {addSuggestionRows.map((row, idx) => (
                    <li key={`${row.kind}-${row.symbol}`} role="option" aria-selected={idx === addSuggestHighlight}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm"
                        style={{
                          background: idx === addSuggestHighlight ? "rgba(59,130,246,0.15)" : "transparent",
                          color: colors.text,
                          border: "none",
                          cursor: "pointer"
                        }}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => {
                          if (row.kind === "watchlist") {
                            document.getElementById(`watchlist-row-${row.symbol}`)?.scrollIntoView({
                              block: "nearest",
                              behavior: "smooth"
                            });
                            setAddDraft("");
                            setAddSuggestOpen(false);
                            return;
                          }
                          void addSymbol(row.symbol);
                        }}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: colors.textMuted }}>
                          {row.kind === "watchlist" ? "On your list" : "Add"}
                        </span>
                        <span className="mt-0.5 block font-semibold tracking-wide">{row.symbol}</span>
                        {row.label !== row.symbol ? (
                          <span className="block text-xs" style={{ color: colors.textMuted }}>
                            {row.label.includes("—") ? row.label.split("—").slice(1).join("—").trim() : row.label}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                  {!addRemoteSearchLoading &&
                  !addRemoteSearchError &&
                  addSuggestionRows.length === 0 &&
                  addDraft.trim().length >= 2 ? (
                    <li className="px-3 py-2 text-sm" style={{ color: colors.textMuted }}>
                      No matching tickers. Try a symbol (e.g. AAPL) or another spelling.
                    </li>
                  ) : null}
                </ul>
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
            {active.is_default && activeSymbolsDeduped.length > 0 ? (
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

            {active.is_default && activeSymbolsDeduped.length > 0 ? (
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
                Sorted by best maturation among desks you track
                {viewMode === "both" || viewMode === "day" ? " (rows respect tab + tracking)" : ""}.
              </p>
            ) : null}

            <article
              className={surfaceGlowClassName}
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl }}
            >
              {active.is_default && activeSymbolsDeduped.length > 0 ? (
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
                {activeSymbolsDeduped.length === 0 ? (
                  <div>
                    <p className="m-0 mb-3 text-sm" style={{ color: colors.textMuted }}>
                      No symbols yet. Use the bar above or tap a popular name.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void addSymbol(s, { skipCorroboration: true })}
                          className="min-h-10 rounded-md border px-3 text-sm font-bold tracking-wide"
                          style={{ borderColor: colors.accent, color: colors.text }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {activeSymbolsDeduped.length > 0 && addDraft.trim() && filteredSymbolsForList.length === 0 ? (
                      <p className="m-0 mb-3 text-sm" style={{ color: colors.textMuted }}>
                        No symbols match &quot;{addDraft.trim()}&quot; in this {viewMode} view (symbol and company name
                        {viewMode === "both" && dualDeskMaturation ? "" : "; maturation text for this desk only"}). Clear
                        the bar to see all rows, or pick &quot;Add&quot; below to add a new ticker.
                      </p>
                    ) : null}
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {filteredSymbolsForList.map((s) => {
                      const symU = s.trim().toUpperCase();
                      const ms = active.is_default ? maturationSwing[symU] : undefined;
                      const md = active.is_default && dualDeskMaturation ? maturationDay[symU] : undefined;
                      const rowTracking = trackingForSymbol(symbolTrackingMap, symU, dualDeskMaturation);
                      const displaySt = active.is_default
                        ? displayStateForSymbol(
                            symU,
                            symbolTrackingMap,
                            maturationSwing,
                            maturationDay,
                            dualDeskMaturation
                          )
                        : undefined;
                      const accent = maturationAccent(displaySt, colors as ThemeColors);
                      const href = watchlistToSignalsHref(s, tradingModeForSignalsNav(viewMode, dualDeskMaturation));
                      const quote = watchlistQuoteFromSnapshot(snapshotsBySymbol[symU]);
                      const rowLine = (mode: "swing" | "day", m: MaturationRow | undefined) => {
                        const hasMat = Boolean(m?.state || m?.label);
                        const detail = hasMat
                          ? formatStateLabel(m)
                          : maturationFetchStatus === "ready" && active.is_default
                            ? "No maturation yet — run evidence on Signals"
                            : maturationFetchStatus === "error" && active.is_default
                              ? "Could not load maturation"
                              : "…";
                        return (
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
                            <span className="flex-1 text-left text-[11px] font-medium leading-snug sm:text-sm" style={{ color: colors.text }}>
                              ● {detail}
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
                      };
                      return (
                        <li key={symU} id={`watchlist-row-${symU}`}>
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
                            <div className="relative z-[1] flex min-h-0 min-w-0 flex-1 items-start gap-3 pointer-events-none sm:gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-2">
                                  <span className="font-mono text-lg font-bold tracking-wide">{symU}</span>
                                  {maturationFetchStatus === "loading" && active.is_default ? (
                                    <span className="text-[10px] uppercase" style={{ color: colors.textMuted }}>
                                      …
                                    </span>
                                  ) : null}
                                </div>
                                {active.is_default &&
                                shouldShowDeskRow(rowTracking, "swing", viewMode, dualDeskMaturation) ? (
                                  <div className="mt-2 space-y-1.5">{rowLine("swing", ms)}</div>
                                ) : null}
                                {active.is_default &&
                                shouldShowDeskRow(rowTracking, "day", viewMode, dualDeskMaturation) ? (
                                  <div className="mt-2 space-y-1.5">{rowLine("day", md)}</div>
                                ) : null}
                              </div>
                              {quote ? (
                                <div className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
                                  <span className="font-mono text-sm font-semibold" style={{ color: colors.text }}>
                                    {quote.price}
                                  </span>
                                  {quote.pct ? (
                                    <span
                                      className="text-xs font-semibold"
                                      style={{
                                        color:
                                          quote.bullish === true
                                            ? colors.bullish
                                            : quote.bullish === false
                                              ? colors.bearish
                                              : colors.textMuted
                                      }}
                                    >
                                      {quote.pct}
                                    </span>
                                  ) : null}
                                </div>
                              ) : snapshotFetchStatus === "loading" ? (
                                <span className="shrink-0 pt-0.5 text-xs" style={{ color: colors.textMuted }}>
                                  …
                                </span>
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
                  </>
                )}
              </div>
            </article>

            <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
              Your watchlist feeds the scanner. Maturation reflects your last evidence run or the scheduled refresh.
              <Link href="/dashboard/signals" className="ml-1 font-semibold" style={{ color: colors.accent }}>
                Open Signals
              </Link>
            </p>
          </div>
        </>
      ) : (
        <p style={{ color: colors.textMuted }}>Could not load your watchlist.</p>
      )}
    </div>
  );
}
