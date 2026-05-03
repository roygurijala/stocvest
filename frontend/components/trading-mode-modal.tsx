"use client";

import { useEffect, useState } from "react";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { TradingModeUi } from "@/components/trading-mode-badge";

interface TradingModeModalProps {
  open: boolean;
  initialMode: TradingModeUi;
  onClose: () => void;
  onModeChange?: (mode: TradingModeUi) => void;
}

export function TradingModeModal({ open, initialMode, onClose, onModeChange }: TradingModeModalProps) {
  const { colors } = useTheme();
  const [step, setStep] = useState<"pick" | "live_warn" | "live_confirm" | "done">("pick");
  const [target, setTarget] = useState<TradingModeUi>(initialMode);
  const [phrase, setPhrase] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTarget(initialMode);
      setStep("pick");
      setPhrase("");
      setMessage(null);
    }
  }, [open, initialMode]);

  if (!open) return null;

  async function persist(mode: TradingModeUi) {
    const res = await fetch("/api/stocvest/profile/trading-mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trading_mode: mode })
    });
    if (!res.ok) {
      setMessage("Could not save preference. Try again.");
      return;
    }
    onModeChange?.(mode);
    setMessage(mode === "paper" ? "Switched to Paper Trading. Orders will use simulated execution." : null);
    setStep("done");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-modal
    >
      <div
        className={`max-h-[90vh] w-full max-w-md overflow-y-auto p-4 ${surfaceGlowClassName}`}
        style={{ background: colors.surface, borderRadius: borderRadius.xl, border: `1px solid ${colors.border}` }}
      >
        {step === "pick" ? (
          <>
            <h2 style={{ marginTop: 0 }}>Trading mode</h2>
            <p style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>Choose how orders should execute.</p>
            <div style={{ display: "grid", gap: spacing[2], marginTop: spacing[3] }}>
              <button
                type="button"
                className="min-h-11 w-full rounded-md border px-3"
                style={{ borderColor: colors.border, color: colors.text }}
                onClick={() => void persist("paper")}
              >
                Switch to Paper
              </button>
              <button
                type="button"
                className="min-h-11 w-full rounded-md border px-3"
                style={{ borderColor: colors.bearish, color: colors.bearish, background: "rgba(239,68,68,0.08)" }}
                onClick={() => {
                  setTarget("live");
                  setStep("live_warn");
                }}
              >
                Switch to Live
              </button>
              <button type="button" className="min-h-11 w-full text-sm" style={{ color: colors.textMuted }} onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {step === "live_warn" ? (
          <div style={{ background: "rgba(239,68,68,0.12)", padding: spacing[3], borderRadius: borderRadius.lg }}>
            <h2 style={{ marginTop: 0, color: colors.bearish }}>Real money at risk</h2>
            <p style={{ color: colors.text, fontSize: typography.scale.sm }}>
              Live trading sends real orders to your brokerage. You can lose money. Only continue if you understand the
              risks.
            </p>
            <button
              type="button"
              className="mt-3 min-h-11 w-full rounded-md px-3"
              style={{ background: colors.bearish, color: "white", border: "none" }}
              onClick={() => setStep("live_confirm")}
            >
              Continue
            </button>
            <button type="button" className="mt-2 min-h-11 w-full text-sm" style={{ color: colors.textMuted }} onClick={() => setStep("pick")}>
              Back
            </button>
          </div>
        ) : null}

        {step === "live_confirm" ? (
          <>
            <h2 style={{ marginTop: 0 }}>Confirm live trading</h2>
            <p style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
              Type the phrase exactly (all caps) to enable live trading.
            </p>
            <input
              className="mt-2 w-full rounded-md border px-3 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="CONFIRM LIVE TRADING"
              autoComplete="off"
            />
            <button
              type="button"
              className="mt-3 min-h-11 w-full rounded-md px-3"
              style={{
                background: phrase === "CONFIRM LIVE TRADING" ? colors.bearish : colors.border,
                color: "white",
                border: "none",
                opacity: phrase === "CONFIRM LIVE TRADING" ? 1 : 0.5
              }}
              disabled={phrase !== "CONFIRM LIVE TRADING"}
              onClick={() => void persist("live")}
            >
              Enable live trading
            </button>
            <button type="button" className="mt-2 min-h-11 w-full text-sm" style={{ color: colors.textMuted }} onClick={() => setStep("live_warn")}>
              Back
            </button>
          </>
        ) : null}

        {step === "done" && message ? (
          <>
            <p style={{ marginTop: 0 }}>{message}</p>
            <button type="button" className="min-h-11 w-full rounded-md border px-3" style={{ borderColor: colors.border }} onClick={onClose}>
              Close
            </button>
          </>
        ) : null}

        {step === "done" && !message ? (
          <>
            <p style={{ marginTop: 0 }}>Live trading enabled. Your account is set to LIVE — real broker orders may apply.</p>
            <button type="button" className="min-h-11 w-full rounded-md border px-3" style={{ borderColor: colors.border }} onClick={onClose}>
              Close
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
