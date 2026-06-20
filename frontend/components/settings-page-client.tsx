"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CuteLoader } from "@/components/cute-loader";
import { ThemeToggle } from "@/components/theme-toggle";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { brokersEnabled } from "@/lib/nav-features";
import { watchlistSignalsOpenAriaLabel, watchlistToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import { DEFAULT_UI_PLAN, PLAN_TIERS, planTierById } from "@/lib/subscription-plans";
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
  on_watchlist_maturation: boolean;
  on_execution_actionable?: boolean;
  on_tracked_plan_thesis?: boolean;
  watchlist_only: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

type AlertRow = {
  title: string;
  created_at: string;
  status: string;
  symbol?: string | null;
  alert_type?: string | null;
};

/** Short label for `alert_type` values from `GET /v1/alerts/history`. */
function alertHistoryTypeLabel(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  const t = raw.trim();
  const map: Record<string, string> = {
    signal_fired: "Signal",
    confluence_alert: "Confluence",
    pdt_warning: "PDT warning",
    pdt_blocked: "PDT blocked",
    gap_detected: "Gap",
    signal_expired: "Expired",
    watchlist_maturation: "Maturation",
    execution_actionable: "Execution actionable",
    tracked_plan_thesis: "Tracked plan thesis"
  };
  return map[t] ?? t.replace(/_/g, " ");
}

export function SettingsPageClient({ email }: SettingsPageClientProps) {
  const { colors } = useTheme();
  const search = useSearchParams();
  const [confirmText, setConfirmText] = useState("");

  usePublishAssistantContext({ page: "dashboard/settings" });
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

  const activePlan = planTierById(DEFAULT_UI_PLAN) ?? PLAN_TIERS[1];

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <h3 style={{ marginTop: 0 }}>Account</h3>
        <p style={{ margin: 0, color: colors.textMuted }}>Email: {email}</p>
        <span
          style={{
            display: "inline-block",
            marginTop: spacing[2],
            borderRadius: borderRadius.full,
            background: "rgba(59,130,246,.15)",
            color: colors.accent,
            padding: "2px 10px",
            fontSize: typography.scale.xs,
            fontWeight: 700
          }}
        >
          Plan: {activePlan.name}
        </span>
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.55 }}>
          STOCVEST is <strong style={{ color: colors.text }}>swing-first</strong>: the six-layer composite is the same engine for swing and day
          horizons; billing tiers only change limits and which surfaces are unlocked. Checkout will land here when subscriptions go live.
        </p>
        <p style={{ margin: `${spacing[3]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.55 }}>
          <Link href="/dashboard/legal" style={{ color: colors.accent, fontWeight: 600 }}>
            View legal agreements you accepted
          </Link>{" "}
          (version, date, and links to Terms, Privacy, and risk disclosure).
        </p>
      </article>

      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <h3 style={{ marginTop: 0 }}>Plans (preview)</h3>
        <p style={{ margin: `0 0 ${spacing[3]}`, color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
          Three tiers: free swing with a peek at day mode, full swing, then swing + day together. Names and limits can move—structure matches
          how we will gate features.
        </p>
        <div style={{ display: "grid", gap: spacing[3] }}>
          {PLAN_TIERS.map((p) => (
            <div
              key={p.id}
              style={{
                border: `1px solid ${p.id === activePlan.id ? colors.accent : colors.border}`,
                borderRadius: borderRadius.lg,
                padding: spacing[3],
                background: p.id === activePlan.id ? "rgba(59,130,246,0.06)" : "transparent"
              }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong style={{ color: colors.text }}>{p.name}</strong>
                {p.id === activePlan.id ? (
                  <span style={{ fontSize: typography.scale.xs, fontWeight: 700, color: colors.accent }}>Current (UI default)</span>
                ) : null}
              </div>
              <p style={{ margin: `${spacing[1]} 0`, fontSize: typography.scale.sm, color: colors.textMuted }}>{p.tagline}</p>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.5 }}>
                {p.highlights.map((h, i) => (
                  <li key={`${p.id}-h-${i}`}>{h}</li>
                ))}
              </ul>
              <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
                Swing depth: <strong style={{ color: colors.text }}>{p.swing}</strong> · Day trading:{" "}
                <strong style={{ color: colors.text }}>{p.dayTrading}</strong>
              </p>
            </div>
          ))}
        </div>
      </article>

      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <h3 style={{ marginTop: 0 }}>Theme</h3>
        <ThemeToggle />
      </article>

      {brokersEnabled() ? (
        <article
          data-testid="settings-connected-brokers-card"
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
      ) : null}

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
              <span>Watchlist maturation updates</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.on_watchlist_maturation ?? true}
                onChange={(e) => void patchPref({ on_watchlist_maturation: e.target.checked })}
              />
            </label>
            <p className="text-xs" style={{ margin: `-${spacing[2]} 0 0`, color: colors.textMuted }}>
              When a symbol on your default watchlist moves between maturation states after you run evidence (e.g. Developing →
              Actionable).
            </p>
            <label className={`flex min-h-11 items-center justify-between gap-3 ${!prefs.email_enabled ? "opacity-50" : ""}`}>
              <span>Execution actionable (desk funnel)</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.on_execution_actionable ?? true}
                onChange={(e) => void patchPref({ on_execution_actionable: e.target.checked })}
              />
            </label>
            <p className="text-xs" style={{ margin: `-${spacing[2]} 0 0`, color: colors.textMuted }}>
              Email when any symbol crosses into execution-ready on the opportunity desk (ledger gates + price in entry zone).
              Applies to the whole desk — not limited by “Watchlist symbols only” below. One email per symbol per day.
            </p>
            <label className={`flex min-h-11 items-center justify-between gap-3 ${!prefs.email_enabled ? "opacity-50" : ""}`}>
              <span>Tracked plan thesis changes</span>
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0"
                disabled={!prefs.email_enabled}
                checked={prefs.on_tracked_plan_thesis ?? true}
                onChange={(e) => void patchPref({ on_tracked_plan_thesis: e.target.checked })}
              />
            </label>
            <p className="text-xs" style={{ margin: `-${spacing[2]} 0 0`, color: colors.textMuted }}>
              Email when a plan you tracked weakens or invalidates vs live desk read. Your frozen levels are not changed.
              One email per plan per status per day.
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
            <p className="text-xs" style={{ margin: `-${spacing[2]} 0 0`, color: colors.textMuted }}>
              Limits signal-fired, confluence, gap, and maturation emails to your default watchlist. Does not limit
              execution-actionable desk alerts or tracked-plan thesis alerts above.
            </p>
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
                <ul
                  data-testid="settings-recent-alerts-list"
                  style={{ margin: 0, paddingLeft: spacing[4], color: colors.text, fontSize: typography.scale.sm }}
                >
                  {history.map((h, i) => {
                    const symRaw = h.symbol != null ? String(h.symbol).trim() : "";
                    const sym = symRaw ? symRaw.toUpperCase() : "—";
                    const kind = alertHistoryTypeLabel(h.alert_type);
                    return (
                      <li key={`${h.created_at}-${h.title}-${i}`} style={{ marginBottom: spacing[1], lineHeight: 1.45 }}>
                        {symRaw ? (
                          <Link
                            href={watchlistToSignalsHref(symRaw)}
                            prefetch={false}
                            aria-label={watchlistSignalsOpenAriaLabel(symRaw)}
                            style={{ color: colors.text, fontWeight: 700, textDecoration: "none" }}
                            className="hover:underline"
                          >
                            {sym}
                          </Link>
                        ) : (
                          <strong style={{ color: colors.text }}>{sym}</strong>
                        )}
                        {kind ? (
                          <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}> ({kind})</span>
                        ) : null}
                        <span style={{ color: colors.text }}> — {h.title}</span>{" "}
                        <span style={{ color: colors.textMuted }}>· {h.created_at?.slice(0, 16) || ""}</span>
                      </li>
                    );
                  })}
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
