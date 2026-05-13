"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, RefreshCw, ScrollText } from "lucide-react";

import {
  fetchRecentAuditEventsDiagnostic,
  statusCodeTone,
  type AuditEventRow,
  type RecentAuditResponse
} from "@/lib/api/admin-audit";
import type { AdminApiReadError } from "@/lib/api/admin-users";
import { AdminApiErrorCard } from "@/components/admin/admin-api-error-card";
import { AdminListPager } from "@/components/admin/admin-list-pager";
import { useClientPaginator } from "@/components/admin/use-client-paginator";
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

/**
 * Page size for the client-side pager. Matches the Users page so the
 * admin section feels uniform — "show all by default, paginate at 25"
 * is the same contract everywhere.
 */
const AUDIT_PAGE_SIZE = 25;
/**
 * Upper-bound batch we ask the backend for on every (re)load. The
 * audit endpoint caps server-side; we deliberately fetch enough to
 * cover several days of normal traffic so the client-side pager can
 * provide deep navigation without re-querying. Bumped above the
 * previous 100 default so paging beyond page 4 still works.
 */
const AUDIT_FETCH_LIMIT = 500;

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
  const [state, setState] = useState<{
    loading: boolean;
    data: RecentAuditResponse | null;
    /**
     * Typed diagnostic envelope (see `AdminApiErrorCard`). Renders
     * the actual HTTP status + a hint so a deploy gap doesn't get
     * swallowed by a generic "Failed to load" string.
     */
    error: AdminApiReadError | null;
  }>({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    setState({ loading: true, data: null, error: null });
    const outcome = await fetchRecentAuditEventsDiagnostic({
      limit: AUDIT_FETCH_LIMIT,
      module: module || undefined,
      routePrefix: routePrefix || undefined
    });
    if (outcome.kind === "error") {
      setState({ loading: false, data: null, error: outcome.error });
      return;
    }
    setState({ loading: false, data: outcome.data, error: null });
  }, [module, routePrefix]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Client-side pager — the audit endpoint doesn't expose a cursor,
   * so we slice the fetched batch in groups of 25 client-side. Reset
   * to page 0 whenever filters change so a freshly-filtered list
   * always starts on its most useful page.
   */
  const items = useMemo(() => state.data?.items ?? [], [state.data]);
  const pager = useClientPaginator({
    allItems: items,
    pageSize: AUDIT_PAGE_SIZE
  });
  useEffect(() => {
    pager.goToFirstPage();
  }, [module, routePrefix, pager.goToFirstPage]);

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
        {/*
         * The old "Limit" dropdown (50/100/200/500) was removed in
         * favour of always fetching `AUDIT_FETCH_LIMIT` rows and
         * paginating client-side. Users no longer have to guess how
         * many rows they want up front — the pager handles depth.
         */}
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
          <AdminApiErrorCard
            error={state.error}
            onRetry={() => void load()}
            testId="audit-error"
          />
        ) : items.length === 0 ? (
          <p style={{ margin: 0, padding: spacing[3], color: colors.textMuted }}>
            No audit events match the current filters.
          </p>
        ) : (
          <div style={{ display: "grid", gap: spacing[3] }}>
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
              {pager.pageItems.map((row) => (
                <AuditRow key={row.event_id} row={row} />
              ))}
            </ul>
            {/* Pager is gated on `shouldShowPager`: a list with <=25
                rows renders without a pagination footer, matching the
                Users page contract. */}
            {pager.shouldShowPager ? (
              <AdminListPager
                pageIndex={pager.pageIndex}
                hasPrev={pager.hasPrev}
                hasNext={pager.hasNext}
                loading={state.loading}
                visibleCount={pager.pageItems.length}
                pageSize={pager.pageSize}
                onPrev={pager.goToPrevPage}
                onNext={pager.goToNextPage}
                testId="admin-audit-pager"
              />
            ) : null}
          </div>
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
