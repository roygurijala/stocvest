import React from "react";
import type { FuturesDashboardOverview } from "@/lib/api/futures";

interface FuturesDashboardPanelProps {
  overview: FuturesDashboardOverview;
}

export function FuturesDashboardPanel({ overview }: FuturesDashboardPanelProps) {
  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ marginBottom: 10 }}>Futures Dashboard (IBKR TWS)</h2>
      <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
        <p
          style={{
            marginTop: 0,
            color: overview.connected ? "#4ade80" : "#fda4af",
            fontWeight: 600
          }}
        >
          {overview.statusMessage}
        </p>

        {!overview.connected ? (
          <p style={{ marginBottom: 0, opacity: 0.9 }}>
            Connect TWS/IB Gateway and re-open the dashboard to load live futures data.
          </p>
        ) : overview.accounts.length === 0 ? (
          <p style={{ marginBottom: 0, opacity: 0.9 }}>No IBKR accounts returned.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {overview.accounts.map((account) => {
              const positions = overview.positionsByAccount[account.account_id] || [];
              return (
                <div key={account.account_id} style={{ borderTop: "1px solid #24304f", paddingTop: 10 }}>
                  <div style={{ fontWeight: 600 }}>
                    {account.display_name || account.account_id}
                  </div>
                  {positions.length === 0 ? (
                    <p style={{ marginBottom: 0, opacity: 0.85 }}>No open positions.</p>
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
