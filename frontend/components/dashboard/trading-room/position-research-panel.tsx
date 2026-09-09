"use client";

/**
 * PositionResearchPanel — external Research context for the Position deep-dive (ADR-004 POS-AI-4).
 *
 * Loads on demand (never auto-fetches — protects the per-user/day budget) from the paid,
 * flag-gated `POST /v1/signals/position/research` (via the BFF). Shows a cited "recent
 * developments" summary (Perplexity), a truncated SEC 10-K "Item 1A · Risk Factors" excerpt
 * with a link to the filing, and headline latest-fiscal-year figures from the SEC XBRL
 * companyfacts API (POS-AI-10). Every external block is badged "External · not scored":
 * this content is INFORMATIONAL ONLY and never feeds the pillar math / composite score.
 */

import { useCallback, useState } from "react";

import type { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { positionResearchEnabled } from "@/lib/nav-features";

type Colors = ReturnType<typeof useTheme>["colors"];

type ResearchSource = { title?: string; url?: string };

type RecentDevelopments = {
  summary: string;
  key_points: string[];
  sources: ResearchSource[];
  scored: boolean;
};

type RiskFactors = {
  excerpt: string;
  source_url: string;
  filing_date: string;
  form: string;
  truncated: boolean;
  scored: boolean;
};

type XbrlFactRow = {
  key: string;
  label: string;
  value: number;
  unit: string;
  fiscal_year: number | null;
  period_end: string;
  form: string;
  filed: string;
};

type Financials = {
  entity_name: string;
  facts: XbrlFactRow[];
  source_url: string;
  scored: boolean;
};

type CrosscheckRow = {
  key: string;
  label: string;
  unit: string;
  fiscal_year: number | null;
  sec_value: number | null;
  provider_value: number | null;
  rel_diff: number | null;
  agrees: boolean | null;
  note: string;
};

type FinancialsCrosscheck = {
  provider: string;
  rows: CrosscheckRow[];
  disagreements: number;
  comparable: number;
  scored: boolean;
};

type FilingPassageRow = {
  text: string;
  section_label: string;
  source_url: string;
  score: number;
};

type FilingsDigest = {
  symbol: string;
  passages: FilingPassageRow[];
  source_url: string;
  filing_date: string;
  form: string;
  scored: boolean;
};

type ResearchResponse = {
  status: "ok" | "disabled" | "upgrade_required" | "over_budget" | "empty";
  recent_developments: RecentDevelopments | null;
  risk_factors: RiskFactors | null;
  financials: Financials | null;
  financials_crosscheck?: FinancialsCrosscheck | null;
  filings_digest?: FilingsDigest | null;
  upgrade_available?: boolean;
  disclaimer?: string;
};

/** Format a SEC XBRL fact for display. USD → compact $T/$B/$M; USD/shares → $x.xx (EPS). */
export function formatXbrlValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  // Per-share (EPS) — keep full precision; place the sign before the $ (e.g. -$1.50 loss).
  if (unit === "USD/shares") return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

type Props = {
  symbol: string;
  companyName?: string | null;
  colors: Colors;
  upgradeHref?: string;
};

type PanelState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "done"; data: ResearchResponse };

function NotScoredBadge({ colors }: { colors: Colors }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: colors.textMuted,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.full,
        padding: "1px 7px",
        whiteSpace: "nowrap"
      }}
    >
      External · not scored
    </span>
  );
}

function SectionHeader({ title, colors }: { title: string; colors: Colors }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        {title}
      </span>
      <NotScoredBadge colors={colors} />
    </div>
  );
}

