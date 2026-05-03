"use client";

import { useCallback, useState } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  symbol: string;
};

export function AddToWatchlistButton({ symbol }: Props) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState<"idle" | "added" | "err">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const onAdd = useCallback(async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setPhase("idle");
    setMsg(null);
    try {
      const res = await fetch("/api/stocvest/watchlists/default/symbols", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: sym })
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.status === 400 && (data as { error?: string }).error === "symbol_limit") {
        setMsg("Watchlist full (50 symbols)");
        setPhase("err");
        return;
      }
      if (!res.ok) {
        setMsg((data as { message?: string }).message || "Could not add symbol");
        setPhase("err");
        return;
      }
      setPhase("added");
      setMsg(`${sym} added to watchlist`);
      window.setTimeout(() => {
        setPhase("idle");
        setMsg(null);
      }, 2200);
    } catch {
      setMsg("Network error");
      setPhase("err");
    }
  }, [symbol]);

  const label = phase === "added" ? "Added ✓" : "+ Watchlist";

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <button
        type="button"
        onClick={() => void onAdd()}
        style={{
          border: `1px dashed ${phase === "added" ? colors.bullish : colors.accent}`,
          borderRadius: borderRadius.md,
          background: phase === "added" ? "rgba(34,197,94,0.12)" : "rgba(59,130,246,0.08)",
          color: phase === "added" ? colors.bullish : colors.text,
          padding: `${spacing[1]} ${spacing[2]}`,
          cursor: "pointer",
          fontSize: typography.scale.xs,
          fontWeight: 600
        }}
      >
        {label}
      </button>
      {msg && phase === "err" ? (
        <span role="status" style={{ fontSize: 10, color: colors.bearish }}>
          {msg}
        </span>
      ) : msg && phase === "added" ? (
        <span role="status" style={{ fontSize: 10, color: colors.bullish }}>
          {msg}
        </span>
      ) : null}
    </span>
  );
}
