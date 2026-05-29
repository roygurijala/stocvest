"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import type { CreateJournalEntryRequest, JournalAnalyticsPayload, JournalEntryPayload } from "@/lib/api/contracts";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { Area, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InfoTip } from "@/components/info-tip";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useTheme } from "@/lib/theme-provider";
import { AVG_LOSER_TIP, AVG_WINNER_TIP, EXPECTANCY_TIP, STREAK_TIP, WIN_RATE_TIP } from "@/lib/ui-tooltips";

interface JournalPageClientProps {
  initialEntries: JournalEntryPayload[];
  initialAnalytics: JournalAnalyticsPayload;
  connectedBroker: string | null;
}

function setupChipMeta(setupType: string | null | undefined, strategyTags: string[]): { label: string; gold?: boolean } {
  const raw = (setupType || strategyTags[0] || "").trim().toLowerCase();
  if (!raw) return { label: "Manual" };
  if (raw.includes("confluence")) return { label: "CONFLUENCE", gold: true };
  const map: Record<string, string> = {
    orb_breakout_long: "ORB Long",
    orb_breakout_short: "ORB Short",
    vwap_reclaim: "VWAP",
    pre_market_gap: "Gap",
    gap_intelligence: "Gap",
    intraday_pattern: "Intraday",
    intraday_setup: "Intraday"
  };
  return { label: map[raw] || raw.replace(/_/g, " ").slice(0, 18) };
}

function JournalSignalsDeepLink(props: { href: string; className: string; style: CSSProperties; children: ReactNode }) {
  const hp = useHoverPrefetch(props.href);
  return (
    <Link
      prefetch={false}
      data-hover-prefetch="true"
      href={props.href}
      onMouseEnter={hp.onMouseEnter}
      onFocus={hp.onFocus}
      onPointerDown={hp.onPointerDown}
      className={props.className}
      style={props.style}
    >
      {props.children}
    </Link>
  );
}

function positionSideLabel(openingSide: "buy" | "sell"): string {
  return openingSide === "buy" ? "Long" : "Short";
}

function statusChip(
  entry: JournalEntryPayload,
  colors: { bullish: string; bearish: string; caution: string; textMuted: string; border: string }
): { label: string; bg: string; fg: string; border: string } {
  if (entry.status === "open") {
    return { label: "OPEN", bg: "rgba(245,158,11,0.15)", fg: colors.caution, border: "rgba(245,158,11,0.45)" };
  }
  if (entry.status === "cancelled") {
    return { label: "CXL", bg: "transparent", fg: colors.textMuted, border: colors.border };
  }
  const o = entry.outcome;
  if (o === "win") return { label: "WIN", bg: "rgba(34,197,94,0.15)", fg: colors.bullish, border: "rgba(34,197,94,0.45)" };
  if (o === "loss") return { label: "LOSS", bg: "rgba(239,68,68,0.12)", fg: colors.bearish, border: "rgba(239,68,68,0.45)" };
  return { label: "B/E", bg: "rgba(148,163,184,0.12)", fg: colors.textMuted, border: colors.border };
}

function unrealizedPnlUsd(entry: JournalEntryPayload, last: number | null | undefined): number | null {
  if (entry.status !== "open" || typeof entry.entry_price_avg !== "number" || last == null || !Number.isFinite(last)) {
    return null;
  }
  const q = entry.quantity;
  if (entry.opening_side === "buy") {
    return (last - entry.entry_price_avg) * q;
  }
  return (entry.entry_price_avg - last) * q;
}