export function PositionResearchPanel({ symbol, companyName, colors, upgradeHref = "/pricing" }: Props) {
  const [state, setState] = useState<PanelState>({ phase: "idle" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/stocvest/signals/position/research", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, company_name: companyName || undefined })
      });
      if (!res.ok) throw new Error("research request failed");
      const data = (await res.json()) as ResearchResponse;
      setState({ phase: "done", data });
    } catch {
      setState({ phase: "error" });
    }
  }, [symbol, companyName]);

  if (!positionResearchEnabled()) return null;

  const box = {
    padding: spacing[3],
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.md,
    background: colors.surface
  } as const;

  return (
    <section
      data-testid="position-research-panel"
      style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[2], flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Research
        </span>
        {state.phase !== "done" ? (
          <button
            type="button"
            onClick={() => void load()}
            disabled={state.phase === "loading"}
            data-testid="position-research-load"
            style={{
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.full,
              color: colors.accent,
              cursor: state.phase === "loading" ? "default" : "pointer",
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 12px",
              opacity: state.phase === "loading" ? 0.7 : 1
            }}
          >
            {state.phase === "loading" ? "Loading research…" : "Load research"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void load()}
            data-testid="position-research-reload"
            style={{
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.full,
              color: colors.accent,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 12px"
            }}
          >
            Refresh
          </button>
        )}
      </div>

      {state.phase === "idle" ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
          Pull external context for {symbol}: recent developments, the latest 10-K risk factors
          and key passages, and headline SEC financials. Informational only — never part of the
          STOCVEST signal.
        </p>
      ) : null}

      {state.phase === "error" ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.bearish }}>
          Couldn&apos;t load research right now. Try again.
        </p>
      ) : null}

      {state.phase === "done" && state.data.status === "upgrade_required" ? (
        <div style={box}>
          <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}>
            External research is a paid feature.{" "}
            <a href={upgradeHref} style={{ color: colors.accent, fontWeight: 700, textDecoration: "none" }}>
              ✦ Unlock research →
            </a>
          </p>
        </div>
      ) : null}

      {state.phase === "done" && state.data.status === "over_budget" ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
          Daily research limit reached — try again tomorrow.
        </p>
      ) : null}

      {state.phase === "done" && (state.data.status === "empty" || state.data.status === "disabled") ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
          No external research available for {symbol} right now.
        </p>
      ) : null}

      {state.phase === "done" && state.data.status === "ok" ? (
        <>
          {state.data.recent_developments ? (
            <div style={box} data-testid="position-research-recent">
              <SectionHeader title="Recent developments" colors={colors} />
              <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.6 }}>
                {state.data.recent_developments.summary}
              </p>
              {state.data.recent_developments.key_points.length > 0 ? (
                <ul style={{ margin: `${spacing[2]} 0 0`, paddingLeft: spacing[4], display: "flex", flexDirection: "column", gap: 4 }}>
                  {state.data.recent_developments.key_points.map((kp, i) => (
                    <li key={i} style={{ fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}>
                      {kp}
                    </li>
                  ))}
                </ul>
              ) : null}
              {state.data.recent_developments.sources.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[2] }}>
                  {state.data.recent_developments.sources.map((s, i) =>
                    s.url ? (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: typography.scale.xs,
                          color: colors.accent,
                          border: `1px solid ${colors.border}`,
                          borderRadius: borderRadius.full,
                          padding: "2px 8px",
                          textDecoration: "none"
                        }}
                      >
                        {s.title || s.url}
                      </a>
                    ) : (
                      <span key={i} style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                        {s.title}
                      </span>
                    )
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {state.data.risk_factors ? (
            <div style={box} data-testid="position-research-risk">
              <SectionHeader title={`Risk factors · ${state.data.risk_factors.form}`} colors={colors} />
              <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {state.data.risk_factors.excerpt}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: spacing[2], marginTop: spacing[2], flexWrap: "wrap" }}>
                <a
                  href={state.data.risk_factors.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: typography.scale.xs, color: colors.accent, fontWeight: 700, textDecoration: "none" }}
                >
                  Read the full 10-K →
                </a>
                {state.data.risk_factors.filing_date ? (
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                    Filed {state.data.risk_factors.filing_date}
                  </span>
                ) : null}
                {state.data.risk_factors.truncated ? (
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>excerpt truncated</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {state.data.financials && state.data.financials.facts.length > 0 ? (
            <div style={box} data-testid="position-research-financials">
              <SectionHeader title="SEC financials · latest FY" colors={colors} />
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: spacing[2] }}>
                <tbody>
                  {state.data.financials.facts.map((f) => (
                    <tr key={f.key} data-testid={`position-research-fact-${f.key}`} style={{ borderTop: `1px solid ${colors.border}` }}>
                      <th scope="row" style={{ textAlign: "left", padding: `${spacing[1]} 0`, fontSize: typography.scale.sm, fontWeight: 500, color: colors.textMuted }}>
                        {f.label}
                        {f.fiscal_year ? (
                          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, marginLeft: spacing[1] }}>
                            FY{f.fiscal_year}
                          </span>
                        ) : null}
                      </th>
                      <td style={{ textAlign: "right", padding: `${spacing[1]} 0`, fontSize: typography.scale.sm, fontWeight: 700, color: colors.text, fontVariantNumeric: "tabular-nums" }}>
                        {formatXbrlValue(f.value, f.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.data.financials.source_url ? (
                <a
                  href={state.data.financials.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block", marginTop: spacing[2], fontSize: typography.scale.xs, color: colors.accent, fontWeight: 700, textDecoration: "none" }}
                >
                  SEC filings →
                </a>
              ) : null}
              {(() => {
                const cc = state.data.financials_crosscheck;
                const rows = (cc?.rows ?? []).filter((r) => r.agrees !== null);
                if (!cc || rows.length === 0) return null;
                return (
                  <div data-testid="position-research-crosscheck" style={{ marginTop: spacing[3], paddingTop: spacing[2], borderTop: `1px solid ${colors.border}` }}>
                    <p style={{ margin: `0 0 ${spacing[1]} 0`, fontSize: typography.scale.xs, fontWeight: 700, color: colors.textMuted }}>
                      {cc.disagreements === 0
                        ? `SEC vs ${cc.provider} data — all headline lines match`
                        : `SEC vs ${cc.provider} data — ${cc.disagreements} line(s) differ`}
                    </p>
                    {rows.map((r) => (
                      <div
                        key={r.key}
                        data-testid={`position-research-crosscheck-${r.key}`}
                        style={{ display: "flex", justifyContent: "space-between", gap: spacing[2], fontSize: typography.scale.xs, color: colors.textMuted, padding: `1px 0` }}
                      >
                        <span>{r.label}{r.fiscal_year ? ` FY${r.fiscal_year}` : ""}</span>
                        <span style={{ color: r.agrees ? colors.textMuted : colors.caution, fontWeight: r.agrees ? 400 : 700, fontVariantNumeric: "tabular-nums" }}>
                          {r.agrees
                            ? "matches"
                            : `differs ${r.rel_diff != null ? `${(r.rel_diff * 100).toFixed(1)}%` : ""}`.trim()}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : null}

          {state.data.filings_digest && state.data.filings_digest.passages.length > 0 ? (
            <div style={box} data-testid="position-research-filings">
              <SectionHeader
                title={`From the 10-K · key passages${state.data.filings_digest.form ? ` · ${state.data.filings_digest.form}` : ""}`}
                colors={colors}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: spacing[2], marginTop: spacing[2] }}>
                {state.data.filings_digest.passages.map((p, i) => (
                  <div
                    key={i}
                    data-testid="position-research-filing-passage"
                    style={{ borderLeft: `2px solid ${colors.border}`, paddingLeft: spacing[2] }}
                  >
                    <span style={{ fontSize: typography.scale.xs, fontWeight: 700, color: colors.textMuted, letterSpacing: "0.04em" }}>
                      {p.section_label}
                    </span>
                    <p style={{ margin: `2px 0 0`, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.55 }}>
                      {p.text}
                    </p>
                  </div>
                ))}
              </div>
              {state.data.filings_digest.source_url ? (
                <a
                  href={state.data.filings_digest.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block", marginTop: spacing[2], fontSize: typography.scale.xs, color: colors.accent, fontWeight: 700, textDecoration: "none" }}
                >
                  Read the full 10-K →
                </a>
              ) : null}
            </div>
          ) : null}

          {state.data.disclaimer ? (
            <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
              {state.data.disclaimer}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
