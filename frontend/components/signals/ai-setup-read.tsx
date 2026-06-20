"use client";

/**
 * AiSetupRead — the optional "AI read" expander for the deep-dive / evidence brief.
 *
 * The deterministic rich brief is always shown by the host. This adds an on-demand,
 * paid-gated Claude-written narrative (POST /v1/signals/ai/explanations, type=setup_read)
 * that weaves the actual layer reads, named signals, catalysts, timing and regime into a
 * fresh, per-ticker paragraph. The backend is the source of truth for gating: free users
 * get the deterministic text back with `upgrade_available`, which surfaces an upgrade nudge.
 * Any failure silently keeps the deterministic brief. Mounted on both the Trading Room deep
 * dive and the Signals evidence card so the two surfaces stay consistent.
 */

import { useCallback, useEffect, useState } from "react";

export interface AiSetupReadPalette {
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  surface: string;
}

export interface AiSetupReadProps {
  symbol: string;
  direction: string;
  desk: "day" | "swing";
  layers: Array<{ layer: string; status: string }>;
  confirming?: string[];
  conflicting?: string[];
  catalysts?: string[];
  timing?: string;
  primaryBlocker?: string;
  marketRegime?: string;
  fallbackText: string;
  palette: AiSetupReadPalette;
  /** Optional override for the pricing/upgrade link. */
  upgradeHref?: string;
}

type ReadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | {
      phase: "done";
      text: string;
      source: "ai" | "deterministic";
      cached: boolean;
      upgradeAvailable: boolean;
    };

export function AiSetupRead(props: AiSetupReadProps) {
  const [state, setState] = useState<ReadState>({ phase: "idle" });
  const { palette } = props;
  const upgradeHref = props.upgradeHref ?? "/pricing";

  // Reset to idle when the host swaps to a different setup (symbol/direction/desk).
  // Without this, switching tickers would keep showing the previous ticker's read.
  useEffect(() => {
    setState({ phase: "idle" });
  }, [props.symbol, props.direction, props.desk]);

  const fetchRead = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/stocvest/signals/ai/explanations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "setup_read",
          symbol: props.symbol,
          direction: props.direction,
          desk: props.desk,
          layers: props.layers,
          confirming: props.confirming ?? [],
          conflicting: props.conflicting ?? [],
          catalysts: props.catalysts ?? [],
          timing: props.timing ?? "",
          primary_blocker: props.primaryBlocker ?? "",
          market_regime: props.marketRegime ?? "",
          fallback_text: props.fallbackText
        })
      });
      if (!res.ok) throw new Error("ai read request failed");
      const j = (await res.json()) as {
        text?: string;
        source?: string;
        upgrade_available?: boolean;
        cached?: boolean;
      };
      const text = String(j.text || "").trim() || props.fallbackText;
      setState({
        phase: "done",
        text,
        source: j.source === "ai" ? "ai" : "deterministic",
        cached: Boolean(j.cached),
        upgradeAvailable: Boolean(j.upgrade_available)
      });
    } catch {
      setState({
        phase: "done",
        text: props.fallbackText,
        source: "deterministic",
        cached: false,
        upgradeAvailable: false
      });
    }
  }, [
    props.symbol,
    props.direction,
    props.desk,
    props.layers,
    props.confirming,
    props.conflicting,
    props.catalysts,
    props.timing,
    props.primaryBlocker,
    props.marketRegime,
    props.fallbackText
  ]);

  const isBusy = state.phase === "loading";
  const buttonLabel =
    state.phase === "done" ? "Regenerate AI read" : isBusy ? "Writing read…" : "✦ AI read";

  return (
    <div style={{ marginTop: 10 }} data-testid="ai-setup-read">
      <button
        type="button"
        onClick={() => void fetchRead()}
        disabled={isBusy}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          border: `1px solid ${palette.border}`,
          borderRadius: 999,
          color: palette.accent,
          cursor: isBusy ? "default" : "pointer",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.02em",
          padding: "4px 12px",
          opacity: isBusy ? 0.7 : 1
        }}
      >
        {buttonLabel}
      </button>

      {state.phase === "loading" ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, fontStyle: "italic", color: palette.textMuted }}>
          Reading the layers for {props.symbol}…
        </p>
      ) : null}

      {state.phase === "done" ? (
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            border: `1px solid ${palette.border}`,
            borderRadius: 8,
            background: palette.surface
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: palette.textMuted
              }}
            >
              {state.source === "ai" ? "AI read" : "Standard read"}
            </span>
            {state.source === "ai" && state.cached ? (
              <span style={{ fontSize: 9, color: palette.textMuted }}>cached</span>
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: palette.text }}>{state.text}</p>
          {state.upgradeAvailable ? (
            <a
              href={upgradeHref}
              style={{
                display: "inline-block",
                marginTop: 8,
                fontSize: 12,
                fontWeight: 700,
                color: palette.accent,
                textDecoration: "none"
              }}
            >
              ✦ Unlock AI-written reads for every ticker →
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
