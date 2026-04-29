import React from "react";
import type { PortfolioMultiBrokerOverview } from "@/lib/api/portfolio";

interface PortfolioMultiBrokerPanelProps {
  overview: PortfolioMultiBrokerOverview;
}

function fmt(value: number | undefined): string {
  if (value == null) {
    return "-";
  }
  return value.toFixed(2);
}

export function PortfolioMultiBrokerPanel({ overview }: PortfolioMultiBrokerPanelProps) {
  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ marginBottom: 10 }}>Portfolio View (Multi-Broker)</h2>
      <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
        <p style={{ marginTop: 0, opacity: 0.9 }}>
          The panel degrades gracefully: disconnected brokers show errors while available brokers still render.
        </p>
        {overview.accounts.length === 0 ? (
          <p style={{ marginBottom: 0, opacity: 0.85 }}>No broker accounts available yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {overview.accounts.map((card) => (
              <div key={`${card.broker}-${card.accountId}`} style={{ borderTop: "1px solid #24304f", paddingTop: 10 }}>
                <div style={{ fontWeight: 700 }}>
                  {card.broker.toUpperCase()} — {card.accountId}
                </div>
                {card.error ? (
                  <p style={{ color: "#fda4af", margin: "6px 0 0 0" }}>{card.error}</p>
                ) : (
                  <p style={{ margin: "6px 0 0 0", opacity: 0.9 }}>
                    Gross: {fmt(card.summary?.gross_exposure)} | Net: {fmt(card.summary?.net_exposure)} | Unrealized
                    PnL: {fmt(card.summary?.unrealized_pnl)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
