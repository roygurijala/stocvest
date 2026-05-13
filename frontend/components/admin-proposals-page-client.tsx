"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  XCircle
} from "lucide-react";
import {
  compositeWeightLabel,
  fetchProposalDetail,
  fetchProposals,
  formatAccuracyLift,
  promoteProposal,
  rejectProposal,
  type CompositeOverrideBlock,
  type ProposalActionOutcome,
  type ProposalDetail,
  type ProposalListResponse,
  type ProposalStatus,
  type ProposalSummaryRow,
  type PromotionResult
} from "@/lib/api/admin-proposals";
import { AdminListPager } from "@/components/admin/admin-list-pager";
import { useClientPaginator } from "@/components/admin/use-client-paginator";
import {
  borderRadius,
  cardSurfaceStyle,
  spacing,
  typography
} from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const STATUS_OPTIONS: { value: ProposalStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "promoted", label: "Promoted" },
  { value: "rejected", label: "Rejected" },
  { value: "superseded", label: "Superseded" }
];

/**
 * Page size + fetch ceiling for the proposals list. Mirrors the Users
 * page (25/page) and the Audit page (500-row batch) to keep the admin
 * section UX uniform — see `useClientPaginator` docstring.
 */
const PROPOSALS_PAGE_SIZE = 25;
const PROPOSALS_FETCH_LIMIT = 200;

const WEIGHT_KEYS: (keyof CompositeOverrideBlock)[] = [
  "technical_weight",
  "news_weight",
  "macro_weight",
  "sector_weight",
  "geopolitical_weight",
  "internals_weight"
];

type FlashKind = "success" | "error" | "info";
interface FlashMessage {
  kind: FlashKind;
  title: string;
  body: string;
}

