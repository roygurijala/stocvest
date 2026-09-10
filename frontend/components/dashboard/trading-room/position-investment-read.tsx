"use client";

/**
 * PositionInvestmentRead — glass-box thesis + on-demand AI Investment Read (ADR-004 POS-AI-2).
 *
 * Renders the deterministic thesis packet built server-side (bull case / bear-watch /
 * open questions, each bullet tagged with its pillar F1-F5 or supporting layer) and an
 * optional paid-gated Claude narration (POST /v1/signals/ai/explanations,
 * type=position_setup_read). The backend is the source of truth for gating: free users get
 * the deterministic read back with `upgrade_available`, which surfaces an upgrade nudge. Any
 * failure silently keeps the deterministic read. The AI never sets or overrides pillar math.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PositionThesisPacket, ThesisBullet } from "@/lib/dashboard/trading-room/position-fundamentals-present";
import type { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";

type Colors = ReturnType<typeof useTheme>["colors"];

type Props = {
  symbol: string;
  packet: PositionThesisPacket;
  colors: Colors;
  upgradeHref?: string;
};

type ReadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; text: string; source: "ai" | "deterministic"; cached: boolean; upgradeAvailable: boolean };

/** Client-side mirror of the deterministic read — shown instantly before any AI call. */
function localDeterministicRead(symbol: string, packet: PositionThesisPacket): string {
  const parts = [`On the Long Term desk (long-horizon quality), ${symbol} reads ${packet.verdict} on fundamentals.`];
  if (packet.bullCase[0]) parts.push(`Bull: ${packet.bullCase[0].text}`);
  if (packet.bearCase[0]) parts.push(`Watch: ${packet.bearCase[0].text}`);
  if (packet.openQuestions[0]) parts.push(`Open question: ${packet.openQuestions[0].text}`);
  parts.push("Signal data only.");
  return parts.join(" ");
}

function ThesisColumn({
  title,
  bullets,
  accent,
  colors,
  testId
}: {
  title: string;
  bullets: ThesisBullet[];
  accent: string;
  colors: Colors;
  testId: string;
}) {
  return (
    <div style={{ flex: "1 1 220px", minWidth: 200 }} data-testid={testId}>
      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "1.2px",
          textTransform: "uppercase",
          color: accent
        }}
      >
        {title}
      </p>
      {bullets.length === 0 ? (
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
          None surfaced.
        </p>
      ) : (
        <ul style={{ margin: `${spacing[2]} 0 0`, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: spacing[2] }}>
          {bullets.map((b, i) => (
            <li key={`${b.source}-${i}`} style={{ fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}>
              <span>{b.text}</span>{" "}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: colors.textMuted,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.full,
                  padding: "1px 6px",
                  whiteSpace: "nowrap"
                }}
              >
                {b.source || "—"} · {b.confidence}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PositionInvestmentRead({ symbol, packet, colors, upgradeHref = "/pricing" }: Props) {
  const [state, setState] = useState<ReadState>({ phase: "idle" });
  const deterministic = useMemo(() => localDeterministicRead(symbol, packet), [symbol, packet]);

  // Reset when the host swaps ticker or the underlying pillars change.
  useEffect(() => {
    setState({ phase: "idle" });
  }, [symbol, packet.pillarSnapshotHash]);

  const fetchRead = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/stocvest/signals/ai/explanations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "position_setup_read",
          symbol,
          verdict: packet.verdict,
          packet: {
            bull_case: packet.bullCase,
            bear_case: packet.bearCase,
            open_questions: packet.openQuestions,
            pillar_snapshot_hash: packet.pillarSnapshotHash
          }
        })
      });
      if (!res.ok) throw new Error("ai read request failed");
      const j = (await res.json()) as {
        text?: string;
        source?: string;
        upgrade_available?: boolean;
        cached?: boolean;
      };
      const text = String(j.text || "").trim() || deterministic;
      setState({
        phase: "done",
        text,
        source: j.source === "ai" ? "ai" : "deterministic",
        cached: Boolean(j.cached),
        upgradeAvailable: Boolean(j.upgrade_available)
      });
    } catch {
      setState({ phase: "done", text: deterministic, source: "deterministic", cached: false, upgradeAvailable: false });
    }
  }, [symbol, packet, deterministic]);

  const isBusy = state.phase === "loading";
  const readText = state.phase === "done" ? state.text : deterministic;
  const source = state.phase === "done" ? state.source : "deterministic";

  return (
    <div
      data-testid="position-investment-read"
      style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[4] }}>
        <ThesisColumn title="Bull case" bullets={packet.bullCase} accent={colors.bullish} colors={colors} testId="thesis-bull" />
        <ThesisColumn title="Bear / watch" bullets={packet.bearCase} accent={colors.bearish} colors={colors} testId="thesis-bear" />
        <ThesisColumn title="Open questions" bullets={packet.openQuestions} accent={colors.caution} colors={colors} testId="thesis-open" />
      </div>

      <div
        style={{
          padding: `${spacing[3]} ${spacing[3]}`,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          background: colors.surface
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: spacing[2], marginBottom: spacing[2] }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            {source === "ai" ? "AI investment read" : "Investment read"}
          </span>
          {state.phase === "done" && source === "ai" && state.cached ? (
            <span style={{ fontSize: 9, color: colors.textMuted }}>cached</span>
          ) : null}
          {/* POS-D12 — informational-only disclaimer on the Position read (no advice). */}
          <span style={{ marginLeft: "auto" }}>
            <SignalDisclaimerChip />
          </span>
        </div>
        <p style={{ margin: 0, fontSize: typography.scale.sm, lineHeight: 1.6, color: colors.text }}>
          {isBusy ? `Reading the pillars for ${symbol}…` : readText}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: spacing[3], marginTop: spacing[2], flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void fetchRead()}
            disabled={isBusy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.full,
              color: colors.accent,
              cursor: isBusy ? "default" : "pointer",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.02em",
              padding: "4px 12px",
              opacity: isBusy ? 0.7 : 1
            }}
          >
            {state.phase === "done" ? "Regenerate read" : isBusy ? "Writing read…" : "✦ AI investment read"}
          </button>
          {state.phase === "done" && state.upgradeAvailable ? (
            <a href={upgradeHref} style={{ fontSize: 12, fontWeight: 700, color: colors.accent, textDecoration: "none" }}>
              ✦ Unlock AI-written reads →
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
