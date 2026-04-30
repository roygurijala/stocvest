"use client";

import { useMemo, useState, useTransition } from "react";
import type { JournalEntryPayload } from "@/lib/api/contracts";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { borderRadius, colorTokens, spacing, typography } from "@/lib/design-system";

interface JournalPageClientProps {
  initialEntries: JournalEntryPayload[];
}

export function JournalPageClient({ initialEntries }: JournalPageClientProps) {
  const colors = colorTokens.dark;
  const [entries, setEntries] = useState(initialEntries);
  const [sortDesc, setSortDesc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isPending, startTransition] = useTransition();

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
    let running = 0;
    return [...sorted].reverse().map((entry) => {
      running += entry.pnl_realized_usd || 0;
      return { date: entry.opened_at.slice(0, 10), pnl: Number(running.toFixed(2)) };
    });
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
        pnl_realized_usd: null
      };
      setEntries((prev) => [created, ...prev]);
      setShowModal(false);
    });
  }

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Trade Journal</h2>
        <button
          type="button"
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

      <div className="journal-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: spacing[3] }}>
        {[
          ["Win Rate", `${stats.winRate.toFixed(1)}%`],
          ["Total Trades", String(stats.totalTrades)],
          ["Avg Winner", `$${stats.avgWinner.toFixed(2)}`],
          ["Avg Loser", `$${stats.avgLoser.toFixed(2)}`],
          ["Expectancy", `$${stats.expectancy.toFixed(2)}`]
        ].map(([k, v]) => (
          <article key={k} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3] }}>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>{k}</p>
            <strong>{v}</strong>
          </article>
        ))}
      </div>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0 }}>Cumulative P&L</h3>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="pnl"
                stroke={chartData.length && chartData[chartData.length - 1].pnl >= 0 ? colors.bullish : colors.bearish}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0 }}>Trade History</h3>
          <button
            type="button"
            onClick={() => setSortDesc((v) => !v)}
            style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, background: "transparent", color: colors.text }}
          >
            Sort by date {sortDesc ? "↓" : "↑"}
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
            <thead>
              <tr style={{ color: colors.textMuted }}>
                <th align="left">Date</th>
                <th align="left">Symbol</th>
                <th align="left">Side</th>
                <th align="left">Quantity</th>
                <th align="left">Entry Price</th>
                <th align="left">Exit Price</th>
                <th align="left">P&L</th>
                <th align="left">Setup Type</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <>
                  <tr
                    key={entry.entry_id}
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
                    <td>{entry.strategy_tags[0] || "manual"}</td>
                  </tr>
                  {expandedId === entry.entry_id ? (
                    <tr style={{ borderTop: `1px dashed ${colors.border}` }}>
                      <td colSpan={8} style={{ color: colors.textMuted, fontSize: typography.scale.sm, padding: spacing[2] }}>
                        Signal context: {entry.entry_notes || "No signal context attached."}
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 ? (
          <p style={{ color: colors.textMuted }}>No trades yet. Connect a broker to enable automatic capture.</p>
        ) : null}
      </article>

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
