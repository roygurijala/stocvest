"use client";

import { useState } from "react";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { MorningBriefPayload } from "@/lib/api/scanner";
import type { PDTAssessmentPayload } from "@/lib/api/pdt";

type MorningBriefCollapseProps = {
  mb: MorningBriefPayload;
  pdt: PDTAssessmentPayload | null | undefined;
};

export function MorningBriefCollapse({ mb, pdt }: MorningBriefCollapseProps) {
  const { colors } = useTheme();
  const [briefOpen, setBriefOpen] = useState(false);

  return (
    <article
      className={surfaceGlowClassName}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        background: colors.surface,
        padding: spacing[4]
      }}
    >
      <button
        type="button"
        onClick={() => setBriefOpen((v) => !v)}
        style={{
          cursor: "pointer",
          fontWeight: 700,
          border: "none",
          background: "transparent",
          color: colors.text,
          padding: 0,
          textAlign: "left"
        }}
      >
        Morning brief · {mb.conditions.label} conditions
      </button>
      {briefOpen ? (
        <div style={{ marginTop: spacing[3], display: "grid", gap: spacing[4] }}>
          <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.5 }}>
            Signal data for informational purposes only. Not investment advice. Past signal performance does not guarantee future
            results.
          </p>
          {(() => {
            const cond = mb.conditions.label;
            const badgeBg =
              cond === "FAVORABLE"
                ? "rgba(34,197,94,0.2)"
                : cond === "CHOPPY"
                  ? "rgba(245,158,11,0.2)"
                  : "rgba(239,68,68,0.2)";
            const badgeFg = cond === "FAVORABLE" ? colors.bullish : cond === "CHOPPY" ? colors.caution : colors.bearish;
            const spy = mb.conditions.futures_spy_pct;
            const qqq = mb.conditions.futures_qqq_pct;
            const fmt = (n: number | null | undefined) =>
              n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
            const vixDir = mb.conditions.vix_direction;
            const vixArrow = vixDir === "rising" ? "↑" : vixDir === "falling" ? "↓" : "→";
            const econ = mb.economic_events;
            const econList = Array.isArray(econ) ? econ : [];
            const econEmpty = !Array.isArray(econ) && typeof econ === "object" && econ && "message" in econ;
            const earn = mb.earnings_today;
            const earnList = Array.isArray(earn) ? earn : [];
            const earnEmpty = !Array.isArray(earn) && typeof earn === "object" && earn && "message" in earn;
            const tw = mb.top_watch;
            const twSym = tw && typeof tw === "object" && "symbol" in tw ? String((tw as { symbol: string }).symbol) : null;
            const twObj = tw && typeof tw === "object" && twSym ? (tw as Record<string, unknown>) : null;
            const twAlert = Boolean(twObj?.is_confluence_alert);
            const twSectionTitle =
              twObj && typeof twObj.confluence_label === "string" && String(twObj.confluence_label).trim()
                ? String(twObj.confluence_label)
                : "Top pre-market watch";
            const setupBorder = cond === "FAVORABLE" ? colors.bullish : cond === "CHOPPY" ? colors.caution : colors.bearish;
            return (
              <>
                <section>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "6px 14px",
                      borderRadius: borderRadius.md,
                      fontWeight: 800,
                      fontSize: typography.scale.sm,
                      background: badgeBg,
                      color: badgeFg
                    }}
                  >
                    {cond}
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[2] }}>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: borderRadius.md,
                        border: `1px solid ${colors.border}`,
                        fontSize: typography.scale.xs,
                        color: spy != null && spy >= 0 ? colors.bullish : colors.bearish
                      }}
                    >
                      SPY: {fmt(spy)}
                    </span>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: borderRadius.md,
                        border: `1px solid ${colors.border}`,
                        fontSize: typography.scale.xs,
                        color: qqq != null && qqq >= 0 ? colors.bullish : colors.bearish
                      }}
                    >
                      QQQ: {fmt(qqq)}
                    </span>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: borderRadius.md,
                        border: `1px solid ${colors.border}`,
                        fontSize: typography.scale.xs,
                        color: colors.text
                      }}
                    >
                      VIX: {mb.conditions.vix_level != null ? mb.conditions.vix_level.toFixed(1) : "—"} {vixArrow}
                    </span>
                  </div>
                  <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
                    Regime: {mb.conditions.regime}
                  </p>
                </section>
                <section>
                  <h4 style={{ margin: 0, fontSize: typography.scale.sm }}>Economic events today</h4>
                  {econList.length > 0 ? (
                    <ul style={{ margin: spacing[2] + " 0 0", paddingLeft: 18, display: "grid", gap: spacing[1] }}>
                      {econList.slice(0, 3).map((e) => (
                        <li key={`${e.time}-${e.event_name}`} style={{ fontSize: typography.scale.xs, color: colors.text }}>
                          <span style={{ color: colors.textMuted }}>{e.time}</span> {e.event_name}{" "}
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              color:
                                e.impact === "high" ? colors.bearish : e.impact === "medium" ? colors.caution : colors.textMuted
                            }}
                          >
                            {e.impact.toUpperCase()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: spacing[2] + " 0 0", color: colors.textMuted, fontSize: typography.scale.xs }}>
                      {(econEmpty && (econ as { message: string }).message) || "No major events today"}
                    </p>
                  )}
                </section>
                <section>
                  <h4 style={{ margin: 0, fontSize: typography.scale.sm }}>Earnings today</h4>
                  {earnList.length > 0 ? (
                    <ul style={{ margin: spacing[2] + " 0 0", paddingLeft: 18, display: "grid", gap: spacing[1] }}>
                      {earnList.map((e) => (
                        <li
                          key={e.symbol}
                          style={{ fontSize: typography.scale.xs, color: colors.text, fontFamily: typography.fontFamilyMono }}
                        >
                          {e.symbol} · {e.company} · {e.time}
                          {e.est_eps != null ? ` · Est: $${e.est_eps.toFixed(2)}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: spacing[2] + " 0 0", color: colors.textMuted, fontSize: typography.scale.xs }}>
                      {(earnEmpty && (earn as { message: string }).message) || "No earnings today"}
                    </p>
                  )}
                </section>
                <section>
                  <h4
                    style={{
                      margin: 0,
                      fontSize: typography.scale.sm,
                      ...(twAlert ? { color: "#f5c542", fontWeight: 800 } : {})
                    }}
                  >
                    {twSectionTitle}
                  </h4>
                  {twSym ? (
                    <div
                      style={{
                        marginTop: spacing[2],
                        border: `1px solid ${colors.border}`,
                        ...(twAlert ? { borderLeft: "3px solid #f5c542" } : {}),
                        borderRadius: borderRadius.lg,
                        padding: spacing[3]
                      }}
                    >
                      <strong>{twSym}</strong>
                      {tw && typeof tw === "object" && "company_name" in tw && (tw as { company_name: string }).company_name ? (
                        <span style={{ marginLeft: 8, color: colors.textMuted, fontSize: 13 }}>
                          {(tw as { company_name: string }).company_name}
                        </span>
                      ) : null}
                      {twAlert ? (
                        <p style={{ margin: spacing[2] + " 0 0", fontSize: typography.scale.sm, color: colors.textMuted }}>
                          <span style={{ color: "#f5c542", fontWeight: 700, fontFamily: typography.fontFamilyMono }}>
                            {Number(twObj?.confluence_score ?? 0)}
                          </span>{" "}
                          confluence ·{" "}
                          <span style={{ fontWeight: 600 }}>{Number(twObj?.n_confirming ?? 0)}</span> signals confirming
                        </p>
                      ) : null}
                      <p style={{ margin: spacing[1] + " 0 0", fontSize: typography.scale.xs, color: colors.textMuted }}>
                        Gap {(tw as { gap_pct: number }).gap_pct?.toFixed?.(2)}% · Vol{" "}
                        {(tw as { volume_vs_avg: number }).volume_vs_avg?.toFixed?.(1)}x avg
                      </p>
                      {(tw as { catalyst?: { headline?: string; sentiment?: string } }).catalyst ? (
                        <p style={{ margin: spacing[1] + " 0 0", fontSize: typography.scale.sm }}>
                          {(tw as { catalyst: { headline: string } }).catalyst.headline}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p style={{ margin: spacing[2] + " 0 0", color: colors.textMuted, fontSize: typography.scale.xs }}>
                      {(tw && typeof tw === "object" && "message" in tw && (tw as { message: string }).message) ||
                        "No significant gaps"}
                    </p>
                  )}
                </section>
                <section
                  style={{
                    borderLeft: `4px solid ${setupBorder}`,
                    paddingLeft: spacing[3]
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: typography.scale.sm }}>Best setup type today</h4>
                  <p style={{ margin: spacing[1] + " 0 0", fontWeight: 700 }}>{mb.best_setup.setup_type}</p>
                  <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.45 }}>
                    {mb.best_setup.guidance}
                  </p>
                </section>
                {pdt ? (
                  <section>
                    <h4 style={{ margin: 0, fontSize: typography.scale.sm }}>PDT status</h4>
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: spacing[2],
                        padding: "4px 10px",
                        borderRadius: borderRadius.full,
                        fontSize: typography.scale.xs,
                        fontWeight: 600,
                        background:
                          mb.pdt_status.status === "blocked"
                            ? "rgba(239,68,68,0.15)"
                            : mb.pdt_status.status === "warning"
                              ? "rgba(245,158,11,0.18)"
                              : "rgba(34,197,94,0.15)",
                        color:
                          mb.pdt_status.status === "blocked"
                            ? colors.bearish
                            : mb.pdt_status.status === "warning"
                              ? colors.caution
                              : colors.bullish
                      }}
                    >
                      {mb.pdt_status.message}
                    </span>
                  </section>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : null}
    </article>
  );
}
