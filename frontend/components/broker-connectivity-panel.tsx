import React from "react";
import type { BrokerOverview } from "@/lib/api/brokers";

interface BrokerConnectivityPanelProps {
  overviews: BrokerOverview[];
}

export function BrokerConnectivityPanel({ overviews }: BrokerConnectivityPanelProps) {
  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ marginBottom: 10 }}>Broker Connectivity</h2>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {overviews.map((overview) => (
          <article key={overview.broker} style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 style={{ margin: 0, textTransform: "uppercase" }}>{overview.broker}</h3>
              <span style={{ color: overview.health?.ok ? "#4ade80" : "#fda4af" }}>
                {overview.health ? (overview.health.ok ? "Healthy" : "Unhealthy") : "Unavailable"}
              </span>
            </header>
            {overview.error ? (
              <p style={{ color: "#fda4af", marginTop: 10 }}>{overview.error}</p>
            ) : (
              <>
                <p style={{ opacity: 0.85 }}>
                  Accounts: <strong>{overview.accounts?.length ?? 0}</strong>
                </p>
                {(overview.accounts || []).map((account) => {
                  const positions = overview.positionsByAccount[account.account_id] || [];
                  return (
                    <div key={account.account_id} style={{ marginTop: 10, borderTop: "1px solid #24304f", paddingTop: 10 }}>
                      <div style={{ fontWeight: 600 }}>{account.display_name || account.account_id}</div>
                      <div style={{ opacity: 0.85, fontSize: 14 }}>Positions: {positions.length}</div>
                      {positions.length > 0 ? (
                        <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                          {positions.slice(0, 3).map((position) => (
                            <li key={`${account.account_id}-${position.symbol}`}>
                              {position.symbol}: {position.quantity}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
