"use client";

/**
 * Trading Room — "Your monitored universe" rail.
 *
 * A collapsible third panel listing the user's default-watchlist symbols as
 * state-aware cards (mapped into the same actionable / near / potential /
 * cooling vocabulary as the signal feed), each expandable into a compact
 * state-change timeline. Selecting a card opens its Deep Dive.
 *
 * Data is composed exactly like `DashboardWatchlistRadar` (default symbols +
 * maturation summary + snapshots), refreshed live via the maturation reload
 * nonce. The notify toggle is wired to the real global watchlist-maturation
 * email preference (there is no per-symbol alert surface yet).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelRightClose } from "lucide-react";
import { borderRadius, roleAccents, spacing, typography } from "@/lib/design-system";
import type { useTheme } from "@/lib/theme-provider";
import type { SnapshotPayload } from "@/lib/api/market";
import {
  formatWatchlistMaturationLabel,
  watchlistQuoteFromSnapshot,
  type WatchlistMaturationRow
} from "@/lib/watchlist-page-utils";
import { parseMaturationSummaryEnvelope } from "@/lib/watchlist/maturation-summary-envelope";
import { useWatchlistMaturationReloadNonce } from "@/lib/hooks/use-watchlist-maturation-reload";
import { FeedCardUpdatedLine } from "@/lib/dashboard/trading-room/feed-card-present";
import { WATCHLIST_SYMBOLS_CHANGED_EVENT } from "@/lib/watchlist-membership-client";
import { fetchSetupEvolution, type SetupEvolutionResponse } from "@/lib/api/setup-evolution";
import {
  formatMaturationStateLine,
  formatStartedTracking,
  formatTransitionTimelineRow
} from "@/lib/setup-evolution-present";
import type { FeedBias, FeedCard, FeedLane, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import { useSymbolName } from "@/lib/hooks/use-symbol-names";

type Colors = ReturnType<typeof useTheme>["colors"];

const STATE_LABEL: Record<FeedState, string> = {
  actionable: "Actionable",
  near: "Near",
  potential: "Tracking",
  cooling: "Re-evaluating"
};

function stateTone(state: FeedState, colors: Colors): string {
  if (state === "actionable") return colors.bullish;
  if (state === "near") return colors.caution;
  if (state === "cooling") return colors.bearish;
  return colors.textMuted;
}

function mapMaturationState(row: WatchlistMaturationRow): FeedState {
  const band = row.progress_band;
  const state = (row.state || "").toLowerCase();
  if (state.includes("invalid") || state.includes("re_eval") || state.includes("reeval")) return "cooling";
  if (band === "actionable" || state === "actionable") return "actionable";
  if (band === "near_ready" || state.includes("near")) return "near";
  return "potential";
}

function mapBias(bias: string | undefined): FeedBias {
  const b = (bias || "").trim().toLowerCase();
  if (b === "long" || b === "bull" || b === "bullish") return "bull";
  if (b === "short" || b === "bear" || b === "bearish") return "bear";
  return "neutral";
}

function cleanNum(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function cardFromWatchlist(
  symbol: string,
  row: WatchlistMaturationRow | undefined,
  snap: SnapshotPayload | undefined,
  company: string | null,
  mode: FeedLane,
  liveBias?: string | null
): FeedCard {
  const r = row ?? {};
  const state = mapMaturationState(r);
  const aligned = cleanNum(r.layers_aligned);
  const total = cleanNum(r.layers_total) ?? 6;
  const verdict =
    aligned != null
      ? formatMaturationStateLine(r.state || r.label || state, aligned, total)
      : formatWatchlistMaturationLabel(r);
  // Use live composite bias when available, fall back to maturation bias
  const effectiveBias = liveBias ?? r.bias;
  return {
    id: `${mode}:${symbol}`,
    symbol,
    company,
    lane: mode,
    state,
    bias: mapBias(effectiveBias),
    verdict,
    phase: r.readiness_label?.trim() || null,
    price: cleanNum(snap?.last_trade_price) ?? cleanNum(snap?.day_close),
    changePct: cleanNum(snap?.change_percent),
    alignment: aligned != null ? { aligned, total } : null,
    rankScore: aligned ?? 0,
    source: "desk",
    lastEvaluatedAt: r.last_evaluated_at?.trim() || null
  };
}

const STATE_RANK: Record<FeedState, number> = { actionable: 0, near: 1, potential: 2, cooling: 3 };

function biasPill(bias: FeedBias, colors: Colors) {
  const tone = bias === "bull" ? colors.bullish : bias === "bear" ? colors.bearish : colors.textMuted;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: tone,
        background: `${tone}1f`,
        padding: "1px 6px",
        borderRadius: borderRadius.full
      }}
    >
      {bias === "bull" ? "Long" : bias === "bear" ? "Short" : "Neutral"}
    </span>
  );
}

function AlignmentDots({ aligned, total, tone, colors }: { aligned: number; total: number; tone: string; colors: Colors }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: i < aligned ? tone : colors.border
          }}
        />
      ))}
    </span>
  );
}

function RailTimeline({ symbol, mode, colors }: { symbol: string; mode: FeedLane; colors: Colors }) {
  const [data, setData] = useState<SetupEvolutionResponse | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setData(undefined);
    void fetchSetupEvolution(symbol, mode).then((res) => {
      if (alive) setData(res);
    });
    return () => {
      alive = false;
    };
  }, [symbol, mode]);

  if (data === undefined) {
    return <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Loading history…</span>;
  }
  const transitions = data?.transitions ?? [];
  const started = formatStartedTracking(data?.started_tracking_at ?? null);
  if (transitions.length === 0) {
    return (
      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
        {started ? `Tracking since ${started}. No state changes yet.` : "No state-change history yet."}
      </span>
    );
  }
  const recent = [...transitions].slice(-5).reverse();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
      {recent.map((t, i) => {
        const row = formatTransitionTimelineRow(t);
        return (
          <div key={`${t.recorded_at}-${i}`} style={{ display: "flex", gap: spacing[2], alignItems: "baseline" }}>
            <span style={{ fontSize: 10, width: 38, flexShrink: 0, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
              {row.dateLabel}
            </span>
            <span style={{ fontSize: 11 }}>{row.dot}</span>
            <span style={{ fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.4 }}>{row.line}</span>
          </div>
        );
      })}
      {started ? (
        <span style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>Tracking since {started}</span>
      ) : null}
    </div>
  );
}

function RailCard({
  card,
  active,
  expanded,
  onSelect,
  onToggleExpand,
  colors
}: {
  card: FeedCard;
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  colors: Colors;
}) {
  const sTone = stateTone(card.state, colors);
  const laneAccent =
    card.lane === "day" ? roleAccents.dark.day.borderAccent : roleAccents.dark.swing.borderAccent;
  const pct = card.changePct;
  const pctTone = pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
  const autoCompany = useSymbolName(card.company ? undefined : card.symbol);
  const company = card.company || autoCompany || null;
  return (
    <div
      style={{
        background: active ? colors.surfaceMuted : colors.surface,
        border: `1px solid ${active ? colors.accent : colors.border}`,
        borderLeft: `3px solid ${laneAccent}`,
        borderBottom: `3px solid ${sTone}`,
        borderRadius: borderRadius.md,
        opacity: card.state === "cooling" ? 0.78 : 1
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: spacing[2],
          display: "flex",
          flexDirection: "column",
          gap: 3,
          color: colors.text
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: spacing[2] }}>
          <span style={{ fontSize: typography.scale.sm, fontWeight: 700 }}>{card.symbol}</span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: pctTone }}>
              {card.price != null ? `$${card.price.toFixed(2)}` : "—"}
            </span>
            {pct != null ? (
              <span style={{ fontSize: 9, color: pctTone }}>{`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}</span>
            ) : null}
          </span>
        </div>
        {company ? (
          <span style={{ fontSize: 10, color: colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {company}
          </span>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: spacing[2], marginTop: 1 }}>
          {biasPill(card.bias, colors)}
          <span style={{ fontSize: 9, fontWeight: 700, color: sTone }}>{STATE_LABEL[card.state]}</span>
          {card.alignment ? (
            <AlignmentDots aligned={card.alignment.aligned} total={card.alignment.total} tone={sTone} colors={colors} />
          ) : null}
        </div>
        <FeedCardUpdatedLine iso={card.lastEvaluatedAt} colors={colors} />
      </button>
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        aria-label={expanded ? "Hide history" : "Show history"}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          borderTop: `1px solid ${colors.border}`,
          color: colors.textMuted,
          fontSize: 10,
          fontWeight: 600,
          cursor: "pointer",
          padding: "4px 8px",
          textAlign: "left"
        }}
      >
        {expanded ? "▾ Hide history" : "▸ State history"}
      </button>
      {expanded ? (
        <div style={{ padding: `0 ${spacing[2]} ${spacing[2]}` }}>
          <RailTimeline symbol={card.symbol} mode={card.lane} colors={colors} />
        </div>
      ) : null}
    </div>
  );
}

function NotifyToggle({ colors }: { colors: Colors }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/stocvest/alerts/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && typeof j === "object") {
          setOn(Boolean((j as { on_watchlist_maturation?: boolean }).on_watchlist_maturation ?? true));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(() => {
    if (on == null || saving) return;
    const next = !on;
    setOn(next);
    setSaving(true);
    void fetch("/api/stocvest/alerts/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on_watchlist_maturation: next })
    })
      .catch(() => setOn(!next))
      .finally(() => setSaving(false));
  }, [on, saving]);

  if (on == null) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      title="Email me when a watched setup changes state"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: on ? `${colors.accent}22` : "transparent",
        border: `1px solid ${on ? colors.accent : colors.border}`,
        borderRadius: borderRadius.full,
        color: on ? colors.text : colors.textMuted,
        fontSize: 10,
        fontWeight: 600,
        padding: "3px 8px",
        cursor: "pointer"
      }}
    >
      {on ? "🔔" : "🔕"} Alerts {on ? "on" : "off"}
    </button>
  );
}

export function WatchlistRail({
  mode,
  selectedId,
  onSelectCard,
  companyBySymbol,
  open,
  onToggleOpen,
  isMobile = false,
  colors,
  liveBiasBySymbol
}: {
  mode: FeedLane;
  selectedId: string | null;
  onSelectCard: (card: FeedCard) => void;
  companyBySymbol: Map<string, string>;
  open: boolean;
  onToggleOpen: () => void;
  isMobile?: boolean;
  colors: Colors;
  /** Live composite bias by symbol (e.g., from current signal) to override stale maturation bias */
  liveBiasBySymbol?: Map<string, string>;
}) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [bySymbol, setBySymbol] = useState<Record<string, WatchlistMaturationRow>>({});
  const [snaps, setSnaps] = useState<Map<string, SnapshotPayload>>(new Map());
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reloadNonce, bumpReloadNonce] = useWatchlistMaturationReloadNonce();
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  // Escape closes the panel — a discoverable, standard way out when it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onToggleOpen]);
  const [symbolsNonce, setSymbolsNonce] = useState(0);

  useEffect(() => {
    const onChanged = () => setSymbolsNonce((n) => n + 1);
    window.addEventListener(WATCHLIST_SYMBOLS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(WATCHLIST_SYMBOLS_CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      const retryable = new Set([502, 503, 504]);
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      try {
        let wlRes: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          wlRes = await fetch("/api/stocvest/watchlists/default/symbols", { cache: "no-store" });
          if (wlRes.ok || !retryable.has(wlRes.status) || attempt === 2) break;
          await sleep(600 * (attempt + 1));
        }
        const matRes = await fetch(`/api/stocvest/watchlists/maturation-summary?mode=${encodeURIComponent(mode)}`, {
          cache: "no-store"
        });
        if (cancelled) return;
        const wlJson = wlRes?.ok ? await wlRes.json().catch(() => ({})) : {};
        const matJson = matRes.ok ? await matRes.json().catch(() => ({})) : {};
        const symList = Array.isArray((wlJson as { symbols?: unknown }).symbols)
          ? ((wlJson as { symbols: string[] }).symbols || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean)
          : [];
        const env = parseMaturationSummaryEnvelope(matJson);
        if (cancelled) return;
        setSymbols(symList);
        setBySymbol(env.bySymbol);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, reloadNonce, symbolsNonce]);

  useEffect(() => {
    if (symbols.length === 0) {
      setSnaps(new Map());
      return;
    }
    let cancelled = false;
    const chunk = symbols.slice(0, 40);
    void (async () => {
      try {
        const res = await fetch(`/api/stocvest/market/snapshots?symbols=${encodeURIComponent(chunk.join(","))}`, {
          cache: "no-store"
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
        const rows = Array.isArray(json.snapshots) ? json.snapshots : [];
        if (cancelled) return;
        const next = new Map<string, SnapshotPayload>();
        for (const row of rows) {
          const sym = (row.symbol || "").trim().toUpperCase();
          if (sym) next.set(sym, row);
        }
        setSnaps(next);
      } catch {
        /* snapshots are best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbols, reloadNonce]);

  const cards = useMemo(() => {
    const list = symbols.map((sym) =>
      cardFromWatchlist(
        sym,
        bySymbol[sym],
        snaps.get(sym),
        snaps.get(sym)?.company_name?.trim() || companyBySymbol.get(sym) || null,
        mode,
        liveBiasBySymbol?.get(sym)
      )
    );
    return list.sort((a, b) => {
      const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
      if (byState !== 0) return byState;
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [symbols, bySymbol, snaps, companyBySymbol, mode, liveBiasBySymbol]);

  if (!open) {
    // Mobile: a full-width horizontal toggle bar; desktop: a thin vertical rail.
    return (
      <button
        type="button"
        onClick={onToggleOpen}
        aria-label="Open watchlist"
        title="Your monitored universe"
        style={{
          alignSelf: "stretch",
          width: isMobile ? "100%" : undefined,
          writingMode: isMobile ? "horizontal-tb" : "vertical-rl",
          display: "flex",
          alignItems: "center",
          justifyContent: isMobile ? "space-between" : "center",
          gap: spacing[2],
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          color: colors.textMuted,
          fontSize: typography.scale.xs,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
          padding: isMobile ? `${spacing[3]} ${spacing[4]}` : `${spacing[3]} ${spacing[2]}`,
          // Desktop: keep the rail full-viewport-tall and sticky so the vertical
          // label stays centered in the page as the user scrolls.
          position: isMobile ? "static" : "sticky",
          top: isMobile ? undefined : spacing[3],
          height: isMobile ? undefined : "calc(100vh - 200px)"
        }}
      >
        <span>{isMobile ? "Your watchlist" : "Watchlist"} {symbols.length ? `· ${symbols.length}` : ""}</span>
        <span aria-hidden>{isMobile ? "▾" : "◂"}</span>
      </button>
    );
  }

  return (
    <aside
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: spacing[3],
        display: "flex",
        flexDirection: "column",
        gap: spacing[3],
        maxHeight: isMobile ? undefined : "calc(100vh - 220px)",
        position: isMobile ? "static" : "sticky",
        top: isMobile ? undefined : spacing[3]
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[2] }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Your watch · {symbols.length}
          </span>
          {lastRefreshTime && (
            <span style={{ fontSize: 10, color: colors.textMuted }}>
              Updated {lastRefreshTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
          <NotifyToggle colors={colors} />
          <button
            type="button"
            onClick={() => {
              bumpReloadNonce();
              setLastRefreshTime(new Date());
            }}
            aria-label="Refresh watchlist"
            title="Refresh watchlist data"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: colors.surfaceMuted,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              color: colors.text,
              cursor: "pointer",
              fontSize: typography.scale.xs,
              fontWeight: 600,
              padding: "4px 10px"
            }}
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            onClick={onToggleOpen}
            aria-label="Close watchlist panel"
            title="Close panel (Esc)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              color: colors.textMuted,
              cursor: "pointer",
              fontSize: typography.scale.xs,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: `4px 8px`
            }}
          >
            <PanelRightClose size={14} aria-hidden />
            Close
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: spacing[2], overflowY: "auto" }}>
        {status === "loading" && cards.length === 0 ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Loading watchlist…</span>
        ) : status === "error" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
            <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.bearish, lineHeight: 1.5 }}>
              Could not load watchlist data. Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={() => setSymbolsNonce((n) => n + 1)}
              style={{
                alignSelf: "flex-start",
                border: `1px solid ${colors.border}`,
                background: "transparent",
                color: colors.text,
                fontSize: typography.scale.xs,
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: 6,
                cursor: "pointer"
              }}
            >
              Retry
            </button>
          </div>
        ) : cards.length === 0 ? (
          <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
            Your watchlist is empty. Add symbols from any setup or use the header search to start monitoring names.
          </p>
        ) : (
          cards.map((card) => (
            <RailCard
              key={card.id}
              card={card}
              active={card.id === selectedId}
              expanded={expanded === card.id}
              onSelect={() => onSelectCard(card)}
              onToggleExpand={() => setExpanded((cur) => (cur === card.id ? null : card.id))}
              colors={colors}
            />
          ))
        )}
      </div>
    </aside>
  );
}
