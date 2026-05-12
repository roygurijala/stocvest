"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, History, RotateCcw, ShieldAlert } from "lucide-react";

import {
  fetchParameterHistory,
  formatAccuracyBeforeChange,
  rollbackErrorLabel,
  rollbackToVersion,
  type ParameterHistorySummaryRow,
  type RollbackOutcome
} from "@/lib/api/admin-parameters";
import {
  borderRadius,
  cardSurfaceStyle,
  spacing,
  typography
} from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/**
 * D10 Phase 4 — admin parameter-rollback panel.
 *
 * Self-contained section rendered under the proposal-review surface on
 * `/dashboard/admin/proposals`. The admin reads the CloudWatch
 * degradation alarm, opens this page, picks a known-good prior version
 * from the history list, and clicks "Roll back to this version". The
 * confirmation dialog enumerates the four production side-effects so
 * the click is never accidental.
 *
 * The component is deliberately stateless about *which* row to roll back
 * to — the picker UI surfaces every prior version in `ParameterHistory`
 * (newest first) with the currently-live row disabled. There is no
 * "auto-roll-back-to-prior" button; the admin always picks the target
 * explicitly to keep the audit story honest.
 */
export function ParameterRollbackSection() {
  const { colors } = useTheme();

  const [historyState, setHistoryState] = useState<{
    loading: boolean;
    items: ParameterHistorySummaryRow[];
    error: string | null;
  }>({ loading: true, items: [], error: null });

  const [pendingTarget, setPendingTarget] = useState<ParameterHistorySummaryRow | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<{
    kind: "success" | "error";
    title: string;
    body: string;
  } | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryState({ loading: true, items: [], error: null });
    const response = await fetchParameterHistory({ limit: 50 });
    if (response === null) {
      setHistoryState({
        loading: false,
        items: [],
        error:
          "Failed to load parameter history. Check admin permissions and retry."
      });
      return;
    }
    setHistoryState({ loading: false, items: response.items, error: null });
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleConfirmRollback = useCallback(async () => {
    if (pendingTarget === null) return;
    setSubmitting(true);
    const outcome: RollbackOutcome = await rollbackToVersion(pendingTarget.version);
    setSubmitting(false);
    setPendingTarget(null);
    if (outcome.kind === "ok") {
      setFlash({
        kind: "success",
        title: "Rollback complete",
        body: `Rolled back from v${outcome.data.rolled_back_from ?? "?"} → v${pendingTarget.version}. New live version: v${outcome.data.new_parameter_version ?? "?"}.`
      });
      void loadHistory();
      return;
    }
    setFlash({
      kind: "error",
      title: "Rollback failed",
      body: `${rollbackErrorLabel(outcome.code)} (status ${outcome.status})`
    });
  }, [pendingTarget, loadHistory]);

  return (
    <section
      data-testid="parameter-rollback-section"
      style={{ display: "grid", gap: spacing[4] }}
    >
      <header style={{ display: "grid", gap: spacing[2] }}>
        <h2
          style={{
            margin: 0,
            color: colors.text,
            fontSize: typography.scale.xl,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            display: "flex",
            alignItems: "center",
            gap: spacing[2]
          }}
        >
          <History size={20} aria-hidden="true" />
          Parameter rollback
        </h2>
        <p
          style={{
            margin: 0,
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            maxWidth: "70ch",
            lineHeight: 1.55
          }}
        >
          One-click rotation back to a prior parameter version. Use this when
          the post-rotation accuracy CloudWatch alarm has fired and the
          current weights are demonstrably worse than a known-good prior
          version. A rollback creates a fresh <code>ParameterHistory</code>{" "}
          audit row — it never deletes or rewrites the original.
        </p>
      </header>

      {flash ? (
        <div
          data-testid="rollback-flash"
          data-flash-kind={flash.kind}
          style={{
            ...cardSurfaceStyle(
              colors,
              flash.kind === "success" ? "bullish" : "bearish"
            ),
            padding: `${spacing[3]} ${spacing[4]}`,
            borderRadius: borderRadius.lg,
            display: "flex",
            alignItems: "flex-start",
            gap: spacing[3]
          }}
        >
          <div style={{ marginTop: 2 }}>
            {flash.kind === "success" ? (
              <CheckCircle2 size={18} />
            ) : (
              <ShieldAlert size={18} />
            )}
          </div>
          <div style={{ display: "grid", gap: spacing[1], flex: 1 }}>
            <span
              style={{
                color: colors.text,
                fontWeight: 600,
                fontSize: typography.scale.sm
              }}
            >
              {flash.title}
            </span>
            <span
              style={{
                color: colors.textMuted,
                fontSize: typography.scale.sm
              }}
            >
              {flash.body}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFlash(null)}
            style={{
              background: "transparent",
              border: "none",
              color: colors.textMuted,
              cursor: "pointer",
              fontSize: typography.scale.xs
            }}
            aria-label="Dismiss rollback notification"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div
        style={{
          ...cardSurfaceStyle(colors, "neutral"),
          padding: spacing[4],
          borderRadius: borderRadius.lg,
          display: "grid",
          gap: spacing[3]
        }}
      >
        {historyState.loading ? (
          <p
            style={{
              margin: 0,
              color: colors.textMuted,
              fontSize: typography.scale.sm
            }}
          >
            Loading parameter history…
          </p>
        ) : historyState.error ? (
          <p
            data-testid="rollback-history-error"
            style={{
              margin: 0,
              color: colors.bearish,
              fontSize: typography.scale.sm
            }}
          >
            {historyState.error}
          </p>
        ) : historyState.items.length === 0 ? (
          <p
            style={{
              margin: 0,
              color: colors.textMuted,
              fontSize: typography.scale.sm
            }}
          >
            No prior parameter rotations on record. Rollback becomes available
            after the first promotion.
          </p>
        ) : (
          <ul
            data-testid="rollback-history-list"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: spacing[2]
            }}
          >
            {historyState.items.map((row) => (
              <HistoryRow
                key={row.version}
                row={row}
                onPick={() => setPendingTarget(row)}
              />
            ))}
          </ul>
        )}
      </div>

      {pendingTarget !== null ? (
        <RollbackConfirmDialog
          target={pendingTarget}
          submitting={submitting}
          onCancel={() => setPendingTarget(null)}
          onConfirm={() => void handleConfirmRollback()}
        />
      ) : null}
    </section>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function HistoryRow({
  row,
  onPick
}: {
  row: ParameterHistorySummaryRow;
  onPick: () => void;
}) {
  const { colors } = useTheme();
  const disabled = row.is_current_live_version;
  return (
    <li
      data-testid="rollback-history-row"
      data-version={row.version}
      data-live={row.is_current_live_version}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: spacing[3],
        alignItems: "center",
        padding: `${spacing[3]} ${spacing[4]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: disabled ? colors.surfaceMuted : "transparent"
      }}
    >
      <div style={{ display: "grid", gap: spacing[1], minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing[2],
            flexWrap: "wrap"
          }}
        >
          <span
            style={{
              color: colors.text,
              fontWeight: 600,
              fontSize: typography.scale.sm
            }}
          >
            v{row.version}
          </span>
          {disabled ? (
            <span
              style={{
                color: colors.accent,
                fontSize: typography.scale.xs,
                background: "rgba(59,130,246,0.12)",
                padding: `${spacing[1]} ${spacing[2]}`,
                borderRadius: borderRadius.sm,
                fontWeight: 600
              }}
            >
              LIVE
            </span>
          ) : null}
          <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
            {row.created_at || "—"}
          </span>
        </div>
        <span
          style={{
            color: colors.textMuted,
            fontSize: typography.scale.xs,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}
          title={row.reason}
        >
          {row.reason || "(no reason recorded)"} ·{" "}
          {row.changed_by || "unknown"} · accuracy at change:{" "}
          {formatAccuracyBeforeChange(row.accuracy_before_change)}
        </span>
      </div>
      <button
        type="button"
        data-testid="rollback-pick-button"
        data-version={row.version}
        onClick={onPick}
        disabled={disabled}
        style={{
          padding: `${spacing[2]} ${spacing[3]}`,
          borderRadius: borderRadius.md,
          border: `1px solid ${disabled ? colors.border : colors.accent}`,
          background: disabled ? "transparent" : "rgba(59,130,246,0.12)",
          color: disabled ? colors.textMuted : colors.accent,
          fontSize: typography.scale.sm,
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: spacing[2]
        }}
      >
        <RotateCcw size={14} aria-hidden="true" />
        {disabled ? "Currently live" : "Roll back to this"}
      </button>
    </li>
  );
}

function RollbackConfirmDialog({
  target,
  submitting,
  onCancel,
  onConfirm
}: {
  target: ParameterHistorySummaryRow;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  return (
    <div
      data-testid="rollback-confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="rollback-confirm-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: spacing[4],
        zIndex: 50
      }}
    >
      <div
        style={{
          background: colors.surface,
          color: colors.text,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.lg,
          padding: spacing[5],
          maxWidth: 560,
          width: "100%",
          display: "grid",
          gap: spacing[4]
        }}
      >
        <h3
          id="rollback-confirm-title"
          style={{
            margin: 0,
            fontSize: typography.scale.lg,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: spacing[2]
          }}
        >
          <ShieldAlert size={18} aria-hidden="true" />
          Confirm rollback to v{target.version}
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: typography.scale.sm,
            color: colors.textMuted,
            lineHeight: 1.55
          }}
        >
          This will rotate the live signal parameters backward to the payload
          recorded in v{target.version}. The action takes effect immediately
          across every active signal engine.
        </p>
        <ul
          style={{
            margin: 0,
            paddingLeft: spacing[5],
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            display: "grid",
            gap: spacing[2],
            lineHeight: 1.55
          }}
        >
          <li>
            A new <code>ParameterHistory</code> row is created with a
            fresh, monotonically-incremented version string (the prior row
            for v{target.version} is preserved untouched).
          </li>
          <li>
            All running signal engines pick up the new weights within their
            cache TTL (≤5 minutes).
          </li>
          <li>
            The audit row's <code>changed_by</code> column is stamped with
            <code> d10-rollback:&lt;your sub&gt;</code> so the rollback intent
            is explicit in the audit trail.
          </li>
          <li>
            The action is reversible — you can roll forward again by
            promoting a new proposal or rolling back to a different
            version.
          </li>
        </ul>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: spacing[3]
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: `${spacing[2]} ${spacing[4]}`,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              background: "transparent",
              color: colors.text,
              fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer"
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="rollback-confirm-button"
            onClick={onConfirm}
            disabled={submitting}
            style={{
              padding: `${spacing[2]} ${spacing[4]}`,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.bearish}`,
              background: colors.bearish,
              color: "#fff",
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: spacing[2]
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {submitting ? "Rolling back…" : `Roll back to v${target.version}`}
          </button>
        </div>
      </div>
    </div>
  );
}
