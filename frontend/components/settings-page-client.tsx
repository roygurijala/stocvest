"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CuteLoader } from "@/components/cute-loader";
import { ThemeToggle } from "@/components/theme-toggle";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

interface SettingsPageClientProps {
  email: string;
}

type AlertPrefs = {
  email_enabled: boolean;
  on_signal_fired: boolean;
  on_confluence_alert: boolean;
  on_pdt_warning: boolean;
  on_pdt_blocked: boolean;
  on_gap_detected: boolean;
  watchlist_only: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

type AlertRow = { title: string; created_at: string; status: string };

export function SettingsPageClient({ email }: SettingsPageClientProps) {
  const { colors } = useTheme();
  const search = useSearchParams();
  const [confirmText, setConfirmText] = useState("");
  const [etradeConnected, setEtradeConnected] = useState(false);
  const [etradeLastSync, setEtradeLastSync] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  const [history, setHistory] = useState<AlertRow[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);

  const patchPref = useCallback(async (partial: Partial<AlertPrefs>) => {
    const res = await fetch("/api/stocvest/alerts/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(partial)
    });
    const body = (await res.json().catch(() => ({}))) as AlertPrefs;
    if (res.ok) {
      setPrefs(body);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1400);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pr, hi] = await Promise.all([
        fetch("/api/stocvest/alerts/preferences", { cache: "no-store" }),
        fetch("/api/stocvest/alerts/history?limit=10", { cache: "no-store" })
      ]);
      const pj = (await pr.json().catch(() => ({}))) as AlertPrefs;
      const hj = (await hi.json().catch(() => ({}))) as { alerts?: AlertRow[] };
      if (cancelled) return;
      if (pr.ok) setPrefs(pj);
      if (hi.ok) setHistory(hj.alerts ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <h3 style={{ marginTop: 0 }}>Account</h3>
        <p style={{ margin: 0, color: colors.textMuted }}>Email: {email}</p>
        <span style={{ display: "inline-block", marginTop: spacing[2], borderRadius: borderRadius.full, background: "rgba(59,130,246,.15)", color: colors.accent, padding: "2px 8px", fontSize: typography.scale.xs }}>
          Pro
        </span>
      </article>

      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <h3 style={{ marginTop: 0 }}>Theme</h3>
        <ThemeToggle />
      </article>

      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
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

      <article
        id="alerts"
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[2], flexWrap: "wrap" }}>
          <h3 style={{ marginTop: 0 }}>Alert Preferences</h3>
          {savedFlash ? (
            <span style={{ color: colors.bullish, fontSize: typography.scale.sm, fontWeight: 600 }}>Saved ✓</span>
          ) : null}
        </div>
        <p style={{ margin: `0 0 ${spacing[2]} 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>Current email: {email}</p>
        {prefs ? (
          <div style={{ display: "grid", gap: spacing[3] }}>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span>Email alerts</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                checked={prefs.email_enabled}
                onChange={(e) => void patchPref({ email_enabled: e.target.checked })}
              />
            </label>
            <label className={`flex min-h-11 items-center justify-between gap-3 ${!prefs.email_enabled ? "opacity-50" : ""}`}>
              <span>Signal fired on watchlist</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.on_signal_fired}
                onChange={(e) => void patchPref({ on_signal_fired: e.target.checked })}
              />
            </label>
            <p className="text-xs" style={{ margin: `-${spacing[2]} 0 0`, color: colors.textMuted }}>
              Get notified when a signal fires on any symbol in your watchlist.
            </p>
            <label className={`flex min-h-11 items-center justify-between gap-3 ${!prefs.email_enabled ? "opacity-50" : ""}`}>
              <span>Confluence alert</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.on_confluence_alert}
                onChange={(e) => void patchPref({ on_confluence_alert: e.target.checked })}
              />
            </label>
            <p className="text-xs" style={{ margin: `-${spacing[2]} 0 0`, color: colors.textMuted }}>
              High-priority — multiple signals aligning simultaneously.
            </p>
            <label className={`flex min-h-11 items-center justify-between gap-3 ${!prefs.email_enabled ? "opacity-50" : ""}`}>
              <span>PDT warning</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.on_pdt_warning}
                onChange={(e) => void patchPref({ on_pdt_warning: e.target.checked })}
              />
            </label>
            <p className="text-xs" style={{ margin: `-${spacing[2]} 0 0`, color: colors.textMuted }}>
              When 2 of 3 day trades are used.
            </p>
            <label className={`flex min-h-11 items-center justify-between gap-3 ${!prefs.email_enabled ? "opacity-50" : ""}`}>
              <span>PDT limit reached</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.on_pdt_blocked}
                onChange={(e) => void patchPref({ on_pdt_blocked: e.target.checked })}
              />
            </label>
            <label className={`flex min-h-11 items-center justify-between gap-3 ${!prefs.email_enabled ? "opacity-50" : ""}`}>
              <span>Pre-market gap detected</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.on_gap_detected}
                onChange={(e) => void patchPref({ on_gap_detected: e.target.checked })}
              />
            </label>
            <p className="text-xs" style={{ margin: `-${spacing[2]} 0 0`, color: colors.textMuted }}>
              When a quality gap is detected on your watchlist (off by default — noisy).
            </p>
            <label className={`flex min-h-11 items-center justify-between gap-3 ${!prefs.email_enabled ? "opacity-50" : ""}`}>
              <span>
                Watchlist symbols only <span style={{ color: colors.accent, fontSize: 10 }}>Recommended</span>
              </span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.watchlist_only}
                onChange={(e) => void patchPref({ watchlist_only: e.target.checked })}
              />
            </label>
            <label className={`flex min-h-11 items-center justify-between gap-3 ${!prefs.email_enabled ? "opacity-50" : ""}`}>
              <span>Enable quiet hours</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.quiet_hours_enabled}
                onChange={(e) => void patchPref({ quiet_hours_enabled: e.target.checked })}
              />
            </label>
            {prefs.quiet_hours_enabled ? (
              <div className="flex flex-wrap items-center gap-2" style={{ color: colors.textMuted }}>
                <span>From</span>
                <input
                  type="time"
                  className="rounded border px-2 py-1"
                  style={{ borderColor: colors.border, color: colors.text }}
                  value={prefs.quiet_hours_start.slice(0, 5)}
                  onChange={(e) => void patchPref({ quiet_hours_start: e.target.value })}
                />
                <span>To</span>
                <input
                  type="time"
                  className="rounded border px-2 py-1"
                  style={{ borderColor: colors.border, color: colors.text }}
                  value={prefs.quiet_hours_end.slice(0, 5)}
                  onChange={(e) => void patchPref({ quiet_hours_end: e.target.value })}
                />
                <span className="text-xs">No alerts during these hours (US/Eastern).</span>
              </div>
            ) : null}
            <div style={{ marginTop: spacing[2] }}>
              <h4 style={{ margin: `0 0 ${spacing[2]} 0`, fontSize: typography.scale.base }}>Recent Alerts</h4>
              {history.length === 0 ? (
                <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>No alerts sent yet.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: spacing[4], color: colors.text, fontSize: typography.scale.sm }}>
                  {history.map((h, i) => (
                    <li key={`${h.title}-${i}`} style={{ marginBottom: spacing[1] }}>
                      {h.title}{" "}
                      <span style={{ color: colors.textMuted }}>· {h.created_at?.slice(0, 16) || ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <CuteLoader label="Loading alert preferences" sublabel="Fetching notification settings" compact />
        )}
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
