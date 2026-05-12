"""Admin proposal-review service for D10 Phase 3a.

This module is the bridge between the admin HTTP handlers and the data
layer (:class:`ParameterProposalStore` + :class:`ParameterStore`). It is
where the **promotion** flow lives — the only path in the codebase that
mutates the live ``stocvest/signal-parameters`` Secrets Manager secret
under admin authority.

End-to-end promotion flow:

1. Fetch the proposal by id from :class:`ParameterProposalStore`.
2. Reject if not in ``pending`` state (already-promoted / rejected /
   superseded proposals must not be re-promoted — this is the atomicity
   guarantee enforced by the data layer's :meth:`mark_promoted` too,
   but checking here gives the admin a friendly 4xx instead of a
   raw conditional-check error).
3. Load the current :class:`SignalParameters` from :class:`ParameterStore`.
4. Apply the proposal's per-mode composite override(s) — the shared
   ``composite`` block is **never** mutated; only the per-mode
   ``swing_composite`` / ``day_composite`` overrides change. This
   preserves the back-compat invariant (existing read paths that don't
   know about per-mode blocks continue to use the shared block).
5. Call :meth:`ParameterStore.save_parameters_sync` — that single method
   does the load-bearing atomic write: it increments the version,
   updates the Secrets Manager secret AND writes a
   :class:`ParameterHistory` audit row in one call. If either fails,
   the proposal stays in ``pending`` (the admin can retry).
6. Call :meth:`ParameterProposalStore.mark_promoted` to transition the
   proposal's status row with the new version stamped in.
7. List other still-pending proposals and mark them as ``superseded``
   so the pending queue doesn't grow stale.

The whole flow is **best-effort transactional** rather than strictly
ACID: there's no DDB+SecretsManager two-phase commit. The ordering
above is chosen so the most-impactful step (secret + history write) is
the one that gates everything else. If step 5 succeeds but step 6 fails
(network hiccup), the secret is rotated but the proposal row is still
``pending`` — the admin can promote again and step 5 becomes a no-op
*equivalent* (a duplicate version-bumped write) which the audit trail
will reflect. We document this trade-off in the function docstring.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from stocvest.config.parameter_store import (
    ParameterStore,
    _parse_optional_composite_block,
)
from stocvest.config.signal_parameters import (
    CompositeParameters,
    SignalParameters,
)
from stocvest.data.parameter_proposal_store import (
    PROPOSAL_STATUS_PENDING,
    ParameterProposal,
    ParameterProposalStore,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


# ── Dataclasses ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ProposalSummaryRow:
    """Compact projection of :class:`ParameterProposal` for the list view.

    The list endpoint returns many of these. The detail endpoint returns
    the full proposal dict. Splitting the two responses keeps the list
    response small (admin UIs load 20+ rows on first paint).
    """

    proposal_id: str
    status: str
    created_at: str
    created_by_job: str
    baseline_parameter_version: str
    has_swing_proposal: bool
    has_day_proposal: bool
    # Best-effort accuracy summary lifted out of the evidence block for
    # at-a-glance review in the list view. ``None`` when the proposal's
    # evidence doesn't include the mode (single-mode proposals do not).
    swing_val_accuracy_lift: float | None = None
    day_val_accuracy_lift: float | None = None
    swing_val_signal_count: int | None = None
    day_val_signal_count: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "proposal_id": self.proposal_id,
            "status": self.status,
            "created_at": self.created_at,
            "created_by_job": self.created_by_job,
            "baseline_parameter_version": self.baseline_parameter_version,
            "has_swing_proposal": self.has_swing_proposal,
            "has_day_proposal": self.has_day_proposal,
            "swing_val_accuracy_lift": self.swing_val_accuracy_lift,
            "day_val_accuracy_lift": self.day_val_accuracy_lift,
            "swing_val_signal_count": self.swing_val_signal_count,
            "day_val_signal_count": self.day_val_signal_count,
        }


@dataclass(frozen=True)
class PromotionResult:
    """Outcome of one :func:`promote_proposal` invocation.

    ``success=False`` means the secret was NOT mutated — the admin can
    retry. ``superseded_pending_ids`` is informational: lists any
    *other* pending proposals that this promotion auto-superseded so
    the admin UI can show that detail.
    """

    success: bool
    proposal_id: str
    new_parameter_version: str | None = None
    superseded_pending_ids: list[str] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "proposal_id": self.proposal_id,
            "new_parameter_version": self.new_parameter_version,
            "superseded_pending_ids": list(self.superseded_pending_ids),
            "error": self.error,
        }


# ── Projection helpers (pure functions) ──────────────────────────────────


def _evidence_field(
    proposal: ParameterProposal, mode: str, key: str
) -> Any:
    """Pull ``proposal.evidence[mode][key]`` defensively.

    Phase 2b writes evidence as ``{mode: result.as_evidence_dict()}`` per
    mode — so for a swing-only proposal, ``evidence["day"]`` is absent.
    Returns ``None`` for any missing layer of the lookup; the caller
    decides how to render ``None``.
    """
    if not isinstance(proposal.evidence, dict):
        return None
    block = proposal.evidence.get(mode)
    if not isinstance(block, dict):
        return None
    return block.get(key)


def proposal_to_summary_row(p: ParameterProposal) -> ProposalSummaryRow:
    """Project a full :class:`ParameterProposal` into the list-view shape.

    Pure function. Used by the list handler to compact the response.
    """
    has_swing = p.proposed_swing_composite is not None
    has_day = p.proposed_day_composite is not None

    swing_lift = None
    day_lift = None
    if has_swing:
        swing_val_acc = _evidence_field(p, "swing", "val_accuracy")
        swing_base_acc = _evidence_field(p, "swing", "val_accuracy_baseline")
        if isinstance(swing_val_acc, (int, float)) and isinstance(
            swing_base_acc, (int, float)
        ):
            swing_lift = float(swing_val_acc) - float(swing_base_acc)
    if has_day:
        day_val_acc = _evidence_field(p, "day", "val_accuracy")
        day_base_acc = _evidence_field(p, "day", "val_accuracy_baseline")
        if isinstance(day_val_acc, (int, float)) and isinstance(
            day_base_acc, (int, float)
        ):
            day_lift = float(day_val_acc) - float(day_base_acc)

    swing_n = _evidence_field(p, "swing", "val_signal_count")
    day_n = _evidence_field(p, "day", "val_signal_count")

    return ProposalSummaryRow(
        proposal_id=p.proposal_id,
        status=p.status,
        created_at=p.created_at,
        created_by_job=p.created_by_job,
        baseline_parameter_version=p.baseline_parameter_version,
        has_swing_proposal=has_swing,
        has_day_proposal=has_day,
        swing_val_accuracy_lift=swing_lift,
        day_val_accuracy_lift=day_lift,
        swing_val_signal_count=int(swing_n) if isinstance(swing_n, (int, float)) else None,
        day_val_signal_count=int(day_n) if isinstance(day_n, (int, float)) else None,
    )


def proposal_to_detail_dict(p: ParameterProposal) -> dict[str, Any]:
    """Full JSON projection of a proposal — used by the detail endpoint."""
    return {
        "proposal_id": p.proposal_id,
        "status": p.status,
        "created_at": p.created_at,
        "created_by_job": p.created_by_job,
        "baseline_parameter_version": p.baseline_parameter_version,
        "proposed_swing_composite": p.proposed_swing_composite,
        "proposed_day_composite": p.proposed_day_composite,
        "train_window_start": p.train_window_start,
        "train_window_end": p.train_window_end,
        "val_window_start": p.val_window_start,
        "val_window_end": p.val_window_end,
        "evidence": p.evidence,
        "reviewed_at": p.reviewed_at,
        "reviewed_by": p.reviewed_by,
        "review_note": p.review_note,
        "promoted_to_version": p.promoted_to_version,
    }


def apply_proposal_to_parameters(
    proposal: ParameterProposal, current: SignalParameters
) -> SignalParameters:
    """Return a new :class:`SignalParameters` with the proposal's overrides applied.

    Only the per-mode ``swing_composite`` / ``day_composite`` blocks
    change. The shared ``composite`` block, the per-layer analyzer
    parameter blocks (technical / news / macro / sector / swing_technical)
    and all metadata fields are preserved unchanged.

    A swing-only proposal applies the swing override and leaves the
    existing ``day_composite`` (or ``None``) alone, and vice versa.

    Pure function — returns a NEW :class:`SignalParameters` instance
    (the dataclass is `@dataclass`-mutable but we don't mutate the
    input; the caller passes ``current`` from the parameter store and
    we don't want to surprise them).
    """
    new_swing: CompositeParameters | None = current.swing_composite
    new_day: CompositeParameters | None = current.day_composite

    if proposal.proposed_swing_composite is not None:
        parsed = _parse_optional_composite_block(proposal.proposed_swing_composite)
        if parsed is not None:
            new_swing = parsed
    if proposal.proposed_day_composite is not None:
        parsed = _parse_optional_composite_block(proposal.proposed_day_composite)
        if parsed is not None:
            new_day = parsed

    return SignalParameters(
        version=current.version,
        created_at=current.created_at,
        notes=current.notes,
        technical=current.technical,
        news=current.news,
        macro=current.macro,
        sector=current.sector,
        composite=current.composite,
        swing_composite=new_swing,
        day_composite=new_day,
        swing_technical=current.swing_technical,
    )


# ── Promotion / rejection orchestration ──────────────────────────────────


def promote_proposal(
    proposal_id: str,
    *,
    reviewed_by: str,
    proposal_store: ParameterProposalStore,
    parameter_store: type[ParameterStore] | None = None,
) -> PromotionResult:
    """Promote a pending proposal to live — atomically(-ish) rotate weights.

    See module docstring for the full step-by-step flow and the
    best-effort transactional caveat. Returns a :class:`PromotionResult`
    rather than raising so the admin HTTP handler can return a clean
    4xx/5xx with an explanation in the body.

    Failure modes:

    * Proposal not found → ``success=False``, ``error="not found"``.
    * Proposal not in ``pending`` state → ``success=False``,
      ``error="not pending: <actual_status>"``.
    * Secret save returns False → ``success=False``,
      ``error="parameter save failed"``. **The proposal stays pending.**
    * ``mark_promoted`` raises (e.g. concurrent admin click already
      transitioned it) → secret IS rotated but the proposal row is
      whatever the racing call left it; we surface the underlying
      error so the admin can investigate. This is rare in practice and
      the audit trail in :class:`ParameterHistory` is authoritative.
    """
    pstore_cls = parameter_store if parameter_store is not None else ParameterStore
    proposal = proposal_store.get(proposal_id)
    if proposal is None:
        return PromotionResult(
            success=False,
            proposal_id=proposal_id,
            error="not found",
        )
    if proposal.status != PROPOSAL_STATUS_PENDING:
        return PromotionResult(
            success=False,
            proposal_id=proposal_id,
            error=f"not pending: {proposal.status}",
        )

    current = pstore_cls.get_parameters_sync()
    updated = apply_proposal_to_parameters(proposal, current)
    reason = (
        f"D10 proposal {proposal_id} promoted by {reviewed_by}: "
        f"baseline_v{proposal.baseline_parameter_version} "
        f"swing={'yes' if proposal.proposed_swing_composite else 'no'} "
        f"day={'yes' if proposal.proposed_day_composite else 'no'}"
    )
    save_ok = pstore_cls.save_parameters_sync(
        updated,
        reason=reason,
        changed_by=f"d10-admin:{reviewed_by}",
    )
    if not save_ok:
        return PromotionResult(
            success=False,
            proposal_id=proposal_id,
            error="parameter save failed",
        )

    # ``save_parameters_sync`` mutates ``updated.version`` to the new
    # incremented value before writing — read it back from the same
    # dataclass instance.
    new_version = str(updated.version)

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        proposal_store.mark_promoted(
            proposal_id,
            reviewed_at=now_iso,
            reviewed_by=reviewed_by,
            promoted_to_version=new_version,
        )
    except Exception as exc:
        # Secret IS already rotated — surface the error so the admin can
        # reconcile the proposal row manually.
        _LOG.exception(
            "promote_proposal mark_promoted failed AFTER successful secret write: %s",
            exc,
        )
        return PromotionResult(
            success=False,
            proposal_id=proposal_id,
            new_parameter_version=new_version,
            error=f"mark_promoted failed (secret rotated): {exc}",
        )

    # Auto-supersede any other still-pending proposals — the queue is
    # one-promotion-deep by design (the next optimizer run will rebuild
    # any candidate worth proposing against the fresh baseline).
    superseded: list[str] = []
    try:
        others = proposal_store.list_by_status(PROPOSAL_STATUS_PENDING, limit=50)
        for other in others:
            if other.proposal_id == proposal_id:
                continue
            try:
                proposal_store.mark_superseded(
                    other.proposal_id,
                    superseded_at=now_iso,
                    superseded_by_proposal_id=proposal_id,
                )
                superseded.append(other.proposal_id)
            except Exception as exc:
                # Already-transitioned siblings are not fatal — log and
                # keep going.
                _LOG.warning(
                    "promote_proposal: failed to supersede sibling %s: %s",
                    other.proposal_id,
                    exc,
                )
    except Exception as exc:
        # Listing failures are non-fatal — the secret is already rotated,
        # the chosen proposal is already promoted; stale siblings just
        # need a manual cleanup later (or the next promote_proposal call
        # will sweep them up).
        _LOG.warning("promote_proposal: failed to list pending siblings: %s", exc)

    _LOG.info(
        "promote_proposal succeeded: proposal_id=%s new_version=%s superseded=%s",
        proposal_id,
        new_version,
        superseded,
    )
    return PromotionResult(
        success=True,
        proposal_id=proposal_id,
        new_parameter_version=new_version,
        superseded_pending_ids=superseded,
    )


def reject_proposal(
    proposal_id: str,
    *,
    reviewed_by: str,
    review_note: str | None,
    proposal_store: ParameterProposalStore,
) -> ParameterProposal:
    """Reject a pending proposal. Thin wrapper around :meth:`mark_rejected`.

    Raises whatever :meth:`mark_rejected` raises — typically a
    :class:`ValueError` when the proposal is not found OR is not pending.
    The admin handler catches that and translates to a 4xx response.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    return proposal_store.mark_rejected(
        proposal_id,
        reviewed_at=now_iso,
        reviewed_by=reviewed_by,
        review_note=review_note,
    )