export function AdminProposalsPageClient() {
  const { colors } = useTheme();
  const [statusFilter, setStatusFilter] = useState<ProposalStatus>("pending");
  const [listState, setListState] = useState<{
    loading: boolean;
    response: ProposalListResponse | null;
    error: string | null;
  }>({ loading: true, response: null, error: null });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<{
    loading: boolean;
    detail: ProposalDetail | null;
    error: string | null;
  }>({ loading: false, detail: null, error: null });

  const [actionPending, setActionPending] = useState<"promote" | "reject" | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [flash, setFlash] = useState<FlashMessage | null>(null);

  const loadList = useCallback(async (status: ProposalStatus) => {
    setListState({ loading: true, response: null, error: null });
    const response = await fetchProposals({ status, limit: PROPOSALS_FETCH_LIMIT });
    setListState({
      loading: false,
      response,
      error: response === null ? "Failed to load proposals. Check admin permissions and retry." : null
    });
  }, []);

  useEffect(() => {
    void loadList(statusFilter);
  }, [statusFilter, loadList]);

  /**
   * Client-side paginator — keeps the admin section's "show all by
   * default, paginate at 25" rule uniform with the Users and Audit
   * pages. Switching the status filter snaps the view back to page 0
   * so the most useful slice of a freshly filtered list is what the
   * admin sees first.
   */
  const allProposals = useMemo(() => listState.response?.items ?? [], [listState.response]);
  const pager = useClientPaginator({
    allItems: allProposals,
    pageSize: PROPOSALS_PAGE_SIZE
  });
  useEffect(() => {
    pager.goToFirstPage();
  }, [statusFilter, pager.goToFirstPage]);

  const loadDetail = useCallback(async (proposalId: string) => {
    setDetailState({ loading: true, detail: null, error: null });
    const detail = await fetchProposalDetail(proposalId);
    setDetailState({
      loading: false,
      detail,
      error: detail === null ? "Proposal not found or you lack permission." : null
    });
  }, []);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
      setRejectNote("");
      setConfirmPromote(false);
    } else {
      setDetailState({ loading: false, detail: null, error: null });
    }
  }, [selectedId, loadDetail]);

  // ⚠ `items` historically meant "everything the API returned" and is
  // still used by the empty-state copy below ("No pending proposals.").
  // For row rendering we now go through the pager.
  const items = allProposals;

  const onPromote = useCallback(async () => {
    if (!selectedId) return;
    setActionPending("promote");
    const outcome: ProposalActionOutcome<PromotionResult> = await promoteProposal(selectedId);
    setActionPending(null);
    setConfirmPromote(false);
    if (outcome.kind === "ok") {
      const supersedeText =
        outcome.data.superseded_pending_ids.length > 0
          ? ` ${outcome.data.superseded_pending_ids.length} other pending proposal(s) auto-superseded.`
          : "";
      setFlash({
        kind: "success",
        title: "Weights rotated",
        body: `Live signal parameters now at v${outcome.data.new_parameter_version ?? "?"}.${supersedeText}`
      });
      await loadList(statusFilter);
      await loadDetail(selectedId);
    } else {
      setFlash({
        kind: "error",
        title: "Promotion failed",
        body: `${outcome.message} (status ${outcome.status})`
      });
    }
  }, [selectedId, loadList, loadDetail, statusFilter]);

  const onReject = useCallback(async () => {
    if (!selectedId) return;
    setActionPending("reject");
    const outcome = await rejectProposal(selectedId, { reviewNote: rejectNote });
    setActionPending(null);
    if (outcome.kind === "ok") {
      setFlash({
        kind: "info",
        title: "Proposal rejected",
        body: rejectNote.trim()
          ? "Rejection recorded with note."
          : "Rejection recorded without a note."
      });
      setRejectNote("");
      await loadList(statusFilter);
      await loadDetail(selectedId);
    } else {
      setFlash({
        kind: "error",
        title: "Rejection failed",
        body: `${outcome.message} (status ${outcome.status})`
      });
    }
  }, [selectedId, rejectNote, loadList, loadDetail, statusFilter]);

  const flashStyle = useMemo(() => {
    if (!flash) return null;
    const tone =
      flash.kind === "success" ? "bullish" : flash.kind === "error" ? "bearish" : "caution";
    return cardSurfaceStyle(colors, tone);
  }, [flash, colors]);

  return (
    <div style={{ display: "grid", gap: spacing[5] }}>
      <header style={{ display: "grid", gap: spacing[2] }}>
        <h1
          style={{
            margin: 0,
            color: colors.text,
            fontSize: typography.scale["2xl"],
            fontWeight: 700,
            letterSpacing: "-0.01em"
          }}
        >
          Weight proposal review
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
          Each proposal comes from the weekly automated optimizer. Promotion is the only
          production path that rotates the live composite weights in Secrets Manager.
          Review the evidence carefully — there is no undo, only a counter-promotion.
        </p>
      </header>

      {flash && flashStyle ? (
        <div
          data-testid="admin-proposals-flash"
          data-flash-kind={flash.kind}
          style={{
            ...flashStyle,
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
            ) : flash.kind === "error" ? (
              <ShieldAlert size={18} />
            ) : (
              <Sparkles size={18} />
            )}
          </div>
          <div style={{ display: "grid", gap: spacing[1], flex: 1 }}>
            <span style={{ color: colors.text, fontWeight: 600, fontSize: typography.scale.sm }}>
              {flash.title}
            </span>
            <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
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
            aria-label="Dismiss notification"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <section
        style={{ display: "flex", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}
      >
        {STATUS_OPTIONS.map((opt) => {
          const active = opt.value === statusFilter;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setStatusFilter(opt.value);
                setSelectedId(null);
              }}
              data-testid={`status-filter-${opt.value}`}
              data-active={active}
              style={{
                padding: `${spacing[2]} ${spacing[3]}`,
                borderRadius: borderRadius.md,
                border: `1px solid ${active ? colors.accent : colors.border}`,
                background: active ? "rgba(59,130,246,0.12)" : "transparent",
                color: active ? colors.accent : colors.text,
                fontSize: typography.scale.sm,
                fontWeight: active ? 600 : 500,
                cursor: "pointer"
              }}
            >
              {opt.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => void loadList(statusFilter)}
          aria-label="Refresh proposals"
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: spacing[5],
          alignItems: "start"
        }}
        className="admin-proposals-layout"
      >
        <section data-testid="proposals-list" style={{ display: "grid", gap: spacing[3] }}>
          {listState.loading ? (
            <EmptyCard colors={colors} message="Loading proposals…" />
          ) : listState.error ? (
            <EmptyCard colors={colors} tone="bearish" message={listState.error} />
          ) : items.length === 0 ? (
            <EmptyCard
              colors={colors}
              message={`No ${statusFilter} proposals.`}
            />
          ) : (
            <>
              {pager.pageItems.map((item) => (
                <ProposalSummaryCard
                  key={item.proposal_id}
                  row={item}
                  selected={item.proposal_id === selectedId}
                  onSelect={() => setSelectedId(item.proposal_id)}
                />
              ))}
              {/* Pager footer — only when the unfiltered batch has
                  more rows than fit on a single page. Mirrors the
                  Users and Audit pages exactly. */}
              {pager.shouldShowPager ? (
                <AdminListPager
                  pageIndex={pager.pageIndex}
                  hasPrev={pager.hasPrev}
                  hasNext={pager.hasNext}
                  loading={listState.loading}
                  visibleCount={pager.pageItems.length}
                  pageSize={pager.pageSize}
                  onPrev={pager.goToPrevPage}
                  onNext={pager.goToNextPage}
                  testId="admin-proposals-pager"
                />
              ) : null}
            </>
          )}
        </section>

        {selectedId ? (
          <section data-testid="proposal-detail" style={{ display: "grid", gap: spacing[3] }}>
            <DetailPanel
              loading={detailState.loading}
              error={detailState.error}
              detail={detailState.detail}
              actionPending={actionPending}
              rejectNote={rejectNote}
              setRejectNote={setRejectNote}
              onPromote={() => setConfirmPromote(true)}
              onReject={onReject}
              onClose={() => setSelectedId(null)}
              confirmPromote={confirmPromote}
              onConfirmPromote={onPromote}
              onCancelConfirmPromote={() => setConfirmPromote(false)}
            />
          </section>
        ) : null}
      </div>

      {/* D10 Phase 5 — the parameter rollback panel that used to live
          here was relocated to `/dashboard/admin/parameters` so every
          parameter-related tool sits in one place. Proposals stay
          focused on review-and-promote only. */}

      <style jsx>{`
        @media (min-width: 1100px) {
          :global(.admin-proposals-layout) {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function EmptyCard({
  colors,
  message,
  tone
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  message: string;
  tone?: "bearish";
}) {
  const surface = cardSurfaceStyle(colors, tone === "bearish" ? "bearish" : "neutral");
  return (
    <div
      style={{
        ...surface,
        padding: spacing[4],
        borderRadius: borderRadius.lg,
        color: colors.textMuted,
        fontSize: typography.scale.sm
      }}
    >
      {message}
    </div>
  );
}

function ProposalSummaryCard({
  row,
  selected,
  onSelect
}: {
  row: ProposalSummaryRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  const surface = cardSurfaceStyle(colors, "neutral");
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`proposal-row-${row.proposal_id}`}
      data-selected={selected}
      style={{
        ...surface,
        textAlign: "left",
        cursor: "pointer",
        padding: spacing[4],
        borderRadius: borderRadius.lg,
        display: "grid",
        gap: spacing[3],
        borderLeft: selected
          ? `3px solid ${colors.accent}`
          : surface.border.replace("1px solid ", "3px solid "),
        boxShadow: selected
          ? `${surface.boxShadow}, 0 0 0 1px ${colors.accent}`
          : surface.boxShadow,
        color: "inherit"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            color: colors.text,
            fontSize: typography.scale.sm,
            fontWeight: 600
          }}
        >
          {row.proposal_id}
        </span>
        <StatusPill status={row.status} />
        <span style={{ marginLeft: "auto", color: colors.textMuted, fontSize: typography.scale.xs }}>
          baseline v{row.baseline_parameter_version}
        </span>
      </div>

      <div style={{ display: "grid", gap: spacing[2] }}>
        {row.has_swing_proposal ? (
          <ModeLiftRow
            label="Swing"
            lift={row.swing_val_accuracy_lift}
            n={row.swing_val_signal_count}
          />
        ) : null}
        {row.has_day_proposal ? (
          <ModeLiftRow
            label="Day"
            lift={row.day_val_accuracy_lift}
            n={row.day_val_signal_count}
          />
        ) : null}
        {!row.has_swing_proposal && !row.has_day_proposal ? (
          <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
            (no per-mode overrides on this proposal — should not occur in production)
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: colors.textMuted,
          fontSize: typography.scale.xs
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: spacing[1] }}>
          <Clock size={12} /> {formatTimestamp(row.created_at)}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: spacing[1] }}>
          Review <ChevronRight size={14} />
        </span>
      </div>
    </button>
  );
}

function StatusPill({ status }: { status: ProposalStatus }) {
  const { colors } = useTheme();
  const palette: Record<
    ProposalStatus,
    { bg: string; border: string; fg: string; label: string }
  > = {
    pending: {
      bg: "rgba(245,158,11,0.14)",
      border: "rgba(245,158,11,0.4)",
      fg: "rgb(245,158,11)",
      label: "Pending"
    },
    promoted: {
      bg: "rgba(34,197,94,0.14)",
      border: "rgba(34,197,94,0.4)",
      fg: "rgb(34,197,94)",
      label: "Promoted"
    },
    rejected: {
      bg: "rgba(239,68,68,0.14)",
      border: "rgba(239,68,68,0.4)",
      fg: "rgb(239,68,68)",
      label: "Rejected"
    },
    superseded: {
      bg: "rgba(148,163,184,0.14)",
      border: "rgba(148,163,184,0.4)",
      fg: colors.textMuted,
      label: "Superseded"
    }
  };
  const p = palette[status];
  return (
    <span
      data-testid={`status-pill-${status}`}
      style={{
        padding: `2px ${spacing[2]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${p.border}`,
        background: p.bg,
        color: p.fg,
        fontSize: typography.scale.xs,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase"
      }}
    >
      {p.label}
    </span>
  );
}

function ModeLiftRow({
  label,
  lift,
  n
}: {
  label: string;
  lift: number | null;
  n: number | null;
}) {
  const { colors } = useTheme();
  const formatted = formatAccuracyLift(lift);
  const tone =
    lift !== null && Number.isFinite(lift) && lift > 0
      ? "rgb(34,197,94)"
      : lift !== null && Number.isFinite(lift) && lift < 0
      ? "rgb(239,68,68)"
      : colors.textMuted;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing[2],
        fontSize: typography.scale.sm
      }}
    >
      <span style={{ color: colors.textMuted, minWidth: 60 }}>{label}</span>
      <span style={{ color: tone, fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
        {formatted}
      </span>
      <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
        n={n ?? "—"}
      </span>
    </div>
  );
}

function DetailPanel({
  loading,
  error,
  detail,
  actionPending,
  rejectNote,
  setRejectNote,
  onPromote,
  onReject,
  onClose,
  confirmPromote,
  onConfirmPromote,
  onCancelConfirmPromote
}: {
  loading: boolean;
  error: string | null;
  detail: ProposalDetail | null;
  actionPending: "promote" | "reject" | null;
  rejectNote: string;
  setRejectNote: (s: string) => void;
  onPromote: () => void;
  onReject: () => void;
  onClose: () => void;
  confirmPromote: boolean;
  onConfirmPromote: () => void;
  onCancelConfirmPromote: () => void;
}) {
  const { colors } = useTheme();
  const surface = cardSurfaceStyle(colors, "neutral");

  if (loading) return <EmptyCard colors={colors} message="Loading detail…" />;
  if (error) return <EmptyCard colors={colors} tone="bearish" message={error} />;
  if (!detail) return null;

  const canAct = detail.status === "pending";

  return (
    <div style={{ display: "grid", gap: spacing[3] }}>
      <div
        style={{
          ...surface,
          padding: spacing[4],
          borderRadius: borderRadius.lg,
          display: "grid",
          gap: spacing[3]
        }}
      >
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
              fontFamily: "var(--font-mono, monospace)",
              color: colors.text,
              fontSize: typography.scale.base,
              fontWeight: 700
            }}
          >
            {detail.proposal_id}
          </span>
          <StatusPill status={detail.status} />
          <span style={{ marginLeft: "auto", color: colors.textMuted, fontSize: typography.scale.xs }}>
            baseline v{detail.baseline_parameter_version}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            style={{
              border: `1px solid ${colors.border}`,
              background: "transparent",
              color: colors.textMuted,
              fontSize: typography.scale.xs,
              padding: `${spacing[1]} ${spacing[2]}`,
              borderRadius: borderRadius.md,
              cursor: "pointer"
            }}
          >
            Close
          </button>
        </div>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: `${spacing[1]} ${spacing[3]}`,
            margin: 0,
            color: colors.textMuted,
            fontSize: typography.scale.xs
          }}
        >
          <dt>Created</dt>
          <dd style={{ margin: 0, color: colors.text }}>{formatTimestamp(detail.created_at)}</dd>
          <dt>By job</dt>
          <dd style={{ margin: 0, color: colors.text }}>{detail.created_by_job}</dd>
          <dt>Train window</dt>
          <dd style={{ margin: 0, color: colors.text }}>
            {formatTimestamp(detail.train_window_start)} → {formatTimestamp(detail.train_window_end)}
          </dd>
          <dt>Val window</dt>
          <dd style={{ margin: 0, color: colors.text }}>
            {formatTimestamp(detail.val_window_start)} → {formatTimestamp(detail.val_window_end)}
          </dd>
          {detail.reviewed_at ? (
            <>
              <dt>Reviewed</dt>
              <dd style={{ margin: 0, color: colors.text }}>
                {formatTimestamp(detail.reviewed_at)} by{" "}
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  {detail.reviewed_by || "?"}
                </span>
              </dd>
            </>
          ) : null}
          {detail.promoted_to_version ? (
            <>
              <dt>Promoted to</dt>
              <dd style={{ margin: 0, color: colors.text }}>v{detail.promoted_to_version}</dd>
            </>
          ) : null}
          {detail.review_note ? (
            <>
              <dt>Note</dt>
              <dd style={{ margin: 0, color: colors.text }}>{detail.review_note}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {detail.proposed_swing_composite ? (
        <WeightTable mode="swing" block={detail.proposed_swing_composite} />
      ) : null}
      {detail.proposed_day_composite ? (
        <WeightTable mode="day" block={detail.proposed_day_composite} />
      ) : null}

      {detail.evidence ? (
        <EvidenceBlock evidence={detail.evidence} />
      ) : null}

      {canAct ? (
        <div
          style={{
            ...surface,
            padding: spacing[4],
            borderRadius: borderRadius.lg,
            display: "grid",
            gap: spacing[3]
          }}
        >
          <label
            htmlFor="admin-reject-note"
            style={{ color: colors.textMuted, fontSize: typography.scale.xs }}
          >
            Optional rejection note
          </label>
          <textarea
            id="admin-reject-note"
            data-testid="admin-reject-note-input"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Why is this proposal not safe to promote? (Optional — leave blank to reject without a note.)"
            rows={2}
            style={{
              width: "100%",
              padding: spacing[2],
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.text,
              fontSize: typography.scale.sm,
              fontFamily: "inherit",
              resize: "vertical"
            }}
          />
          <div style={{ display: "flex", gap: spacing[2], flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onReject}
              disabled={actionPending !== null}
              data-testid="admin-reject-button"
              style={{
                padding: `${spacing[2]} ${spacing[3]}`,
                borderRadius: borderRadius.md,
                border: `1px solid rgba(239,68,68,0.4)`,
                background: "rgba(239,68,68,0.08)",
                color: "rgb(239,68,68)",
                fontSize: typography.scale.sm,
                fontWeight: 600,
                cursor: actionPending !== null ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: spacing[2],
                opacity: actionPending !== null ? 0.6 : 1
              }}
            >
              <XCircle size={16} />
              {actionPending === "reject" ? "Rejecting…" : "Reject proposal"}
            </button>
            <button
              type="button"
              onClick={onPromote}
              disabled={actionPending !== null}
              data-testid="admin-promote-button"
              style={{
                padding: `${spacing[2]} ${spacing[3]}`,
                borderRadius: borderRadius.md,
                border: `1px solid rgba(34,197,94,0.45)`,
                background: "rgba(34,197,94,0.1)",
                color: "rgb(34,197,94)",
                fontSize: typography.scale.sm,
                fontWeight: 700,
                cursor: actionPending !== null ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: spacing[2],
                opacity: actionPending !== null ? 0.6 : 1,
                marginLeft: "auto"
              }}
            >
              <CheckCircle2 size={16} />
              {actionPending === "promote" ? "Rotating…" : "Promote (rotate live weights)"}
            </button>
          </div>
          <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
            Promote rotates Secrets Manager + appends a ParameterHistory row + auto-supersedes
            other pending proposals. There is no rollback button — re-rotation is the only undo.
          </p>
        </div>
      ) : (
        <EmptyCard
          colors={colors}
          message={`This proposal is ${detail.status}. Actions are only available on pending proposals.`}
        />
      )}

      {confirmPromote ? (
        <PromoteConfirmDialog
          proposalId={detail.proposal_id}
          baselineVersion={detail.baseline_parameter_version}
          onConfirm={onConfirmPromote}
          onCancel={onCancelConfirmPromote}
          loading={actionPending === "promote"}
        />
      ) : null}
    </div>
  );
}

function WeightTable({
  mode,
  block
}: {
  mode: "swing" | "day";
  block: CompositeOverrideBlock;
}) {
  const { colors } = useTheme();
  const surface = cardSurfaceStyle(colors, "neutral");
  const sum = WEIGHT_KEYS.reduce((acc, key) => acc + (block[key] ?? 0), 0);
  return (
    <div
      data-testid={`weight-table-${mode}`}
      style={{
        ...surface,
        padding: spacing[4],
        borderRadius: borderRadius.lg,
        display: "grid",
        gap: spacing[2]
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between"
        }}
      >
        <span
          style={{
            color: colors.text,
            fontSize: typography.scale.sm,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em"
          }}
        >
          {mode === "swing" ? "Swing composite" : "Day composite"} (proposed)
        </span>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
          Σweights = {sum.toFixed(3)}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
        <tbody>
          {WEIGHT_KEYS.map((key) => (
            <tr key={key}>
              <td style={{ padding: `${spacing[1]} 0`, color: colors.textMuted, width: "50%" }}>
                {compositeWeightLabel(key)}
              </td>
              <td
                style={{
                  padding: `${spacing[1]} 0`,
                  color: colors.text,
                  fontFamily: "var(--font-mono, monospace)",
                  textAlign: "right"
                }}
              >
                {(block[key] ?? 0).toFixed(3)}
              </td>
            </tr>
          ))}
          {block.bullish_threshold !== undefined ? (
            <tr>
              <td style={{ padding: `${spacing[1]} 0`, color: colors.textMuted }}>
                {compositeWeightLabel("bullish_threshold")}
              </td>
              <td
                style={{
                  padding: `${spacing[1]} 0`,
                  color: colors.text,
                  fontFamily: "var(--font-mono, monospace)",
                  textAlign: "right"
                }}
              >
                {block.bullish_threshold.toFixed(3)}
              </td>
            </tr>
          ) : null}
          {block.bearish_threshold !== undefined ? (
            <tr>
              <td style={{ padding: `${spacing[1]} 0`, color: colors.textMuted }}>
                {compositeWeightLabel("bearish_threshold")}
              </td>
              <td
                style={{
                  padding: `${spacing[1]} 0`,
                  color: colors.text,
                  fontFamily: "var(--font-mono, monospace)",
                  textAlign: "right"
                }}
              >
                {block.bearish_threshold.toFixed(3)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceBlock({ evidence }: { evidence: Record<string, unknown> }) {
  const { colors } = useTheme();
  const surface = cardSurfaceStyle(colors, "neutral");
  return (
    <details
      data-testid="evidence-block"
      style={{
        ...surface,
        padding: spacing[4],
        borderRadius: borderRadius.lg
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          color: colors.text,
          fontSize: typography.scale.sm,
          fontWeight: 600
        }}
      >
        Optimizer evidence
      </summary>
      <pre
        style={{
          marginTop: spacing[3],
          padding: spacing[3],
          background: colors.surfaceMuted,
          color: colors.text,
          borderRadius: borderRadius.md,
          fontSize: typography.scale.xs,
          fontFamily: "var(--font-mono, monospace)",
          overflowX: "auto",
          whiteSpace: "pre-wrap"
        }}
      >
        {JSON.stringify(evidence, null, 2)}
      </pre>
    </details>
  );
}

function PromoteConfirmDialog({
  proposalId,
  baselineVersion,
  onConfirm,
  onCancel,
  loading
}: {
  proposalId: string;
  baselineVersion: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const { colors } = useTheme();
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      data-testid="admin-promote-confirm-dialog"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9000,
        padding: spacing[4]
      }}
    >
      <div
        style={{
          ...cardSurfaceStyle(colors, "caution"),
          maxWidth: 480,
          width: "100%",
          padding: spacing[5],
          borderRadius: borderRadius.lg,
          display: "grid",
          gap: spacing[3]
        }}
      >
        <h2
          style={{
            margin: 0,
            color: colors.text,
            fontSize: typography.scale.lg,
            fontWeight: 700
          }}
        >
          Rotate live composite weights?
        </h2>
        <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>
          This will:
        </p>
        <ul style={{ margin: 0, paddingLeft: spacing[4], color: colors.text, fontSize: typography.scale.sm }}>
          <li>Update the <code>stocvest/signal-parameters</code> Secrets Manager secret.</li>
          <li>Append a row to <code>ParameterHistory</code> (audit trail).</li>
          <li>Mark proposal <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{proposalId}</span> as promoted.</li>
          <li>Auto-supersede other pending proposals.</li>
        </ul>
        <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
          Current baseline: <strong>v{baselineVersion}</strong>. The new version is calculated
          on promote. There is no rollback button — the only undo is to promote a
          counter-proposal.
        </p>
        <div style={{ display: "flex", gap: spacing[2], justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            data-testid="admin-promote-cancel"
            style={{
              padding: `${spacing[2]} ${spacing[3]}`,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              background: "transparent",
              color: colors.text,
              fontSize: typography.scale.sm,
              cursor: loading ? "wait" : "pointer"
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            data-testid="admin-promote-confirm"
            style={{
              padding: `${spacing[2]} ${spacing[4]}`,
              borderRadius: borderRadius.md,
              border: `1px solid rgba(34,197,94,0.45)`,
              background: "rgba(34,197,94,0.1)",
              color: "rgb(34,197,94)",
              fontSize: typography.scale.sm,
              fontWeight: 700,
              cursor: loading ? "wait" : "pointer"
            }}
          >
            {loading ? "Rotating…" : "Yes, rotate weights"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  } catch {
    return iso;
  }
}
