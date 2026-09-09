"use client";

/**
 * PositionResearchPanel — external Research context for the Position deep-dive (ADR-004 POS-AI-4).
 *
 * Loads on demand (never auto-fetches — protects the per-user/day budget) from the paid,
 * flag-gated `POST /v1/signals/position/research` (via the BFF). Shows a cited "recent
 * developments" summary (Perplexity) and a truncated SEC 10-K "Item 1A · Risk Factors"
 * excerpt with a link to the filing. Every external block is badged "External · not scored":
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

type ResearchResponse = {
  status: "ok" | "disabled" | "upgrade_required" | "over_budget" | "empty";
  recent_developments: RecentDevelopments | null;
  risk_factors: RiskFactors | null;
  upgrade_available?: boolean;
  disclaimer?: string;
};

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
          Pull external context for {symbol}: recent developments and the latest 10-K risk factors.
          Informational only — never part of the STOCVEST signal.
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
