"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Shield } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { TradingModeModal } from "@/components/trading-mode-modal";

export type TradingModeUi = "paper" | "live";

export function TradingModeBadge() {
  const { colors } = useTheme();
  const [mode, setMode] = useState<TradingModeUi>("paper");
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/stocvest/profile/trading-mode", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { trading_mode?: string };
      if (data.trading_mode === "live" || data.trading_mode === "paper") {
        setMode(data.trading_mode);
      }
    } catch {
      /* keep default */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isPaper = mode === "paper";

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold uppercase tracking-wide"
        style={{
          fontSize: typography.scale.xs,
          background: isPaper ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
          color: isPaper ? colors.bullish : colors.bearish,
          border: `1px solid ${isPaper ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.55)"}`,
          cursor: "pointer",
          animation: isPaper ? undefined : "stocvest-pulse-live 2s ease-in-out infinite"
        }}
      >
        {isPaper ? <Shield size={14} /> : <AlertTriangle size={14} />}
        {isPaper ? "Paper" : "Live"}
      </button>
      <style jsx global>{`
        @keyframes stocvest-pulse-live {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.35);
          }
          50% {
            box-shadow: 0 0 0 6px rgba(239, 68, 68, 0);
          }
        }
      `}</style>
      <TradingModeModal
        open={modalOpen}
        initialMode={mode}
        onClose={() => setModalOpen(false)}
        onModeChange={(m) => setMode(m)}
      />
    </>
  );
}
