"use client";

import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { borderRadius, colorTokens, spacing, typography } from "@/lib/design-system";

interface SettingsPageClientProps {
  email: string;
}

export function SettingsPageClient({ email }: SettingsPageClientProps) {
  const colors = colorTokens.dark;
  const [confirmText, setConfirmText] = useState("");
  const [emailNotif, setEmailNotif] = useState(true);
  const [pushNotif, setPushNotif] = useState(false);

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
        <h3 style={{ marginTop: 0 }}>Broker Connections</h3>
        <div style={{ display: "grid", gap: spacing[2] }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>IBKR</span>
            <button type="button">Connect IB Gateway</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>ETrade</span>
            <button type="button">Connect ETrade</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: colors.bullish }}>
            <span>MOCK</span>
            <span>Connected</span>
          </div>
        </div>
      </article>

      <article style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
        <h3 style={{ marginTop: 0 }}>Notifications</h3>
        <label style={{ display: "flex", justifyContent: "space-between" }}>
          Email Alerts
          <input type="checkbox" checked={emailNotif} onChange={(e) => setEmailNotif(e.target.checked)} />
        </label>
        <label style={{ display: "flex", justifyContent: "space-between", marginTop: spacing[2] }}>
          Push Alerts
          <input type="checkbox" checked={pushNotif} onChange={(e) => setPushNotif(e.target.checked)} />
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
          disabled={confirmText !== "DELETE"}
          style={{ marginTop: spacing[2], background: colors.bearish, color: "white", border: "none", borderRadius: borderRadius.md, padding: `${spacing[2]} ${spacing[3]}`, opacity: confirmText === "DELETE" ? 1 : 0.6 }}
        >
          Delete Account
        </button>
      </article>
    </section>
  );
}
