"use client";

import type { FuturesDashboardOverview } from "@/lib/api/futures";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

interface FuturesDashboardPanelProps {
  overview: FuturesDashboardOverview;
}

export function FuturesDashboardPanel({ overview }: FuturesDashboardPanelProps) {
  const { colors } = useTheme();

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ marginBottom: 10 }}>Futures Dashboard (IBKR TWS)</h2>
      <article
        className={surfaceGlowClassName}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.lg,
          padding: spacing[4]
        }}
      >
        <p
          style={{
            marginTop: 0,
            color: overview.connected ? colors.bullish : colors.bearish,
            fontWeight: 600
          }}
        >
          {overview.statusMessage}
        </p>

        {!overview.connected ? (
          <p style={{ marginBottom: 0, opacity: 0.9, color: colors.textMuted }}>
            Connect TWS/IB Gateway and re-open the dashboard to load live futures data.
          </p>
        ) : overview.accounts.length === 0 ? (
          <p style={{ marginBottom: 0, opacity: 0.9, color: colors.textMuted }}>No IBKR accounts returned.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {overview.accounts.map((account) => {
              const positions = overview.positionsByAccount[account.account_id] || [];
              return (
                <div key={account.account_id} style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
                  <div style={{ fontWeight: 600 }}>{account.display_name || account.account_id}</div>
                  {positions.length === 0 ? (
                    <p style={{ marginBottom: 0, opacity: 0.85, color: colors.textMuted }}>No open positions.</p>
                  ) : (
                    <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                      {positions.map((position) => (
                        <li key={`${account.account_id}-${position.symbol}`}>
                          {position.symbol}: {position.quantity}
                          {position.avg_cost != null ? ` @ ${position.avg_cost}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
