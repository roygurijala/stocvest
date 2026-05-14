"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  History,
  RefreshCw,
  ScrollText,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";

import {
  fetchSystemStatus,
  type SystemStatusResponse
} from "@/lib/api/admin-system-status";
import {
  borderRadius,
  cardSurfaceStyle,
  spacing,
  typography
} from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/**
 * Admin hub Overview — `/dashboard/admin`.
 *
 * Three sections:
 *
 *   1. **Operations tile** — at-a-glance status from
 *      `/v1/admin/system-status`: current parameter version, pending
 *      proposals, admin count, founding members, latest history.
 *   2. **Admin tools navigation** — tiles linking to the operational
 *      pages (proposals, parameters, users, audit, error logs).
 *   3. **Recent activity** — the latest five audit events, mirrored
 *      from the system-status payload so the operator sees what
 *      changed without having to navigate to the audit page.
 */
const NAV_TILES: {
  href: string;
  label: string;
  description: string;
  Icon: typeof ShieldCheck;
}[] = [
  {
    href: "/dashboard/admin/proposals",
    label: "Weight proposals",
    description: "Review and promote optimizer-generated weight changes.",
    Icon: ShieldCheck
  },
  {
    href: "/dashboard/admin/parameters",
    label: "Parameters",
    description: "Inspect the live signal weights; roll back to a prior version.",
    Icon: History
  },
  {
    href: "/dashboard/admin/users",
    label: "Users",
    description: "Search users, toggle beta access, manage Cognito groups.",
    Icon: Users
  },
  {
    href: "/dashboard/admin/audit",
    label: "Audit log",
    description: "Newest-first feed of every server-side action.",
    Icon: ScrollText
  },
  {
    href: "/dashboard/admin/error-logs",
    label: "Error logs",
    description: "Last 7 days of Lambda errors from CloudWatch Logs Insights.",
    Icon: AlertTriangle
  }
];

