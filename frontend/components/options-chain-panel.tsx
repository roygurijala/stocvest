import React from "react";
import type { OptionChainOverview } from "@/lib/api/options";

interface OptionsChainPanelProps {
  overview: OptionChainOverview;
}

function fmt(value: number | null | undefined, digits: number = 3): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return value.toFixed(digits);
}

function fmtGreek(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return "-";
  }
  return n.toFixed(4);
}

export function OptionsChainPanel({ overview }: OptionsChainPanelProps) {
  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ marginBottom: 10 }}>Options Chain ({overview.symbol})</h2>
      <div
        style={{
          background: "#3f1d1d",
          color: "#fecaca",
          border: "1px solid #7f1d1d",
          borderRadius: 12,
          padding: 12,
          marginBottom: 12,
          fontWeight: 600
        }}
      >
        Data Delay Notice: Options data is delayed by {overview.delayedByMinutes} minutes (Polygon Options Starter).
      </div>

      <article style={{ background: "#101a32", borderRadius: 12, padding: 16, overflowX: "auto" }}>
        {overview.error ? (
          <p style={{ color: "#fda4af", margin: 0 }}>{overview.error}</p>
        ) : overview.rows.length === 0 ? (
          <p style={{ margin: 0, opacity: 0.85 }}>No option contracts returned.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 6px" }}>Contract</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Strike</th>
                <th style={{ textAlign: "left", padding: "8px 6px" }}>Type</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Bid</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Ask</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Delta</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Gamma</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Theta</th>
                <th style={{ textAlign: "right", padding: "8px 6px" }}>Vega</th>
              </tr>
            </thead>
            <tbody>
              {overview.rows.slice(0, 25).map((row) => (
                <tr key={row.symbol} style={{ borderTop: "1px solid #24304f" }}>
                  <td style={{ padding: "8px 6px" }}>{row.symbol}</td>
                  <td style={{ textAlign: "right", padding: "8px 6px" }}>{fmt(row.strike, 2)}</td>
                  <td style={{ padding: "8px 6px" }}>{row.option_type}</td>
                  <td style={{ textAlign: "right", padding: "8px 6px" }}>{fmt(row.bid, 2)}</td>
                  <td style={{ textAlign: "right", padding: "8px 6px" }}>{fmt(row.ask, 2)}</td>
                  <td style={{ textAlign: "right", padding: "8px 6px" }}>{fmtGreek(row.delta)}</td>
                  <td style={{ textAlign: "right", padding: "8px 6px" }}>{fmtGreek(row.gamma)}</td>
                  <td style={{ textAlign: "right", padding: "8px 6px" }}>{fmtGreek(row.theta)}</td>
                  <td style={{ textAlign: "right", padding: "8px 6px" }}>{fmtGreek(row.vega)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}
