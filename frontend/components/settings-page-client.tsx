"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

interface SettingsPageClientProps {
  email: string;
}

export function SettingsPageClient({ email }: SettingsPageClientProps) {
  const { colors } = useTheme();
  const search = useSearchParams();
  const [confirmText, setConfirmText] = useState("");
  const [emailNotif, setEmailNotif] = useState(true);
  const [pushNotif, setPushNotif] = useState(false);
  const [etradeConnected, setEtradeConnected] = useState(false);
  const [etradeLastSync, setEtradeLastSync] = useState<string | null>(null);

  useEffect(() => {
    if (search.get("connected") === "etrade") {
      setEtradeConnected(true);
      setEtradeLastSync(new Date().toISOString());
    }
    if (search.get("error") === "etrade_auth_failed") {
      setEtradeConnected(false);
    }
  }, [search]);

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0 }}>Account</h3>
        <p style={{ margin: 0, color: colors.textMuted }}>Email: {email}</p>
        <span style={{ display: "inline-block", marginTop: spacing[2], borderRadius: borderRadius.full, background: "rgba(59,130,246,.15)", color: colors.accent, padding: "2px 8px", fontSize: typography.scale.xs }}>
          Pro
        </span>
      </article>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0 }}>Theme</h3>
        <ThemeToggle />
      </article>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0 }}>Connected Brokers</h3>
        <div style={{ display: "grid", gap: spacing[2] }}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>IBKR</span>
            <button type="button" className="min-h-11 w-full rounded-md border px-3 sm:w-auto" style={{ borderColor: colors.border }}>
              Connect IB Gateway
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2">
              E*TRADE
              {etradeConnected ? (
                <span className="inline-flex h-2 w-2 rounded-full" style={{ background: colors.bullish }} aria-hidden />
              ) : null}
            </span>
            {etradeConnected ? (
              <div className="flex flex-col items-stretch gap-1 text-sm sm:items-end" style={{ color: colors.textMuted }}>
                <span>
                  Account <span style={{ color: colors.text }}>****1234</span>
                </span>
                {etradeLastSync ? <span>Last sync: {new Date(etradeLastSync).toLocaleString()}</span> : null}
                <button
                  type="button"
                  className="text-left sm:text-right"
                  style={{ color: colors.bearish, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  onClick={() => {
                    setEtradeConnected(false);
                    setEtradeLastSync(null);
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <Link
                href="/api/auth/etrade/start"
                className="inline-flex min-h-11 items-center justify-center rounded-md border px-3 sm:w-auto"
                style={{ borderColor: colors.border, color: colors.accent }}
              >
                Connect E*TRADE
              </Link>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: colors.bullish }}>
            <span>MOCK</span>
            <span>Connected</span>
          </div>
        </div>
      </article>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0 }}>Notifications</h3>
        <label className="flex min-h-11 items-center justify-between gap-3">
          Email Alerts
          <input type="checkbox" className="h-6 w-6 shrink-0" checked={emailNotif} onChange={(e) => setEmailNotif(e.target.checked)} />
        </label>
        <label className="mt-2 flex min-h-11 items-center justify-between gap-3">
          Push Alerts
          <input type="checkbox" className="h-6 w-6 shrink-0" checked={pushNotif} onChange={(e) => setPushNotif(e.target.checked)} />
        </label>
      </article>

      <article style={{ background: "rgba(239,68,68,.08)", border: `1px solid rgba(239,68,68,.45)`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0, color: colors.bearish }}>Danger Zone</h3>
        <p style={{ margin: 0, color: colors.textMuted }}>Type DELETE to enable account deletion.</p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          style={{ width: "100%", marginTop: spacing[2], padding: spacing[2] }}
        />
        <button
          type="button"
          className="mt-2 min-h-11 w-full sm:w-auto"
          disabled={confirmText !== "DELETE"}
          style={{
            background: colors.bearish,
            color: "white",
            border: "none",
            borderRadius: borderRadius.md,
            padding: `${spacing[2]} ${spacing[3]}`,
            opacity: confirmText === "DELETE" ? 1 : 0.6
          }}
        >
          Delete Account
        </button>
      </article>
    </section>
  );
}
