"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import type { JournalEntryPayload } from "@/lib/api/contracts";
import { Area, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InfoTip } from "@/components/info-tip";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { AVG_LOSER_TIP, AVG_WINNER_TIP, EXPECTANCY_TIP, STREAK_TIP, WIN_RATE_TIP } from "@/lib/ui-tooltips";
import { fetchLiveSignals, formatHorizonOutcome, type PublicSignal } from "@/lib/api/public-signals";

interface JournalPageClientProps {
  initialEntries: JournalEntryPayload[];
}

function signalChipLabel(entry: JournalEntryPayload): string {
  if (!entry.signal_id) return "Manual entry";
  const raw = (entry.signal_direction || "signal").toLowerCase();
  const dir = raw === "bullish" || raw === "bearish" || raw === "neutral" ? raw : "signal";
  const t = entry.signal_generated_at
    ? new Date(entry.signal_generated_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";
  return `${entry.symbol} ${dir}${t ? ` ${t}` : ""}`;
}

export function JournalPageClient({ initialEntries }: JournalPageClientProps) {
  const { colors } = useTheme();
  const [entries, setEntries] = useState(initialEntries);
  const [sortDesc, setSortDesc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [signalDetail, setSignalDetail] = useState<PublicSignal | null>(null);
  const [signalDetailOpen, setSignalDetailOpen] = useState(false);

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) =>
      sortDesc
        ? Date.parse(b.opened_at) - Date.parse(a.opened_at)
        : Date.parse(a.opened_at) - Date.parse(b.opened_at)
    );
  }, [entries, sortDesc]);

  const stats = useMemo(() => {
    const closed = entries.filter((e) => typeof e.pnl_realized_usd === "number");
    const winners = closed.filter((e) => (e.pnl_realized_usd || 0) > 0);
    const losers = closed.filter((e) => (e.pnl_realized_usd || 0) < 0);
    const winRate = closed.length ? (winners.length / closed.length) * 100 : 0;
    const avgWinner = winners.length ? winners.reduce((s, e) => s + (e.pnl_realized_usd || 0), 0) / winners.length : 0;
    const avgLoser = losers.length ? losers.reduce((s, e) => s + (e.pnl_realized_usd || 0), 0) / losers.length : 0;
    const expectancy = (winRate / 100) * avgWinner + (1 - winRate / 100) * avgLoser;
    return { winRate, totalTrades: entries.length, avgWinner, avgLoser, expectancy };
  }, [entries]);

  const chartData = useMemo(() => {
    const withPnl = sorted.filter((e) => typeof e.pnl_realized_usd === "number");
    if (withPnl.length === 0) {
      const d = new Date().toISOString().slice(0, 10);
      return [{ date: d, pnl: 0 }];
    }
    let running = 0;
    return [...withPnl].reverse().map((entry) => {
      running += entry.pnl_realized_usd || 0;
      return { date: entry.opened_at.slice(0, 10), pnl: Number(running.toFixed(2)) };
    });
  }, [sorted]);

  const hasRealizedCurve = sorted.some((e) => typeof e.pnl_realized_usd === "number");
  const lastPnl = chartData.length ? chartData[chartData.length - 1].pnl : 0;
  const lineStroke = lastPnl >= 0 ? colors.bullish : colors.bearish;

  const streak = useMemo(() => {
    const realized = sorted.filter((e) => typeof e.pnl_realized_usd === "number");
    if (realized.length === 0) return { label: "Streak", value: "0" };
    let count = 0;
    const firstSign = (realized[0].pnl_realized_usd || 0) >= 0 ? 1 : -1;
    for (const entry of realized) {
      const sign = (entry.pnl_realized_usd || 0) >= 0 ? 1 : -1;
      if (sign !== firstSign) break;
      count += 1;
    }
    return { label: "Streak", value: `${firstSign > 0 ? "W" : "L"}${count}` };
  }, [sorted]);

  async function handleCreateEntry(formData: FormData) {
    const symbol = String(formData.get("symbol") || "").toUpperCase().trim();
    const quantity = Number(formData.get("quantity") || 0);
    const side = (String(formData.get("side") || "buy") as "buy" | "sell");
    if (!symbol || quantity <= 0) {
      return;
    }
    startTransition(async () => {
      const created: JournalEntryPayload = {
        entry_id: `manual-${Date.now()}`,
        user_id: "local-user",
        symbol,
        opening_side: side,
        quantity,
        opened_at: new Date().toISOString(),
        status: "open",
        strategy_tags: ["manual"],
        is_day_trade: true,
        broker_order_ids: [],
        entry_notes: "Manual entry (UI placeholder)",
        pnl_realized_usd: null,
        signal_id: null,
        signal_direction: null,
        signal_generated_at: null
      };
      setEntries((prev) => [created, ...prev]);
      setShowModal(false);
    });
  }

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
          ["Win Rate", `${stats.winRate.toFixed(1)}%`, WIN_RATE_TIP],
          ["Total Trades", String(stats.totalTrades), ""],
          ["Avg Winner", `$${stats.avgWinner.toFixed(2)}`, AVG_WINNER_TIP],
          ["Avg Loser", `$${stats.avgLoser.toFixed(2)}`, AVG_LOSER_TIP],
          ["Expectancy", `$${stats.expectancy.toFixed(2)}`, EXPECTANCY_TIP],
          [streak.label, streak.value, STREAK_TIP]
        ].map(([k, v, tip]) => (
          <article key={k} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3] }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], marginBottom: spacing[1] }}>
              <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>{k}</p>
              {tip ? <InfoTip text={String(tip)} label={`About ${k}`} /> : null}
            </div>
            <strong>{v}</strong>
          </article>
        ))}
      </div>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
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
            Start trading to build your performance chart — line stays at $0 until closed trades include realized P&L.
          </p>
        ) : null}
      </article>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
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
          <table className="min-w-[640px]" style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
            <thead>
              <tr style={{ color: colors.textMuted }}>
                <th align="left">Date</th>
                <th align="left">Symbol</th>
                <th align="left">Side</th>
                <th align="left">Quantity</th>
                <th align="left">Entry Price</th>
                <th align="left">Exit Price</th>
                <th align="left">P&L</th>
                <th align="left">Signal</th>
                <th align="left">Setup Type</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <Fragment key={entry.entry_id}>
                  <tr
                    onClick={() => setExpandedId(expandedId === entry.entry_id ? null : entry.entry_id)}
                    style={{ borderTop: `1px solid ${colors.border}`, cursor: "pointer" }}
                  >
                    <td>{entry.opened_at.slice(0, 10)}</td>
                    <td>{entry.symbol}</td>
                    <td>{entry.opening_side}</td>
                    <td>{entry.quantity}</td>
                    <td>{entry.entry_notes ? "—" : "n/a"}</td>
                    <td>{entry.closed_at ? "set" : "n/a"}</td>
                    <td style={{ color: (entry.pnl_realized_usd || 0) >= 0 ? colors.bullish : colors.bearish }}>
                      {(entry.pnl_realized_usd || 0).toFixed(2)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="min-h-9 max-w-[200px] truncate rounded-full border px-2 text-left text-xs"
                        style={{
                          borderColor: entry.signal_id ? colors.accent : colors.border,
                          color: entry.signal_id ? colors.accent : colors.textMuted,
                          background: entry.signal_id ? "rgba(59,130,246,.1)" : "transparent"
                        }}
                        onClick={async () => {
                          if (!entry.signal_id) return;
                          const rows = await fetchLiveSignals();
                          const found = rows.find((r) => r.signal_id === entry.signal_id) || null;
                          setSignalDetail(found);
                          setSignalDetailOpen(true);
                        }}
                      >
                        {signalChipLabel(entry)}
                      </button>
                    </td>
                    <td>{entry.strategy_tags[0] || "manual"}</td>
                  </tr>
                  {expandedId === entry.entry_id ? (
                    <tr style={{ borderTop: `1px dashed ${colors.border}` }}>
                      <td colSpan={9} style={{ color: colors.textMuted, fontSize: typography.scale.sm, padding: spacing[2] }}>
                        Signal context: {entry.entry_notes || "No signal context attached."}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 ? (
          <p style={{ color: colors.textMuted }}>No trades yet. Connect a broker to enable automatic capture.</p>
        ) : null}
      </article>

      {signalDetailOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 60 }}
        >
          <div
            style={{
              width: "min(420px, 92vw)",
              background: colors.surface,
              borderRadius: borderRadius.xl,
              padding: spacing[4],
              border: `1px solid ${colors.border}`
            }}
          >
            <h3 style={{ marginTop: 0 }}>Linked signal</h3>
            {signalDetail ? (
              <div style={{ display: "grid", gap: spacing[2], fontSize: typography.scale.sm }}>
                <p style={{ margin: 0 }}>
                  <strong>{signalDetail.symbol}</strong> · {signalDetail.bias} · {Math.round(signalDetail.signal_strength)}% strength
                </p>
                <p style={{ margin: 0, color: colors.textMuted }}>
                  Pattern: {signalDetail.pattern ?? "—"}
                  <br />
                  Price at signal:{" "}
                  {typeof signalDetail.price_at_signal === "number" ? `$${signalDetail.price_at_signal.toFixed(2)}` : "—"}
                </p>
                <p style={{ margin: 0 }}>
                  1h: {formatHorizonOutcome(signalDetail.outcome_1h).label}
                  <br />
                  1d: {formatHorizonOutcome(signalDetail.outcome_1d).label}
                </p>
                <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>{signalDetail.disclaimer}</p>
              </div>
            ) : (
              <p style={{ color: colors.textMuted }}>
                This trade references a signal that is not in the recent public list. Signal id is preserved on the entry for future
                lookup.
              </p>
            )}
            <button
              type="button"
              className="mt-3 min-h-11"
              onClick={() => setSignalDetailOpen(false)}
              style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, padding: spacing[2] }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {showModal ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 60 }}>
          <form
            action={handleCreateEntry}
            style={{ width: "min(460px,92vw)", background: colors.surface, borderRadius: borderRadius.xl, padding: spacing[4], display: "grid", gap: spacing[2] }}
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
