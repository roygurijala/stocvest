"use client";

/**
 * LayerAiExplain — on-demand, paid-gated Claude narration for ONE signal layer
 * (deep-dive "Explain this layer"). Mirrors PositionInvestmentRead: the deterministic
 * "Why this read" rationale is always shown by the drawer; this adds a plain-English
 * narration on explicit user action. The AI never changes the score/verdict — it only
 * narrates the deterministic rationale + drivers. Free users / failures get the
 * deterministic fallback. Glass-box: POST /v1/signals/ai/explanations, type=layer_read.
 */

import { useCallback, useState } from "react";
import type { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";

type Colors = ReturnType<typeof useTheme>["colors"];

export type LayerAiExplainProps = {
  symbol: string;
  desk: "day" | "swing" | "position";
  bias: string;
  layerKey: string;
  layerName: string;
  verdict: string;
  score: number | null;
  rationale: string;
  drivers: string[];
  colors: Colors;
  upgradeHref?: string;
};

type ReadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; text: string; source: "ai" | "deterministic"; cached: boolean; upgradeAvailable: boolean };

function localDeterministic(rationale: string, drivers: string[]): string {
  const parts: string[] = [];
  const r = (rationale || "").trim();
  if (r) parts.push(r);
  if (drivers.length > 0) parts.push(`Drivers: ${drivers.slice(0, 3).join("; ")}.`);
  parts.push("Signal data only.");
  return parts.join(" ");
}

export function LayerAiExplain({
  symbol,
  desk,
  bias,
  layerKey,
  layerName,
  verdict,
  score,
  rationale,
  drivers,
  colors,
  upgradeHref = "/pricing"
}: LayerAiExplainProps) {
  const [state, setState] = useState<ReadState>({ phase: "idle" });
  const deterministic = localDeterministic(rationale, drivers);

  const fetchRead = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/stocvest/signals/ai/explanations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "layer_read",
          symbol,
          desk,
          bias,
          fallback_text: deterministic,
          layer: { key: layerKey, name: layerName, verdict, score, rationale, drivers }
        })
      });
      if (!res.ok) throw new Error("ai layer read request failed");
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
  }, [symbol, desk, bias, layerKey, layerName, verdict, score, rationale, drivers, deterministic]);

  const isBusy = state.phase === "loading";

  return (
    <div data-testid="layer-ai-explain" style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      {state.phase === "done" ? (
        <div
          data-testid="layer-ai-explain-text"
          style={{
            padding: `${spacing[2]} ${spacing[3]}`,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: colors.surface
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: spacing[2], marginBottom: 4 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: colors.textMuted
              }}
            >
              {state.source === "ai" ? "AI explanation" : "Explanation"}
            </span>
            {state.source === "ai" && state.cached ? (
              <span style={{ fontSize: 9, color: colors.textMuted }}>cached</span>
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: typography.scale.sm, lineHeight: 1.6, color: colors.text }}>
            {state.text}
          </p>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: spacing[3], flexWrap: "wrap" }}>
        <button
          type="button"
          data-testid="layer-ai-explain-button"
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
          {state.phase === "done"
            ? "Regenerate explanation"
            : isBusy
              ? "Explaining…"
              : "✦ Explain this layer"}
        </button>
        {state.phase === "done" && state.upgradeAvailable ? (
          <a href={upgradeHref} style={{ fontSize: 12, fontWeight: 700, color: colors.accent, textDecoration: "none" }}>
            ✦ Unlock AI-written explanations →
          </a>
        ) : null}
      </div>
    </div>
  );
}
