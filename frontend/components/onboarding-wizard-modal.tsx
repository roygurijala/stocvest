"use client";

import { useState } from "react";

interface OnboardingWizardModalProps {
  onCompleted: () => void;
  onRemindLater: () => void;
}

export function OnboardingWizardModal({ onCompleted, onRemindLater }: OnboardingWizardModalProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function finish() {
    setErr(null);
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const res = await fetch("/api/stocvest/users/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ onboarding_completed: true, onboarding_completed_at: now })
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setErr(data.message || data.error || "Could not save.");
        return;
      }
      onCompleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9990,
        background: "rgba(7,13,24,0.88)",
        display: "grid",
        placeItems: "center",
        padding: 24
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#101b2e",
          border: "1px solid rgba(148,163,184,0.25)",
          borderRadius: 14,
          padding: 28
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, color: "#f8fafc" }}>Welcome to STOCVEST</h2>
        <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.5, color: "rgba(226,232,240,0.88)" }}>
          Explore the scanner for intraday setups, connect your broker from Portfolio when you are ready, and review the Performance page for historical signal outcomes. You can complete this walkthrough any time from Settings.
        </p>
        {err ? <p style={{ color: "#f87171", marginTop: 12, fontSize: 13 }}>{err}</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onRemindLater}
            style={{
              minHeight: 44,
              padding: "0 16px",
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.35)",
              background: "transparent",
              color: "#e2e8f0",
              cursor: "pointer"
            }}
          >
            Remind me later
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void finish()}
            style={{
              minHeight: 44,
              padding: "0 18px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, #0891b2, #2563eb)",
              color: "#fff",
              fontWeight: 600,
              cursor: busy ? "wait" : "pointer"
            }}
          >
            {busy ? "Saving…" : "Continue to dashboard"}
          </button>
        </div>
      </div>
    </div>
  );
}
