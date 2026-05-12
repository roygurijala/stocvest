"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, RefreshCw, ScrollText } from "lucide-react";

import {
  fetchRecentAuditEvents,
  statusCodeTone,
  type AuditEventRow,
  type RecentAuditResponse
} from "@/lib/api/admin-audit";
import {
  borderRadius,
  cardSurfaceStyle,
  spacing,
  typography
} from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const MODULES: { value: string; label: string }[] = [
  { value: "", label: "All modules" },
  { value: "signals", label: "signals" },
  { value: "brokers", label: "brokers" },
  { value: "market_data", label: "market_data" },
  { value: "portfolio", label: "portfolio" },
  { value: "journal", label: "journal" },
  { value: "scanner", label: "scanner" }
];

const ROUTE_PREFIXES: { value: string; label: string }[] = [
  { value: "", label: "All routes" },
  { value: "GET /v1/admin", label: "Admin reads" },
  { value: "POST /v1/admin", label: "Admin writes" },
  { value: "PATCH /v1/admin", label: "Admin patches" },
  { value: "DELETE /v1/admin", label: "Admin deletes" }
];

const LIMIT_OPTIONS = [50, 100, 200, 500];

/**
 * Admin audit page — `/dashboard/admin/audit`.
 *
 * Newest-first global audit feed with module + route-prefix filters.
 * Each row expands inline to show the entitlement snapshot, request
 * summary, and response summary — exactly the breadcrumbs an operator
 * needs to reconstruct what happened during an incident.
 *
 * Per-user / per-session audit lookups are reachable from the user
 * detail panel on `/dashboard/admin/users`; this page is for the
 * "what just happened across the whole system" question.
 */
