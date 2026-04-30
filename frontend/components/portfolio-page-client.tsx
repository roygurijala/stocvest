"use client";

import type { BrokerOverview } from "@/lib/api/brokers";
import type { PortfolioMultiBrokerOverview } from "@/lib/api/portfolio";
import { borderRadius, colorTokens, spacing, typography } from "@/lib/design-system";

interface PortfolioPageClientProps {
  brokerOverviews: BrokerOverview[];
  overview: PortfolioMultiBrokerOverview;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function PortfolioPageClient({ brokerOverviews, overview }: PortfolioPageClientProps) {
  const colors = colorTokens.dark;
  const brokerCards = brokerOverviews.map((broker) => {
    const healthy = broker.health?.ok ?? !broker.error;
    const accountType = broker.broker === "mock" ? "paper" : "live";
    const brokerRows = overview.accounts.filter((a) => a.broker === broker.broker && a.summary);
    const gross = brokerRows.reduce((sum, a) => sum + (a.summary?.gross_exposure || 0), 0);
    const net = brokerRows.reduce((sum, a) => sum + (a.summary?.net_exposure || 0), 0);
    const unrealized = brokerRows.reduce((sum, a) => sum + (a.summary?.unrealized_pnl || 0), 0);
    return { broker: broker.broker, healthy, accountType, gross, net, unrealized, error: broker.error };
  });

  const positions = brokerOverviews.flatMap((b) =>
    Object.entries(b.positionsByAccount).flatMap(([accountId, rows]) =>
      rows.map((row) => {
        const current = row.avg_cost ?? 0;
        const pnl = (current - (row.avg_cost ?? 0)) * row.quantity;
        const pnlPct = row.avg_cost ? ((current - row.avg_cost) / row.avg_cost) * 100 : 0;
        return { broker: b.broker, accountId, ...row, current, pnl, pnlPct };
      })
    )
  );

  const totalValue = overview.accounts.reduce((sum, a) => sum + (a.summary?.total_market_value || 0), 0);
  const totalUnrealized = overview.accounts.reduce((sum, a) => sum + (a.summary?.unrealized_pnl || 0), 0);
  const totalRealizedToday = 0;

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <article
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.xl,
          padding: spacing[4],
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: spacing[3]
        }}
      >
        <div>
          <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>Total Value</p>
          <strong>{money(totalValue)}</strong>
        </div>
        <div>
          <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>Total Unrealized P&L</p>
          <strong style={{ color: totalUnrealized >= 0 ? colors.bullish : colors.bearish }}>{money(totalUnrealized)}</strong>
        </div>
        <div>
          <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>Total Realized P&L Today</p>
          <strong>{money(totalRealizedToday)}</strong>
        </div>
      </article>

      <div className="portfolio-broker-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: spacing[3] }}>
        {brokerCards.map((card) => (
          <article key={card.broker} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[4] }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ textTransform: "uppercase" }}>{card.broker}</strong>
              <span
                style={{
                  color: card.healthy ? colors.bullish : colors.bearish,
                  fontSize: typography.scale.xs
                }}
              >
                {card.healthy ? "Healthy" : "Unavailable"}
              </span>
            </div>
            <p style={{ margin: `${spacing[1]} 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>Account type: {card.accountType}</p>
            <p style={{ margin: 0, fontSize: typography.scale.sm }}>Gross P&L: {money(card.gross)}</p>
            <p style={{ margin: 0, fontSize: typography.scale.sm }}>Net P&L: {money(card.net)}</p>
            <p style={{ margin: 0, fontSize: typography.scale.sm }}>Unrealized P&L: {money(card.unrealized)}</p>
            {!card.healthy ? (
              <button
                type="button"
                style={{
                  marginTop: spacing[2],
                  border: `1px solid ${colors.bearish}`,
                  background: "rgba(239,68,68,0.12)",
                  color: colors.bearish,
                  borderRadius: borderRadius.md,
                  padding: `${spacing[1]} ${spacing[2]}`
                }}
              >
                Connect
              </button>
            ) : null}
          </article>
        ))}
      </div>

      <section style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0 }}>Positions</h3>
        {positions.length === 0 ? (
          <p style={{ color: colors.textMuted }}>No open positions.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
              <thead>
                <tr style={{ color: colors.textMuted }}>
                  <th align="left">Symbol</th>
                  <th align="left">Quantity</th>
                  <th align="left">Avg Cost</th>
                  <th align="left">Current Price</th>
                  <th align="left">P&L $</th>
                  <th align="left">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((row, idx) => (
                  <tr key={`${row.broker}-${row.accountId}-${row.symbol}-${idx}`} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td>{row.symbol}</td>
                    <td>{row.quantity}</td>
                    <td>{money(row.avg_cost ?? 0)}</td>
                    <td>{money(row.current)}</td>
                    <td style={{ color: row.pnl >= 0 ? colors.bullish : colors.bearish }}>{money(row.pnl)}</td>
                    <td style={{ color: row.pnlPct >= 0 ? colors.bullish : colors.bearish }}>{row.pnlPct.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
