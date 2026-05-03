"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

const LEGAL_VERSION = "1.0";

interface LegalAcknowledgmentModalProps {
  onCompleted: () => void;
}

export function LegalAcknowledgmentModal({ onCompleted }: LegalAcknowledgmentModalProps) {
  const [c1, setC1] = useState(false);
  const [c2, setC2] = useState(false);
  const [c3, setC3] = useState(false);
  const [c4, setC4] = useState(false);
  const [c5, setC5] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allChecked = useMemo(() => c1 && c2 && c3 && c4 && c5, [c1, c2, c3, c4, c5]);

  async function submit() {
    if (!allChecked) return;
    setErr(null);
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const res = await fetch("/api/stocvest/users/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          legal_acknowledged: true,
          legal_acknowledged_at: now,
          legal_acknowledged_version: LEGAL_VERSION
        })
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setErr(data.message || data.error || "Could not save acknowledgment.");
        return;
      }
      onCompleted();
    } finally {
      setBusy(false);
    }
  }

  const row = (id: string, checked: boolean, onChange: (v: boolean) => void, label: ReactNode) => (
    <label
      key={id}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        cursor: "pointer",
        fontSize: 14,
        lineHeight: 1.45,
        color: "rgba(226,232,240,0.92)"
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>{label}</span>
    </label>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(7,13,24,0.97)",
        display: "grid",
        placeItems: "center",
        padding: 24
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#0c1828",
          border: "1px solid rgba(0,180,255,0.15)",
          borderRadius: 16,
          padding: 40,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)"
        }}
      >
        <p style={{ margin: 0, fontWeight: 800, letterSpacing: "0.06em", fontSize: 12, color: "rgba(0,180,255,0.85)" }}>STOCVEST</p>
        <h1 style={{ margin: "12px 0 0", fontSize: 22, fontWeight: 700, color: "#f8fafc" }}>Before you start</h1>
        <p style={{ margin: "16px 0 0", fontSize: 14, lineHeight: 1.55, color: "rgba(226,232,240,0.88)" }}>
          STOCVEST is a signal intelligence platform, not a registered investment adviser.
          <br />
          <br />
          By continuing, you confirm you understand:
        </p>
        <div style={{ display: "grid", gap: 14, marginTop: 22 }}>
          {row("c1", c1, setC1, <>Signals are for informational purposes only — not investment advice</>)}
          {row("c2", c2, setC2, <>You are solely responsible for all trading decisions and their outcomes</>)}
          {row("c3", c3, setC3, <>Past signal accuracy does not guarantee future results</>)}
          {row("c4", c4, setC4, <>Trading involves substantial risk of loss</>)}
          {row(
            "c5",
            c5,
            setC5,
            <>
              You have read and agree to the{" "}
              <Link href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8" }}>
                Terms of Service
              </Link>
            </>
          )}
        </div>
        {err ? <p style={{ color: "#f87171", marginTop: 16, fontSize: 13 }}>{err}</p> : null}
        <button
          type="button"
          disabled={!allChecked || busy}
          onClick={() => void submit()}
          style={{
            marginTop: 28,
            width: "100%",
            minHeight: 48,
            borderRadius: 10,
            border: "none",
            fontWeight: 700,
            fontSize: 15,
            cursor: allChecked && !busy ? "pointer" : "not-allowed",
            opacity: allChecked && !busy ? 1 : 0.55,
            background: allChecked ? "linear-gradient(135deg, #0891b2, #2563eb)" : "rgba(148,163,184,0.25)",
            color: "#fff"
          }}
        >
          {busy ? "Saving…" : "I Understand — Continue"}
        </button>
        <p style={{ margin: "14px 0 0", fontSize: 8, color: "rgba(148,163,184,0.75)", textAlign: "center" }}>
          Legal acknowledgment v{LEGAL_VERSION} · May 2026
        </p>
      </div>
    </div>
  );
}
