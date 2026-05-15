"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { RefreshCw, Timer } from "lucide-react";

import {
  fetchAdminDashboardLoadTimings,
  postDashboardTimingMode,
  type DashboardTimingSettingsPayload
} from "@/lib/api/admin-dashboard-timing";
import { borderRadius, cardSurfaceStyle, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/**
 * Admin → Dashboard load timings — `/dashboard/admin/dashboard-timing`.
 *
 * Runtime toggle + the same P75 / SLO summary as `scripts/parse_dashboard_load_timing.ts`
 * when samples are buffered (see `docs/PERFORMANCE.md` §1).
 */
export function AdminDashboardTimingPageClient() {
  const { colors } = useTheme();
  const [state, setState] = useState<{
    loading: boolean;
    saving: boolean;
    settings: DashboardTimingSettingsPayload | null;
    formattedReport: string | null;
    redisConfigured: boolean | null;
    readFailed: boolean;
    error: string | null;
    saveError: string | null;
  }>({
    loading: true,
    saving: false,
    settings: null,
    formattedReport: null,
    redisConfigured: null,
    readFailed: false,
    error: null,
    saveError: null
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const outcome = await fetchAdminDashboardLoadTimings();
    if (!outcome.ok) {
      setState({
        loading: false,
        saving: false,
        settings: null,
        formattedReport: null,
        redisConfigured: null,
        readFailed: false,
        error: outcome.message,
        saveError: null
      });
      return;
    }
    setState({
      loading: false,
      saving: false,
      settings: outcome.data.settings,
      formattedReport: outcome.data.formattedReport,
      redisConfigured: outcome.data.redisConfigured,
      readFailed: outcome.data.readFailed === true,
      error: null,
      saveError: null
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSetMode = useCallback(
    async (mode: "on" | "off" | "default") => {
      setState((s) => ({ ...s, saving: true, saveError: null }));
      const result = await postDashboardTimingMode(mode);
      if (!result.ok) {
        setState((s) => ({ ...s, saving: false, saveError: result.message }));
        return;
      }
      setState((s) => ({ ...s, saving: false, settings: result.data }));
      await load();
    },
    [load]
  );

  const settings = state.settings;
  const canEditToggle =
    Boolean(settings?.redisConfigured) && settings?.envOverride === null && !state.saving;

  return (
    <div style={{ display: "grid", gap: spacing[5], maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "grid", gap: spacing[2] }}>
        <h1
          style={{
            margin: 0,
            color: colors.text,
            fontSize: typography.scale["2xl"],
            fontWeight: 700,
            letterSpacing: "-0.01em",
            display: "flex",
            alignItems: "center",
            gap: spacing[2]
          }}
        >
          <Timer size={22} aria-hidden /> Dashboard load timings
        </h1>
        <p
          style={{
            margin: 0,
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            maxWidth: "75ch",
            lineHeight: 1.55
          }}
        >
          Turn server-side <code style={{ color: colors.accent }}>[dashboard-load]</code> instrumentation on or
          off for this deployment (Redis-backed when Upstash is configured). View the same P75 / SLO summary
          below. Details: <code style={{ color: colors.accent }}>docs/PERFORMANCE.md</code> §1.{" "}
          <Link href="/dashboard/admin" style={{ color: colors.accent }}>
            ← Admin hub
          </Link>
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.loading || state.saving}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: spacing[2],
            padding: `${spacing[2]} ${spacing[3]}`,
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: "transparent",
            color: colors.text,
            fontSize: typography.scale.sm,
            cursor: state.loading || state.saving ? "wait" : "pointer"
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {state.error ? (
        <p style={{ margin: 0, color: colors.bearish, fontSize: typography.scale.sm }}>{state.error}</p>
      ) : null}

      {state.saveError ? (
        <p style={{ margin: 0, color: colors.bearish, fontSize: typography.scale.sm }} role="alert">
          {state.saveError}
        </p>
      ) : null}

      {state.loading ? (
        <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>Loading…</p>
      ) : null}

      {!state.loading && settings ? (
        <section
          data-testid="admin-dashboard-timing-controls"
          style={{
            ...cardSurfaceStyle(colors),
            padding: spacing[4],
            display: "grid",
            gap: spacing[3]
          }}
        >
          <h2
            style={{
              margin: 0,
              color: colors.text,
              fontSize: typography.scale.lg,
              fontWeight: 600
            }}
          >
            Instrumentation
          </h2>
          <dl
            style={{
              margin: 0,
              display: "grid",
              gap: spacing[2],
              fontSize: typography.scale.sm,
              color: colors.textMuted
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
              <dt style={{ fontWeight: 600, color: colors.text }}>Effective</dt>
              <dd style={{ margin: 0 }}>
                {settings.effectiveEnabled ? (
                  <span style={{ color: colors.bullish }}>On</span>
                ) : (
                  <span>Off</span>
                )}
              </dd>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
              <dt style={{ fontWeight: 600, color: colors.text }}>Vercel env</dt>
              <dd style={{ margin: 0 }}>
                {settings.envOverride === "on"
                  ? "STOCVEST_DASHBOARD_TIMING=1 (forces on — remove to use admin toggle)"
                  : settings.envOverride === "off"
                    ? "STOCVEST_DASHBOARD_TIMING=0 (forces off)"
                    : "Not set — Redis / dev default applies"}
              </dd>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
              <dt style={{ fontWeight: 600, color: colors.text }}>Admin Redis key</dt>
              <dd style={{ margin: 0 }}>
                {!settings.redisConfigured
                  ? "N/A (Upstash not configured on this server)"
                  : settings.redisToggle === null
                    ? "Default (production: off; development: on)"
                    : settings.redisToggle
                      ? "Forced on"
                      : "Forced off"}
              </dd>
            </div>
          </dl>
          <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
            <span style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>Set runtime preference:</span>
            <button
              type="button"
              disabled={!canEditToggle}
              onClick={() => void onSetMode("on")}
              style={timingButtonStyle(colors, canEditToggle)}
            >
              On
            </button>
            <button
              type="button"
              disabled={!canEditToggle}
              onClick={() => void onSetMode("off")}
              style={timingButtonStyle(colors, canEditToggle)}
            >
              Off
            </button>
            <button
              type="button"
              disabled={!canEditToggle}
              onClick={() => void onSetMode("default")}
              style={timingButtonStyle(colors, canEditToggle)}
            >
              Default (clear key)
            </button>
          </div>
          {!settings.redisConfigured ? (
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              Configure <code>UPSTASH_REDIS_REST_URL</code> and <code>UPSTASH_REDIS_REST_TOKEN</code> to enable
              the runtime switch and sample buffer.
            </p>
          ) : null}
          {settings.envOverride !== null ? (
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              Unset the Vercel environment variable to let this screen control timing.
            </p>
          ) : null}
        </section>
      ) : null}

      {!state.loading && state.formattedReport ? (
        <section
          style={{
            ...cardSurfaceStyle(colors),
            padding: spacing[4],
            overflow: "auto"
          }}
        >
          {state.readFailed ? (
            <p style={{ margin: `0 0 ${spacing[3]}`, color: colors.bearish, fontSize: typography.scale.sm }}>
              Redis read failed — samples may be unavailable until credentials are fixed.
            </p>
          ) : null}
          {state.redisConfigured === false ? (
            <p style={{ margin: `0 0 ${spacing[3]}`, color: colors.textMuted, fontSize: typography.scale.sm }}>
              Configure Upstash on this deployment to buffer samples from the dashboard server. Until then, use
              Vercel runtime logs and the repo script <code>scripts/parse_dashboard_load_timing.ts</code>.
            </p>
          ) : null}
          <pre
            style={{
              margin: 0,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: typography.scale.xs,
              color: colors.text,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              lineHeight: 1.5
            }}
          >
            {state.formattedReport}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function timingButtonStyle(
  colors: { border: string; text: string; textMuted: string },
  enabled: boolean
): CSSProperties {
  return {
    padding: `${spacing[2]} ${spacing[3]}`,
    borderRadius: borderRadius.md,
    border: `1px solid ${colors.border}`,
    background: "transparent",
    color: enabled ? colors.text : colors.textMuted,
    fontSize: typography.scale.sm,
    cursor: enabled ? "pointer" : "not-allowed"
  };
}
