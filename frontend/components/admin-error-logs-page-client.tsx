"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { AdminApiErrorCard } from "@/components/admin/admin-api-error-card";
import {
  fetchAdminErrorLogsDiagnostic,
  type AdminErrorLogRow,
  type AdminErrorLogsResponse
} from "@/lib/api/admin-error-logs";
import type { AdminApiReadError } from "@/lib/api/admin-users";
import { borderRadius, cardSurfaceStyle, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const DEFAULT_DAYS = 7;
const FETCH_LIMIT = 400;

/**
 * Admin → Error logs — `/dashboard/admin/error-logs`.
 *
 * Read-only view of Lambda log lines matched by a bounded CloudWatch Logs
 * Insights query (last N days, admin-gated upstream).
 */
export function AdminErrorLogsPageClient() {
  const { colors } = useTheme();
  const [state, setState] = useState<{
    loading: boolean;
    data: AdminErrorLogsResponse | null;
    error: AdminApiReadError | null;
  }>({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    setState({ loading: true, data: null, error: null });
    const outcome = await fetchAdminErrorLogsDiagnostic({
      days: DEFAULT_DAYS,
      limit: FETCH_LIMIT
    });
    if (outcome.kind === "error") {
      setState({ loading: false, data: null, error: outcome.error });
      return;
    }
    setState({ loading: false, data: outcome.data, error: null });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = state.data?.statistics ?? {};
  const recordsMatched =
    typeof stats.recordsMatched === "number" && Number.isFinite(stats.recordsMatched)
      ? stats.recordsMatched
      : typeof stats.recordsMatched === "string"
        ? Number(stats.recordsMatched)
        : null;

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
          <AlertTriangle size={22} aria-hidden /> Error logs
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
          Last {DEFAULT_DAYS} days of Lambda log lines that match common error signatures (ERROR, exceptions,
          timeouts). Data comes from CloudWatch Logs Insights over API function groups for this environment.{" "}
          <Link href="/dashboard/admin" style={{ color: colors.accent }}>
            ← Admin hub
          </Link>
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.loading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: spacing[2],
            padding: `${spacing[2]} ${spacing[4]}`,
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            fontSize: typography.scale.sm,
            fontWeight: 600,
            cursor: state.loading ? "wait" : "pointer",
            opacity: state.loading ? 0.7 : 1
          }}
        >
          <RefreshCw size={16} aria-hidden />
          Refresh
        </button>
        {state.data ? (
          <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
            Window: {state.data.window_start} → {state.data.window_end} · Prefix:{" "}
            <code style={{ color: colors.accent }}>{state.data.log_group_prefix || "—"}</code>
            {recordsMatched != null && Number.isFinite(recordsMatched)
              ? ` · Insights matched ~${Math.round(recordsMatched)} raw rows`
              : null}
          </span>
        ) : null}
      </div>

      {state.error ? <AdminApiErrorCard error={state.error} onRetry={() => void load()} testId="admin-error-logs-card" /> : null}

      {state.loading && !state.data ? (
        <div style={{ ...cardSurfaceStyle(colors, "neutral"), padding: spacing[4], borderRadius: borderRadius.lg }}>
          Loading CloudWatch results…
        </div>
      ) : null}

      {state.data?.query_error ? (
        <div
          data-testid="admin-error-logs-query-error"
          style={{
            ...cardSurfaceStyle(colors, "caution"),
            padding: spacing[4],
            borderRadius: borderRadius.lg,
            fontSize: typography.scale.sm
          }}
        >
          <strong>Insights query did not complete cleanly.</strong> {state.data.query_error}
        </div>
      ) : null}

      {state.data && state.data.items.length === 0 && !state.loading ? (
        <div style={{ ...cardSurfaceStyle(colors, "neutral"), padding: spacing[4], borderRadius: borderRadius.lg }}>
          <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>
            No matching error lines in the selected window. Either the fleet is quiet, log retention expired, or the
            prefix does not match your deployed log group names.
          </p>
          {state.data.log_groups.length > 0 ? (
            <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
              Queried {state.data.log_groups.length} log group(s).
            </p>
          ) : (
            <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
              No log groups matched the configured prefix.
            </p>
          )}
        </div>
      ) : null}

      {state.data && state.data.items.length > 0 ? (
        <div
          style={{
            overflowX: "auto",
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.border}`,
            background: colors.surface
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: typography.scale.sm
            }}
          >
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.textMuted, textAlign: "left" }}>
                <th style={{ padding: spacing[3], whiteSpace: "nowrap" }}>Time (UTC)</th>
                <th style={{ padding: spacing[3], whiteSpace: "nowrap" }}>Log group</th>
                <th style={{ padding: spacing[3] }}>Message</th>
              </tr>
            </thead>
            <tbody>
              {state.data.items.map((row: AdminErrorLogRow, i: number) => (
                <tr key={`${row.timestamp}-${i}`} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td
                    style={{
                      padding: spacing[3],
                      verticalAlign: "top",
                      color: colors.textMuted,
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums"
                    }}
                  >
                    {row.timestamp || "—"}
                  </td>
                  <td
                    style={{
                      padding: spacing[3],
                      verticalAlign: "top",
                      color: colors.accent,
                      maxWidth: 280,
                      wordBreak: "break-all",
                      fontSize: typography.scale.xs
                    }}
                  >
                    {row.log_group || "—"}
                  </td>
                  <td
                    style={{
                      padding: spacing[3],
                      verticalAlign: "top",
                      color: colors.text,
                      fontFamily: "ui-monospace, monospace",
                      fontSize: typography.scale.xs,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word"
                    }}
                  >
                    {row.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
