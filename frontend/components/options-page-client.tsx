"use client";

import { useMemo, useState } from "react";
import type { OptionChainOverview } from "@/lib/api/options";
import { borderRadius, colorTokens, spacing, typography } from "@/lib/design-system";

interface OptionsPageClientProps {
  overview: OptionChainOverview;
}

export function OptionsPageClient({ overview }: OptionsPageClientProps) {
  const colors = colorTokens.dark;
  const [symbol, setSymbol] = useState(overview.symbol);
  const [expiration, setExpiration] = useState("all");
  const [side, setSide] = useState<"all" | "call" | "put">("all");

  const expirations = useMemo(
    () => Array.from(new Set(overview.rows.map((r) => r.expiration))).sort(),
    [overview.rows]
  );

  const filtered = useMemo(() => {
    return overview.rows.filter((row) => {
      const symbolOk = row.underlying.toUpperCase().includes(symbol.toUpperCase());
      const expirationOk = expiration === "all" || row.expiration === expiration;
      const sideOk = side === "all" || row.option_type.toLowerCase() === side;
      return symbolOk && expirationOk && sideOk;
    });
  }, [overview.rows, symbol, expiration, side]);

  const calls = filtered.filter((r) => r.option_type.toLowerCase() === "call");
  const puts = filtered.filter((r) => r.option_type.toLowerCase() === "put");
  const mid = filtered.length ? filtered[Math.floor(filtered.length / 2)].strike : 0;

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <article
        style={{
          background: "rgba(245,158,11,.12)",
          color: colors.caution,
          border: `1px solid rgba(245,158,11,.45)`,
          borderRadius: borderRadius.lg,
          padding: spacing[3]
        }}
      >
        Options quotes are delayed by {overview.delayedByMinutes} minutes.
      </article>

      <div style={{ display: "flex", gap: spacing[2], flexWrap: "wrap" }}>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="Symbol" style={{ padding: spacing[2] }} />
        <select value={expiration} onChange={(e) => setExpiration(e.target.value)} style={{ padding: spacing[2] }}>
          <option value="all">All expirations</option>
          {expirations.map((exp) => (
            <option key={exp} value={exp}>
              {exp}
            </option>
          ))}
        </select>
        <div style={{ display: "inline-flex", border: `1px solid ${colors.border}`, borderRadius: borderRadius.md }}>
          {(["all", "call", "put"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              style={{
                border: "none",
                borderRight: s !== "put" ? `1px solid ${colors.border}` : "none",
                background: side === s ? "rgba(59,130,246,.18)" : "transparent",
                color: side === s ? colors.accent : colors.text,
                padding: `${spacing[2]} ${spacing[3]}`
              }}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <section style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[3], overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
          <thead>
            <tr style={{ color: colors.textMuted }}>
              <th align="left">Contract</th>
              <th align="left">Strike</th>
              <th align="left">Type</th>
              <th align="left">Bid</th>
              <th align="left">Ask</th>
              <th align="left">Delta</th>
              <th align="left">Gamma</th>
              <th align="left">Theta</th>
              <th align="left">Vega</th>
              <th align="left">Volume</th>
              <th align="left">OI</th>
            </tr>
          </thead>
          <tbody>
            {[...calls, ...puts].map((row, idx) => {
              const isMidline = row.strike === mid;
              const isITM = row.option_type.toLowerCase() === "call" ? row.strike < mid : row.strike > mid;
              return (
                <tr
                  key={`${row.symbol}-${idx}`}
                  style={{
                    borderTop: `1px solid ${colors.border}`,
                    background: isMidline ? "rgba(59,130,246,.09)" : isITM ? "rgba(148,163,184,.08)" : "transparent"
                  }}
                >
                  <td>{row.symbol}</td>
                  <td>{row.strike}</td>
                  <td>{row.option_type.toUpperCase()}</td>
                  <td>{row.bid ?? "—"}</td>
                  <td>{row.ask ?? "—"}</td>
                  <td>{row.delta ?? "—"}</td>
                  <td>{row.gamma ?? "—"}</td>
                  <td>{row.theta ?? "—"}</td>
                  <td>{row.vega ?? "—"}</td>
                  <td>{row.volume ?? "—"}</td>
                  <td>{row.open_interest ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </section>
  );
}