export function JournalPageClient({ initialEntries, initialAnalytics, connectedBroker }: JournalPageClientProps) {
  const { colors } = useTheme();
  const [entries, setEntries] = useState(initialEntries);

  usePublishAssistantContext({ page: "dashboard/journal" });
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [sortDesc, setSortDesc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [quoteBySymbol, setQuoteBySymbol] = useState<Record<string, number | null>>({});

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    setAnalytics(initialAnalytics);
  }, [initialAnalytics]);

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) =>
      sortDesc ? Date.parse(b.opened_at) - Date.parse(a.opened_at) : Date.parse(a.opened_at) - Date.parse(b.opened_at)
    );
  }, [entries, sortDesc]);

  const openSymbolsKey = useMemo(() => {
    const syms = new Set<string>();
    for (const e of entries) {
      if (e.status === "open" && typeof e.entry_price_avg === "number") {
        syms.add(e.symbol.trim().toUpperCase());
      }
    }
    return [...syms].sort().join(",");
  }, [entries]);

  useEffect(() => {
    if (!openSymbolsKey) return;
    const openSymbols = openSymbolsKey.split(",").filter(Boolean);
    let cancelled = false;
    void (async () => {
      const next: Record<string, number | null> = {};
      await Promise.all(
        openSymbols.map(async (sym) => {
          const snap = await fetchSymbolSnapshot(sym);
          if (cancelled) return;
          const p = snap?.last_trade_price;
          next[sym] = typeof p === "number" && Number.isFinite(p) ? p : null;
        })
      );
      if (!cancelled) setQuoteBySymbol((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [openSymbolsKey]);

  const chartData = useMemo(() => {
    const closed = entries
      .filter((e) => e.status === "closed" && typeof e.pnl_realized_usd === "number" && e.closed_at)
      .sort((a, b) => Date.parse(a.closed_at!) - Date.parse(b.closed_at!));
    if (closed.length === 0) {
      const d = new Date().toISOString().slice(0, 10);
      return [{ date: d, pnl: 0 }];
    }
    let running = 0;
    return closed.map((entry) => {
      running += entry.pnl_realized_usd || 0;
      return { date: (entry.closed_at || "").slice(0, 10), pnl: Number(running.toFixed(2)) };
    });
  }, [entries]);

  const hasRealizedCurve = entries.some((e) => e.status === "closed" && typeof e.pnl_realized_usd === "number");
  const lastPnl = chartData.length ? chartData[chartData.length - 1].pnl : 0;
  const lineStroke = lastPnl >= 0 ? colors.bullish : colors.bearish;

  const streakDisplay = useMemo(() => {
    const s = analytics.current_streak;
    if (s > 0) return { text: `+${s}`, color: colors.bullish };
    if (s < 0) return { text: String(s), color: colors.bearish };
    return { text: "0", color: colors.textMuted };
  }, [analytics.current_streak, colors.bearish, colors.bullish, colors.textMuted]);

  async function handleCreateEntry(formData: FormData) {
    const symbol = String(formData.get("symbol") || "").toUpperCase().trim();
    const quantity = Number(formData.get("quantity") || 0);
    const side = String(formData.get("side") || "buy") as "buy" | "sell";
    if (!symbol || quantity <= 0) {
      return;
    }
    startTransition(async () => {
      try {
        const entry_id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `manual-${Date.now()}`;
        const reqBody: CreateJournalEntryRequest = {
          entry_id,
          symbol,
          opening_side: side,
          quantity,
          is_day_trade: true,
          entry_notes: "Manual entry",
          strategy_tags: ["manual"]
        };
        const res = await fetch("/api/stocvest/journal/entries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(reqBody)
        });
        const created = (await res.json()) as JournalEntryPayload;
        if (!res.ok || !created?.entry_id) {
          throw new Error("create failed");
        }
        setEntries((prev) => [created, ...prev]);
        setShowModal(false);
      } catch {
        /* surface via alert minimal */
        window.alert("Could not save journal entry. Try again.");
      }
    });
  }

  const showSetupInsight = analytics.total_trades >= 5 && (analytics.best_setup_type || analytics.worst_setup_type);

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg sm:text-xl" style={{ margin: 0 }}>
          Trade Journal
        </h2>
        <button
          type="button"
          className="min-h-11 w-full sm:w-auto"
          onClick={() => setShowModal(true)}
          style={{
            border: `1px solid ${colors.accent}`,
            background: "rgba(59,130,246,.12)",
            color: colors.accent,
            borderRadius: borderRadius.md,
            padding: `${spacing[2]} ${spacing[3]}`
          }}
        >
          Add Entry
        </button>
      </div>

      <div className="journal-stats-grid grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          ["Win Rate", `${(analytics.win_rate * 100).toFixed(1)}%`, WIN_RATE_TIP],
          ["Total Trades", String(analytics.total_trades), ""],
          ["Avg Winner", `$${analytics.avg_winner_dollars.toFixed(2)}`, AVG_WINNER_TIP],
          ["Avg Loser", `-$${analytics.avg_loser_dollars.toFixed(2)}`, AVG_LOSER_TIP],
          ["Expectancy", `$${analytics.expectancy.toFixed(2)}`, EXPECTANCY_TIP],
          ["Streak", streakDisplay.text, STREAK_TIP]
        ].map(([k, v, tip], idx) => (
          <article
            key={k}
            className={surfaceGlowClassName}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              padding: spacing[3]
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], marginBottom: spacing[1] }}>
              <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>{k}</p>
              {tip ? <InfoTip text={String(tip)} label={`About ${k}`} /> : null}
            </div>
            <strong style={idx === 5 ? { color: streakDisplay.color } : undefined}>{v}</strong>
          </article>
        ))}
      </div>

      {showSetupInsight ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {analytics.best_setup_type ? (
            <div
              style={{
                borderRadius: borderRadius.lg,
                padding: spacing[3],
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.35)",
                fontSize: typography.scale.sm
              }}
            >
              <strong>Best setup:</strong> {analytics.best_setup_type.replace(/_/g, " ")}
              {typeof analytics.best_setup_sample_size === "number" && analytics.best_setup_sample_size > 0
                ? ` — based on ${analytics.best_setup_sample_size} trades`
                : null}
            </div>
          ) : null}
          {analytics.worst_setup_type ? (
            <div
              style={{
                borderRadius: borderRadius.lg,
                padding: spacing[3],
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                fontSize: typography.scale.sm,
                color: colors.text
              }}
            >
              <strong>Weakest:</strong> {analytics.worst_setup_type.replace(/_/g, " ")}
              {typeof analytics.worst_setup_sample_size === "number" && analytics.worst_setup_sample_size > 0
                ? ` — based on ${analytics.worst_setup_sample_size} trades`
                : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <h3 style={{ marginTop: 0 }}>Cumulative P&L</h3>
        <div className="h-[200px] lg:h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="stocvestPnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineStroke} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={lineStroke} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: colors.textMuted, fontSize: 11 }} />
              <YAxis tick={{ fill: colors.textMuted, fontSize: 11 }} width={56} />
              <Tooltip contentStyle={{ background: colors.surface, border: `1px solid ${colors.border}` }} />
              <Area type="monotone" dataKey="pnl" stroke="none" fill="url(#stocvestPnlFill)" isAnimationActive={false} />
              <Line type="monotone" dataKey="pnl" stroke={lineStroke} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {!hasRealizedCurve ? (
          <p style={{ margin: `${spacing[2]} 0 0 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
            Start trading to build your performance chart — line stays at $0 until closed trades include realized P&amp;L.
          </p>
        ) : null}
      </article>

      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 style={{ marginTop: 0 }}>Trade History</h3>
          <button
            type="button"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => setSortDesc((v) => !v)}
            style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, background: "transparent", color: colors.text, padding: spacing[2] }}
          >
            Sort by date {sortDesc ? "↓" : "↑"}
          </button>
        </div>
        <div className="-mx-1 overflow-x-auto px-1 sm:mx-0 sm:px-0" style={{ WebkitOverflowScrolling: "touch" }}>
          <table className="min-w-[860px]" style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
            <thead>
              <tr style={{ color: colors.textMuted }}>
                <th align="left">Date</th>
                <th align="left">Symbol</th>
                <th align="left">Side</th>
                <th align="left">Qty</th>
                <th align="left">Entry</th>
                <th align="left">Exit</th>
                <th align="left">P&amp;L</th>
                <th align="left">Setup</th>
                <th align="left">Signal</th>
                <th align="left">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => {
                const setupMeta = setupChipMeta(entry.setup_type ?? null, entry.strategy_tags || []);
                const st = statusChip(entry, colors);
                const last = quoteBySymbol[entry.symbol.trim().toUpperCase()];
                const unreal = unrealizedPnlUsd(entry, last);
                return (
                  <Fragment key={entry.entry_id}>
                    <tr
                      onClick={() => setExpandedId(expandedId === entry.entry_id ? null : entry.entry_id)}
                      style={{ borderTop: `1px solid ${colors.border}`, cursor: "pointer" }}
                    >
                      <td>{entry.opened_at.slice(0, 10)}</td>
                      <td>{entry.symbol}</td>
                      <td>{positionSideLabel(entry.opening_side)}</td>
                      <td>{entry.quantity}</td>
                      <td style={{ fontFamily: typography.fontFamilyMono }}>
                        {typeof entry.entry_price_avg === "number" ? `$${entry.entry_price_avg.toFixed(2)}` : "—"}
                      </td>
                      <td style={{ fontFamily: typography.fontFamilyMono }}>
                        {typeof entry.exit_price_avg === "number" ? `$${entry.exit_price_avg.toFixed(2)}` : "—"}
                      </td>
                      <td style={{ fontFamily: typography.fontFamilyMono }}>
                        {entry.status === "closed" && typeof entry.pnl_realized_usd === "number" ? (
                          <span style={{ color: entry.pnl_realized_usd >= 0 ? colors.bullish : colors.bearish }}>
                            ${entry.pnl_realized_usd.toFixed(2)}
                          </span>
                        ) : entry.status === "open" && unreal != null ? (
                          <span style={{ color: unreal >= 0 ? colors.bullish : colors.bearish }}>~${unreal.toFixed(0)}</span>
                        ) : entry.status === "open" ? (
                          <span style={{ color: colors.textMuted }}>~</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: setupMeta.gold ? "linear-gradient(135deg, #b8860b, #f5c542)" : "rgba(148,163,184,0.15)",
                            color: setupMeta.gold ? "#1a1200" : setupMeta.label === "Manual" ? colors.textMuted : colors.text,
                            border: setupMeta.gold ? "none" : `1px solid ${colors.border}`
                          }}
                        >
                          {setupMeta.label}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {entry.signal_id || entry.signal_strength != null ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {typeof entry.signal_strength === "number" ? (
                              <JournalSignalsDeepLink
                                href={
                                  entry.signal_id
                                    ? `/dashboard/signals?${new URLSearchParams({ signal_id: entry.signal_id, ref: "journal" }).toString()}`
                                    : "/dashboard/signals?ref=journal"
                                }
                                className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold no-underline"
                                style={{
                                  border: `1px solid ${colors.border}`,
                                  color:
                                    (entry.signal_direction || "").toLowerCase() === "bearish" ? colors.bearish : colors.bullish,
                                  background: "rgba(59,130,246,0.08)"
                                }}
                              >
                                {entry.signal_strength}% signal
                              </JournalSignalsDeepLink>
                            ) : (
                              <JournalSignalsDeepLink
                                href={
                                  entry.signal_id
                                    ? `/dashboard/signals?${new URLSearchParams({ signal_id: entry.signal_id, ref: "journal" }).toString()}`
                                    : "/dashboard/signals?ref=journal"
                                }
                                className="text-[11px] no-underline"
                                style={{ color: colors.accent }}
                              >
                                Linked
                              </JournalSignalsDeepLink>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: colors.textMuted }}>—</span>
                        )}
                      </td>
                      <td>
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                          style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}` }}
                        >
                          {st.label}
                        </span>
                      </td>
                    </tr>
                    {expandedId === entry.entry_id ? (
                      <tr style={{ borderTop: `1px dashed ${colors.border}` }}>
                        <td colSpan={10} style={{ color: colors.textMuted, fontSize: typography.scale.sm, padding: spacing[2] }}>
                          {entry.entry_notes || "No notes on this entry."}
                          {analytics.disclaimer ? (
                            <>
                              <br />
                              <span style={{ fontSize: typography.scale.xs }}>{analytics.disclaimer}</span>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {entries.length === 0 ? (
          <div style={{ color: colors.textMuted, marginTop: spacing[2] }}>
            <p style={{ margin: 0 }}>No trades yet. Connect a broker to enable automatic capture.</p>
            {connectedBroker ? (
              <p style={{ margin: `${spacing[2]} 0 0` }}>
                Connected to <strong style={{ color: colors.text }}>{connectedBroker}</strong>. Your first trade will appear here automatically after it fills.
              </p>
            ) : null}
          </div>
        ) : null}
      </article>

      {showModal ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 60 }}>
          <form
            action={handleCreateEntry}
            className={surfaceGlowClassName}
            style={{
              width: "min(460px,92vw)",
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4],
              display: "grid",
              gap: spacing[2]
            }}
          >
            <h3 style={{ marginTop: 0 }}>Manual Journal Entry</h3>
            <input name="symbol" placeholder="Symbol" required style={{ padding: spacing[2] }} />
            <input name="quantity" placeholder="Quantity" type="number" min="1" required style={{ padding: spacing[2] }} />
            <select name="side" style={{ padding: spacing[2] }}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <div style={{ display: "flex", gap: spacing[2], justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
