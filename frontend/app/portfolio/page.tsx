"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type SummaryPayload = {
  summary?: Record<string, unknown>;
  open_positions_count?: number;
  disclaimer?: string;
};

type PositionRow = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : fallback;
  }
  return fallback;
}

function fmtMoney(n: number, sign = false): string {
  const abs = Math.abs(n);
  const core = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!sign) return n < 0 ? `-$${core}` : `$${core}`;
  return `${n >= 0 ? "+" : "-"}$${core}`;
}

export default function ModelPortfolioPage() {
  const { colors } = useTheme();
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [open, setOpen] = useState<PositionRow[]>([]);
  const [closed, setClosed] = useState<PositionRow[]>([]);
  const [perf, setPerf] = useState<Record<string, unknown> | null>(null);
  const [filter, setFilter] = useState<"all" | "profit" | "loss">("all");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, o, h, p] = await Promise.all([
        fetch("/api/stocvest/portfolio/summary", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/stocvest/portfolio/positions/open", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/stocvest/portfolio/positions/history?limit=50&days=365", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/stocvest/portfolio/performance?period=all", { cache: "no-store" }).then((r) => r.json())
      ]);
      setSummary(s as SummaryPayload);
      setOpen(Array.isArray(o?.positions) ? (o.positions as PositionRow[]) : []);
      setClosed(Array.isArray(h?.positions) ? (h.positions as PositionRow[]) : []);
      setPerf(p as Record<string, unknown>);
    } catch {
      setErr("Unable to load signal portfolio data.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const su = summary?.summary || {};
  const closedCount = num(su.closed_positions);
  const winRatePct = num(su.win_rate) * 100;
  const winRateLabel =
    closedCount <= 0
      ? "0% (0 closed)"
      : `${winRatePct.toFixed(0)}% (${num(su.winning_positions)}/${closedCount} closed)`;
  const totalRet = num(su.total_return_dollars);
  const totalRetPct = num(su.total_return_pct);
  const profitFactor = num(su.profit_factor);
  const openSlots = open.length;

  const filteredClosed = useMemo(() => {
    if (filter === "profit") return closed.filter((r) => String(r.outcome).toLowerCase() === "profit");
    if (filter === "loss") return closed.filter((r) => String(r.outcome).toLowerCase() === "loss");
    return closed;
  }, [closed, filter]);

  const tier = (perf?.by_signal_strength || {}) as Record<string, { closed?: number; wins?: number; win_rate?: number }>;
  const mod = tier.moderate || {};
  const strn = tier.strong || {};
  const vstr = tier.very_strong || {};

  return (
    <div style={{ minHeight: "100vh", background: colors.background, color: colors.text }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: spacing[8] }}>
        <div style={{ marginBottom: spacing[6] }}>
          <Link href="/dashboard" style={{ color: colors.accent, fontSize: typography.scale.sm }}>
            ← Back to dashboard
          </Link>
        </div>

        <header style={{ marginBottom: spacing[8] }}>
          <h1 style={{ fontSize: typography.scale["3xl"], fontWeight: 700, marginBottom: spacing[3] }}>
            $100K signal tracking portfolio
          </h1>
          <p style={{ fontSize: typography.scale.base, lineHeight: typography.lineHeight.relaxed, color: colors.textMuted, maxWidth: 720 }}>
            This page tracks how STOCVEST composite signals would have performed using a fixed notional model. It is{" "}
            <strong>not</strong> investment advice. Past signal outcomes do not guarantee future results. Language here
            describes <strong>signals tracked</strong> and <strong>positions logged</strong> for validation only.
          </p>
          {err ? (
            <p style={{ color: colors.bearish, marginTop: spacing[4] }}>{err}</p>
          ) : null}
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
            marginBottom: spacing[8]
          }}
        >
          {[
            { label: "Total return", value: `${fmtMoney(totalRet, true)} (${totalRetPct >= 0 ? "+" : ""}${totalRetPct.toFixed(1)}%)` },
            { label: "Win rate", value: winRateLabel },
            { label: "Active signals", value: `${openSlots} / 10 slots` },
            { label: "Profit factor", value: profitFactor > 0 ? profitFactor.toFixed(2) : "—" }
          ].map((c) => (
            <div
              key={c.label}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                padding: spacing[6]
              }}
            >
              <div style={{ fontSize: typography.scale.xs, textTransform: "uppercase", color: colors.textMuted }}>{c.label}</div>
              <div style={{ fontSize: typography.scale.xl, fontWeight: 600, marginTop: spacing[2] }}>{c.value}</div>
            </div>
          ))}
        </section>

        <section style={{ marginBottom: spacing[8] }}>
          <h2 style={{ fontSize: typography.scale.xl, fontWeight: 600, marginBottom: spacing[4] }}>Active positions</h2>
          {open.length === 0 ? (
            <p style={{ color: colors.textMuted }}>No open tracked positions.</p>
          ) : (
            <div style={{ display: "grid", gap: spacing[4] }}>
              {open.map((p) => {
                const sym = String(p.symbol || "");
                const entry = num(p.entry_price);
                const stop = num(p.stop_loss_price);
                const target = num(p.target_price);
                const last = num(p.entry_price);
                const span = Math.max(1e-6, target - stop);
                const pct = Math.max(0, Math.min(1, (last - stop) / span));
                return (
                  <div
                    key={String(p.position_id)}
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.md,
                      padding: spacing[6]
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: spacing[3] }}>
                      <strong>{sym}</strong>
                      <span style={{ color: colors.textMuted }}>Signal score: {String(p.signal_score)}%</span>
                    </div>
                    <p style={{ fontSize: typography.scale.sm, color: colors.textMuted, marginTop: spacing[2] }}>
                      Entry logged at {fmtMoney(entry)} · Stop {fmtMoney(stop)} · Target {fmtMoney(target)}
                    </p>
                    <div style={{ marginTop: spacing[3], height: 8, background: colors.border, borderRadius: 4, position: "relative" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${pct * 100}%`,
                          background: colors.accent,
                          borderRadius: 4
                        }}
                      />
                    </div>
                    <p style={{ fontSize: typography.scale.sm, marginTop: spacing[3] }}>
                      {(String(p.entry_reason || "").slice(0, 120) || "—") + (String(p.entry_reason || "").length > 120 ? "…" : "")}
                    </p>
                    <div style={{ marginTop: spacing[3] }}>
                      <Link href={`/dashboard/signals?symbol=${encodeURIComponent(sym)}`} style={{ color: colors.accent }}>
                        View signal context
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section style={{ marginBottom: spacing[8] }}>
          <h2 style={{ fontSize: typography.scale.xl, fontWeight: 600, marginBottom: spacing[4] }}>Signal accuracy by tier</h2>
          {closedCount < 10 ? (
            <p style={{ color: colors.textMuted }}>
              Tracking signal performance. Tier analysis is most useful after 10 closed positions (currently{" "}
              {closedCount}).
            </p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: spacing[4] }}>
              {[
                { label: "Moderate (72–79%)", w: num(mod.wins), n: num(mod.closed), r: num(mod.win_rate) },
                { label: "Strong (80–89%)", w: num(strn.wins), n: num(strn.closed), r: num(strn.win_rate) },
                { label: "Very strong (90%+)", w: num(vstr.wins), n: num(vstr.closed), r: num(vstr.win_rate) }
              ].map((c) => (
                <div
                  key={c.label}
                  style={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    padding: spacing[6]
                  }}
                >
                  <div style={{ fontSize: typography.scale.xs, textTransform: "uppercase", color: colors.textMuted }}>{c.label}</div>
                  <div style={{ fontSize: typography.scale.lg, fontWeight: 600, marginTop: spacing[2] }}>
                    {c.n > 0 ? `${(c.r * 100).toFixed(0)}% win rate (${c.w}/${c.n})` : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginBottom: spacing[8] }}>
          <h2 style={{ fontSize: typography.scale.xl, fontWeight: 600, marginBottom: spacing[4] }}>Closed positions</h2>
          <div style={{ display: "flex", gap: spacing[3], marginBottom: spacing[4], flexWrap: "wrap" }}>
            {(["all", "profit", "loss"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                style={{
                  padding: `${spacing[2]} ${spacing[4]}`,
                  borderRadius: borderRadius.sm,
                  border: `1px solid ${colors.border}`,
                  background: filter === f ? colors.surfaceMuted : colors.surface,
                  color: colors.text,
                  cursor: "pointer"
                }}
              >
                {f === "all" ? "All" : f === "profit" ? "Profitable" : "Unprofitable"}
              </button>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
              <thead>
                <tr style={{ textAlign: "left", color: colors.textMuted }}>
                  <th style={{ padding: spacing[3] }}>Symbol</th>
                  <th style={{ padding: spacing[3] }}>Entry</th>
                  <th style={{ padding: spacing[3] }}>Exit</th>
                  <th style={{ padding: spacing[3] }}>Signal</th>
                  <th style={{ padding: spacing[3] }}>Outcome</th>
                  <th style={{ padding: spacing[3] }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredClosed.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: spacing[4], color: colors.textMuted }}>
                      {closed.length === 0
                        ? "No closed positions in the selected window yet."
                        : filter === "profit"
                          ? "No profitable closed positions match this filter."
                          : "No unprofitable closed positions match this filter."}
                    </td>
                  </tr>
                ) : (
                  filteredClosed.map((r) => {
                    const outcome = String(r.outcome || "").toLowerCase();
                    const borderLeft =
                      outcome === "profit" ? `3px solid ${colors.bullish}` : outcome === "loss" ? `3px solid ${colors.bearish}` : "3px solid transparent";
                    return (
                      <tr key={String(r.position_id)} style={{ borderLeft }}>
                        <td style={{ padding: spacing[3] }}>{String(r.symbol)}</td>
                        <td style={{ padding: spacing[3] }}>{fmtMoney(num(r.entry_price))}</td>
                        <td style={{ padding: spacing[3] }}>{r.exit_price != null ? fmtMoney(num(r.exit_price)) : "—"}</td>
                        <td style={{ padding: spacing[3] }}>{String(r.signal_score)}%</td>
                        <td style={{ padding: spacing[3] }}>{r.outcome != null ? String(r.outcome) : "—"}</td>
                        <td style={{ padding: spacing[3] }}>{r.exit_reason != null ? String(r.exit_reason) : "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer
          style={{
            borderTop: `1px solid ${colors.border}`,
            paddingTop: spacing[6],
            fontSize: typography.scale.sm,
            color: colors.textMuted
          }}
        >
          <p>
            {summary?.disclaimer ||
              "Signal data for informational purposes only. Not investment advice. This portfolio uses notional $100K capital for transparency."}
          </p>
        </footer>
      </div>
    </div>
  );
}