export function AdminHubPageClient() {
  const { colors } = useTheme();
  const [state, setState] = useState<{
    loading: boolean;
    data: SystemStatusResponse | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    setState({ loading: true, data: null, error: null });
    const data = await fetchSystemStatus();
    setState({
      loading: false,
      data,
      error: data === null ? "Failed to load system status. Retry or check upstream." : null
    });
  }, []);

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
          <Activity size={22} aria-hidden /> Admin hub
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
          Operational maintenance surface for STOCVEST. Every action on
          these pages is gated by the backend{" "}
          <code style={{ color: colors.accent }}>analysis_authorized()</code>{" "}
          check; the frontend hides them when your JWT does not carry
          the <code style={{ color: colors.accent }}>signal-analytics-admin</code>{" "}
          group claim.
        </p>
      </header>

      <section data-testid="admin-hub-status-tile" style={{ display: "grid", gap: spacing[3] }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing[3],
            flexWrap: "wrap"
          }}
        >
          <h2
            style={{
              margin: 0,
              color: colors.text,
              fontSize: typography.scale.xl,
              fontWeight: 700
            }}
          >
            Operations overview
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh system status"
            data-testid="hub-refresh"
            style={{
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
        </div>
        {state.loading ? (
          <p
            data-testid="hub-status-loading"
            style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}
          >
            Loading status…
          </p>
        ) : state.error ? (
          <p
            data-testid="hub-status-error"
            style={{ margin: 0, color: colors.bearish, fontSize: typography.scale.sm }}
          >
            {state.error}
          </p>
        ) : state.data ? (
          <StatusGrid data={state.data} />
        ) : null}
      </section>

      <section data-testid="admin-hub-nav-tiles">
        <h2
          style={{
            margin: 0,
            marginBottom: spacing[3],
            color: colors.text,
            fontSize: typography.scale.xl,
            fontWeight: 700
          }}
        >
          Admin tools
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: spacing[3]
          }}
        >
          {NAV_TILES.map(({ href, label, description, Icon }) => (
            <Link
              key={href}
              href={href}
              data-testid={`hub-nav-tile-${href}`}
              style={{
                ...cardSurfaceStyle(colors, "neutral"),
                padding: spacing[4],
                borderRadius: borderRadius.lg,
                display: "grid",
                gap: spacing[2],
                color: colors.text,
                textDecoration: "none"
              }}
            >
              <Icon size={20} aria-hidden style={{ color: colors.accent }} />
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
                {description}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {state.data && state.data.recent_audit_events.length > 0 ? (
        <section data-testid="admin-hub-recent-audit" style={{ display: "grid", gap: spacing[3] }}>
          <h2
            style={{
              margin: 0,
              color: colors.text,
              fontSize: typography.scale.xl,
              fontWeight: 700
            }}
          >
            Recent activity
          </h2>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: spacing[2]
            }}
          >
            {state.data.recent_audit_events.map((evt) => (
              <li
                key={evt.event_id}
                style={{
                  padding: `${spacing[2]} ${spacing[3]}`,
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.md,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: spacing[3],
                  alignItems: "center",
                  color: colors.text,
                  fontSize: typography.scale.sm
                }}
              >
                <span
                  style={{
                    color:
                      evt.status_code >= 500
                        ? colors.bearish
                        : evt.status_code >= 400
                          ? colors.caution
                          : colors.bullish,
                    fontWeight: 600,
                    minWidth: 36
                  }}
                >
                  {evt.status_code || "—"}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {evt.route || evt.path || "—"}
                </span>
                <span
                  style={{
                    color: colors.textMuted,
                    fontSize: typography.scale.xs,
                    fontVariantNumeric: "tabular-nums"
                  }}
                >
                  {evt.occurred_at}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/dashboard/admin/audit"
            style={{
              color: colors.accent,
              fontSize: typography.scale.sm,
              textDecoration: "none",
              alignSelf: "flex-start"
            }}
          >
            View full audit log →
          </Link>
        </section>
      ) : null}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusGrid({ data }: { data: SystemStatusResponse }) {
  const { colors } = useTheme();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: spacing[3]
      }}
    >
      <StatusCard
        label="Current weights"
        value={data.current_parameter.version ? `v${data.current_parameter.version}` : "—"}
        sub={data.current_parameter.created_at || "no rotation on record"}
        icon={<Sparkles size={16} aria-hidden style={{ color: colors.accent }} />}
        testId="status-current-version"
      />
      <StatusCard
        label="Pending proposals"
        value={data.pending_proposal_count.toString()}
        sub={
          data.pending_proposal_count > 0
            ? "Awaiting admin review"
            : "Queue is empty"
        }
        tone={data.pending_proposal_count > 0 ? "warning" : "neutral"}
        icon={
          data.pending_proposal_count > 0 ? (
            <AlertCircle size={16} aria-hidden style={{ color: colors.caution }} />
          ) : (
            <ShieldCheck size={16} aria-hidden style={{ color: colors.bullish }} />
          )
        }
        testId="status-pending-proposals"
      />
      <StatusCard
        label="Admin users"
        value={data.admin_user_count.toString()}
        sub="Members of signal-analytics-admin"
        icon={<Users size={16} aria-hidden style={{ color: colors.accent }} />}
        testId="status-admin-users"
      />
      <StatusCard
        label="Founding members"
        value={data.founding_member_count.toString()}
        sub="Paid swing / day-pro plans"
        icon={<Sparkles size={16} aria-hidden style={{ color: colors.accent }} />}
        testId="status-founding-members"
      />
    </div>
  );
}

function StatusCard({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
  testId
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "warning";
  icon?: React.ReactNode;
  testId?: string;
}) {
  const { colors } = useTheme();
  const surface = cardSurfaceStyle(colors, tone === "warning" ? "caution" : "neutral");
  return (
    <div
      data-testid={testId}
      style={{
        ...surface,
        padding: spacing[4],
        borderRadius: borderRadius.lg,
        display: "grid",
        gap: spacing[1]
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[2],
          color: colors.textMuted,
          fontSize: typography.scale.xs,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          color: colors.text,
          fontSize: typography.scale["2xl"],
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {value}
      </div>
      <div style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{sub}</div>
    </div>
  );
}
