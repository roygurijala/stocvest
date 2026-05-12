"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";

import { ParameterRollbackSection } from "@/components/parameter-rollback-section";
import {
  fetchCurrentParameters,
  type CurrentParametersResponse
} from "@/lib/api/admin-parameters-current";
import {
  borderRadius,
  cardSurfaceStyle,
  spacing,
  typography
} from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/**
 * Admin parameters page — `/dashboard/admin/parameters`.
 *
 * Two sections:
 *
 *   1. **Current parameters** — readable snapshot of the live
 *      `SignalParameters` payload. Same view every signal engine sees;
 *      surfaced here so the admin doesn't need to dig through Secrets
 *      Manager to know what weights are live.
 *   2. **Rollback** — the relocated `ParameterRollbackSection` (was on
 *      the proposals page in D10 Phase 4). Same component, just
 *      hosted by a dedicated page now that the admin hub has its own
 *      navigation.
 */
export function AdminParametersPageClient() {
  const { colors } = useTheme();
  const [state, setState] = useState<{
    loading: boolean;
    data: CurrentParametersResponse | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  const load = useCallback(async () => {
    setState({ loading: true, data: null, error: null });
    const data = await fetchCurrentParameters();
    setState({
      loading: false,
      data,
      error: data === null ? "Failed to load current parameters. Retry or check upstream." : null
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: "grid", gap: spacing[6] }}>
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
          <Settings2 size={22} aria-hidden /> Parameters
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
          Read-only view of the live composite weights and per-signal
          thresholds. Rotation history and one-click rollback live in the
          section below — use it whenever the post-rotation accuracy
          CloudWatch alarm fires.
        </p>
      </header>

      <section
        data-testid="admin-current-parameters-section"
        style={{
          ...cardSurfaceStyle(colors, "neutral"),
          padding: spacing[5],
          borderRadius: borderRadius.lg,
          display: "grid",
          gap: spacing[3]
        }}
      >
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
            Current SignalParameters
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh current parameters"
            data-testid="admin-current-parameters-refresh"
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
          <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>
            Loading current parameters…
          </p>
        ) : state.error ? (
          <p
            data-testid="admin-current-parameters-error"
            style={{ margin: 0, color: colors.bearish, fontSize: typography.scale.sm }}
          >
            {state.error}
          </p>
        ) : state.data ? (
          <ParametersDetail data={state.data} />
        ) : null}
      </section>

      <ParameterRollbackSection />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ParametersDetail({ data }: { data: CurrentParametersResponse }) {
  const { colors } = useTheme();
  const composite = isRecord(data.parameters.composite) ? data.parameters.composite : null;
  const swingComposite = isRecord(data.parameters.swing_composite)
    ? data.parameters.swing_composite
    : null;
  const dayComposite = isRecord(data.parameters.day_composite)
    ? data.parameters.day_composite
    : null;

  return (
    <div style={{ display: "grid", gap: spacing[4] }}>
      <dl
        data-testid="parameters-meta"
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: `${spacing[2]} ${spacing[4]}`,
          margin: 0
        }}
      >
        <dt style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>Version</dt>
        <dd
          data-testid="parameters-version"
          style={{ margin: 0, color: colors.text, fontWeight: 600 }}
        >
          v{data.version || "?"}
        </dd>
        <dt style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>Rotated at</dt>
        <dd style={{ margin: 0, color: colors.text }}>{data.created_at || "—"}</dd>
        <dt style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>Notes</dt>
        <dd style={{ margin: 0, color: colors.text }}>{data.notes || "—"}</dd>
      </dl>

      <CompositeBlock label="Shared composite" block={composite} />
      <CompositeBlock label="Swing composite override" block={swingComposite} />
      <CompositeBlock label="Day composite override" block={dayComposite} />
    </div>
  );
}

function CompositeBlock({
  label,
  block
}: {
  label: string;
  block: Record<string, unknown> | null;
}) {
  const { colors } = useTheme();
  if (!block) {
    return (
      <div
        style={{
          padding: spacing[3],
          borderRadius: borderRadius.md,
          border: `1px dashed ${colors.border}`
        }}
      >
        <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
          {label}: <em>not configured (uses shared defaults)</em>
        </span>
      </div>
    );
  }
  const entries = Object.entries(block).filter(([, v]) => typeof v === "number");
  return (
    <div
      data-testid={`composite-block-${label.toLowerCase().replace(/\s+/g, "-")}`}
      style={{
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        display: "grid",
        gap: spacing[2]
      }}
    >
      <span style={{ color: colors.text, fontWeight: 600, fontSize: typography.scale.sm }}>
        {label}
      </span>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td style={{ padding: `${spacing[1]} 0`, color: colors.textMuted, width: "60%" }}>
                {key}
              </td>
              <td
                style={{
                  padding: `${spacing[1]} 0`,
                  color: colors.text,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums"
                }}
              >
                {Number(value).toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