export function AdminAuditPageClient() {
  const { colors } = useTheme();
  const [module, setModule] = useState<string>("");
  const [routePrefix, setRoutePrefix] = useState<string>("");
  const [limit, setLimit] = useState<number>(100);
  const [state, setState] = useState<{
    loading: boolean;
    data: RecentAuditResponse | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    setState({ loading: true, data: null, error: null });
    const data = await fetchRecentAuditEvents({
      limit,
      module: module || undefined,
      routePrefix: routePrefix || undefined
    });
    setState({
      loading: false,
      data,
      error: data === null ? "Failed to load audit events. Retry or check upstream." : null
    });
  }, [module, routePrefix, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: "grid", gap: spacing[5] }}>
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
          <ScrollText size={22} aria-hidden /> Audit log
        </h1>
        <p
          style={{
            margin: 0,
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            maxWidth: "70ch",
            lineHeight: 1.55
          }}
        >
          Newest-first view of every server-side action that was
          captured. Use the filters to drill into a specific module or
          route family — admin actions live under{" "}
          <code style={{ color: colors.accent }}>/v1/admin</code>.
        </p>
      </header>

      <section
        data-testid="audit-filters"
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[2],
          flexWrap: "wrap"
        }}
      >
        <Filter size={14} aria-hidden style={{ color: colors.textMuted }} />
        <SelectField
          label="Module"
          value={module}
          options={MODULES}
          onChange={setModule}
          testId="audit-filter-module"
        />
        <SelectField
          label="Route family"
          value={routePrefix}
          options={ROUTE_PREFIXES}
          onChange={setRoutePrefix}
          testId="audit-filter-route"
        />
        <SelectField
          label="Limit"
          value={String(limit)}
          options={LIMIT_OPTIONS.map((l) => ({ value: String(l), label: `${l} rows` }))}
          onChange={(v) => setLimit(Number(v) || 100)}
          testId="audit-filter-limit"
        />
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh audit events"
          data-testid="audit-refresh"
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: spacing[2],
            padding: `${spacing[2]} ${spacing[3]}`,
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: "transparent",
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            cursor: "pointer"
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </section>

      <section
        data-testid="audit-feed"
        style={{
          ...cardSurfaceStyle(colors, "neutral"),
          padding: spacing[3],
          borderRadius: borderRadius.lg
        }}
      >
        {state.loading ? (
          <p style={{ margin: 0, padding: spacing[3], color: colors.textMuted }}>
            Loading…
          </p>
        ) : state.error ? (
          <p
            data-testid="audit-error"
            style={{ margin: 0, padding: spacing[3], color: colors.bearish }}
          >
            {state.error}
          </p>
        ) : !state.data || state.data.items.length === 0 ? (
          <p style={{ margin: 0, padding: spacing[3], color: colors.textMuted }}>
            No audit events match the current filters.
          </p>
        ) : (
          <ul
            data-testid="audit-list"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: spacing[2]
            }}
          >
            {state.data.items.map((row) => (
              <AuditRow key={row.event_id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SelectField({
  label,
  value,
  options,
  onChange,
  testId
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  testId: string;
}) {
  const { colors } = useTheme();
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[2],
        fontSize: typography.scale.sm,
        color: colors.textMuted
      }}
    >
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        style={{
          padding: `${spacing[1]} ${spacing[2]}`,
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          background: "transparent",
          color: colors.text,
          fontSize: typography.scale.sm
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function AuditRow({ row }: { row: AuditEventRow }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const tone = statusCodeTone(row.status_code);
  const toneColor = useMemo(() => {
    if (tone === "success") return colors.bullish;
    if (tone === "warning") return colors.caution;
    if (tone === "error") return colors.bearish;
    return colors.textMuted;
  }, [tone, colors]);

  return (
    <li
      data-testid="audit-row"
      data-status={row.status_code}
      data-module={row.module}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        padding: spacing[3],
        display: "grid",
        gap: spacing[2]
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto 1fr auto",
          gap: spacing[3],
          alignItems: "center",
          background: "transparent",
          border: "none",
          padding: 0,
          color: colors.text,
          cursor: "pointer",
          textAlign: "left"
        }}
      >
        <span
          style={{
            color: toneColor,
            fontWeight: 600,
            fontSize: typography.scale.sm,
            minWidth: 36
          }}
        >
          {row.status_code || "—"}
        </span>
        <span
          style={{
            color: colors.textMuted,
            fontSize: typography.scale.xs,
            fontVariantNumeric: "tabular-nums",
            minWidth: 200
          }}
        >
          {row.occurred_at}
        </span>
        <span
          style={{
            color: colors.text,
            fontSize: typography.scale.sm,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
          title={row.route}
        >
          {row.route || row.path || "—"}
        </span>
        <span
          style={{ color: colors.textMuted, fontSize: typography.scale.xs }}
          aria-hidden
        >
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <div
          data-testid="audit-row-detail"
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: `${spacing[2]} ${spacing[3]}`,
            fontSize: typography.scale.sm,
            color: colors.text,
            paddingTop: spacing[2],
            borderTop: `1px dashed ${colors.border}`
          }}
        >
          <DetailRow label="Module" value={row.module || "—"} />
          <DetailRow label="Method" value={row.method || "—"} />
          <DetailRow label="Path" value={row.path || "—"} />
          <DetailRow label="User" value={row.user_id || "anon"} />
          <DetailRow label="Session" value={row.session_id || "—"} />
          <DetailRow label="Outcome" value={row.outcome} />
          <DetailRow
            label="Request"
            value={prettyJson(row.request_summary)}
            multiline
          />
          <DetailRow
            label="Response"
            value={prettyJson(row.response_summary)}
            multiline
          />
          <DetailRow
            label="Entitlement"
            value={prettyJson(row.entitlement_snapshot)}
            multiline
          />
        </div>
      ) : null}
    </li>
  );
}

function DetailRow({
  label,
  value,
  multiline = false
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <>
      <span style={{ color: colors.textMuted }}>{label}</span>
      <span
        style={{
          color: colors.text,
          fontFamily: multiline ? "monospace" : undefined,
          whiteSpace: multiline ? "pre-wrap" : undefined,
          fontSize: typography.scale.xs
        }}
      >
        {value || "—"}
      </span>
    </>
  );
}

function prettyJson(v: Record<string, unknown>): string {
  if (!v || Object.keys(v).length === 0) return "—";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "—";
  }
}
