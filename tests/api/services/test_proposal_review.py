"""Lock-in tests for D10 Phase 3a — admin proposal-review service.

These tests pin the contract for the only production code path that
mutates the live ``stocvest/signal-parameters`` Secrets Manager secret
under admin authority. Every claim made by the admin UI ("promotion
succeeded, baseline_v1.0.3 → v1.0.4 active") rests on the math in this
service module.

What's locked in:

* :class:`ProposalSummaryRow` projection — swing-only / day-only / both,
  defensive handling of missing evidence fields, numeric coercion for
  signal_count.
* :func:`apply_proposal_to_parameters` — swing-only proposal preserves
  the existing ``day_composite`` (and vice versa), shared ``composite``
  block + all per-layer blocks are untouched, returns a NEW
  :class:`SignalParameters` instance without mutating the input.
* :func:`promote_proposal` end-to-end:
  - happy path (single secret-save call, single mark_promoted call,
    new version returned, sibling pending proposals superseded);
  - proposal-not-found ⇒ ``success=False``, ``error="not found"``;
  - proposal-not-pending ⇒ ``success=False``, status-aware error;
  - secret-save failure ⇒ proposal stays pending, ``success=False``;
  - mark_promoted post-secret-write failure ⇒ ``new_version`` IS set
    so the admin can reconcile the row, ``success=False``.
* :func:`reject_proposal` delegates to ``mark_rejected`` with the
  review note threaded through; ValueError on non-pending bubbles.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from typing import Any
from unittest.mock import patch

import pytest
from boto3.dynamodb.conditions import ConditionBase

from stocvest.api.services.proposal_review import (
    PromotionResult,
    ProposalSummaryRow,
    apply_proposal_to_parameters,
    promote_proposal,
    proposal_to_detail_dict,
    proposal_to_summary_row,
    reject_proposal,
)
from stocvest.config.signal_parameters import (
    CompositeParameters,
    SignalParameters,
    default_signal_parameters,
)
from stocvest.data.parameter_proposal_store import (
    GSI_STATUS_INDEX,
    PROPOSAL_STATUS_PENDING,
    PROPOSAL_STATUS_PROMOTED,
    PROPOSAL_STATUS_REJECTED,
    PROPOSAL_STATUS_SUPERSEDED,
    ParameterProposal,
    ParameterProposalStore,
)
from botocore.exceptions import ClientError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _composite_block(
    *,
    technical: float = 0.35,
    news: float = 0.15,
    macro: float = 0.20,
    sector: float = 0.15,
    geopolitical: float = 0.10,
    internals: float = 0.05,
    bullish: float = 0.22,
    bearish: float = -0.22,
) -> dict[str, Any]:
    return {
        "technical_weight": technical,
        "news_weight": news,
        "macro_weight": macro,
        "sector_weight": sector,
        "geopolitical_weight": geopolitical,
        "internals_weight": internals,
        "bullish_threshold": bullish,
        "bearish_threshold": bearish,
    }


def _evidence_block(*, mode: str = "swing", val_acc: float = 0.65, base_acc: float = 0.60,
                    n_val: int = 50) -> dict[str, Any]:
    """Phase-2b shaped evidence — keyed by mode."""
    return {
        mode: {
            "train_accuracy": val_acc + 0.01,
            "val_accuracy": val_acc,
            "train_accuracy_baseline": base_acc + 0.01,
            "val_accuracy_baseline": base_acc,
            "val_signal_count": n_val,
            "regime_distribution_val": {"bull": int(n_val * 0.6), "sideways": int(n_val * 0.4)},
        }
    }


def _pending_proposal(
    *,
    proposal_id: str = "prop-aaaaaaaa",
    swing: bool = True,
    day: bool = False,
    evidence: dict[str, Any] | None = None,
    created_at: str = "2026-05-10T03:00:00+00:00",
) -> ParameterProposal:
    """Build a pending ParameterProposal directly (skipping the factory's uuid)."""
    ev = evidence
    if ev is None:
        if swing and not day:
            ev = _evidence_block(mode="swing")
        elif day and not swing:
            ev = _evidence_block(mode="day")
        elif swing and day:
            ev = {**_evidence_block(mode="swing"), **_evidence_block(mode="day", val_acc=0.62, base_acc=0.58, n_val=40)}
        else:
            ev = {}
    return ParameterProposal(
        proposal_id=proposal_id,
        status=PROPOSAL_STATUS_PENDING,
        created_at=created_at,
        created_by_job="weight_proposer_scheduled",
        baseline_parameter_version="1.0.0",
        proposed_swing_composite=_composite_block() if swing else None,
        proposed_day_composite=_composite_block(technical=0.32, news=0.25) if day else None,
        train_window_start="2026-03-15T00:00:00+00:00",
        train_window_end="2026-04-26T00:00:00+00:00",
        val_window_start="2026-04-26T00:00:00+00:00",
        val_window_end="2026-05-10T00:00:00+00:00",
        evidence=ev,
    )


class _FakeProposalTable:
    """Minimal boto3-Table stand-in for the store; same shape as
    tests/data/test_parameter_proposal_store.py uses but inlined here so
    the test file is self-contained."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}

    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]:
        self.rows[Item["proposal_id"]] = dict(Item)
        return {}

    def get_item(self, *, Key: dict[str, str]) -> dict[str, Any]:
        row = self.rows.get(Key["proposal_id"])
        return {"Item": dict(row)} if row else {}

    def query(
        self,
        *,
        IndexName: str,
        KeyConditionExpression: ConditionBase,
        ScanIndexForward: bool = True,
        Limit: int = 20,
    ) -> dict[str, Any]:
        assert IndexName == GSI_STATUS_INDEX, f"unexpected GSI {IndexName!r}"
        # KeyConditionExpression is always Key("status").eq(x) — extract via _values.
        target_status = getattr(KeyConditionExpression, "_values", (None, None))[1]
        matched = [
            dict(r) for r in self.rows.values() if r.get("status") == target_status
        ]
        matched.sort(key=lambda r: str(r.get("created_at", "")), reverse=not ScanIndexForward)
        return {"Items": matched[: int(Limit)]}

    def update_item(
        self,
        *,
        Key: dict[str, str],
        UpdateExpression: str,
        ConditionExpression: str,
        ExpressionAttributeNames: dict[str, str],
        ExpressionAttributeValues: dict[str, Any],
        ReturnValues: str,
    ) -> dict[str, Any]:
        del UpdateExpression, ReturnValues
        proposal_id = Key["proposal_id"]
        row = self.rows.get(proposal_id)
        if row is None:
            raise ClientError(
                {"Error": {"Code": "ConditionalCheckFailedException", "Message": "no row"}},
                "UpdateItem",
            )
        assert ConditionExpression == "#st = :expected"
        if row.get("status") != ExpressionAttributeValues[":expected"]:
            raise ClientError(
                {"Error": {"Code": "ConditionalCheckFailedException", "Message": "wrong status"}},
                "UpdateItem",
            )
        for placeholder_n, attr_name in ExpressionAttributeNames.items():
            if placeholder_n == "#st":
                row["status"] = ExpressionAttributeValues[":new_status"]
                continue
            placeholder_v = ":u_" + attr_name
            if placeholder_v in ExpressionAttributeValues:
                row[attr_name] = ExpressionAttributeValues[placeholder_v]
        return {"Attributes": dict(row)}


def _store_with(*proposals: ParameterProposal) -> ParameterProposalStore:
    """Build a ParameterProposalStore backed by the fake table; pre-populated."""
    table = _FakeProposalTable()
    store = ParameterProposalStore(table=table)  # type: ignore[arg-type]
    for p in proposals:
        store.put(p)
    return store


class _FakeParameterStore:
    """Inject-able stand-in for ParameterStore.

    Mirrors only the two classmethods used by the service:
    ``get_parameters_sync`` and ``save_parameters_sync``. Captures all
    calls so tests can assert on the rotation arguments.
    """

    _params: SignalParameters = default_signal_parameters()
    _save_results: list[bool] = [True]
    _save_calls: list[tuple[SignalParameters, str, dict[str, Any]]] = []

    @classmethod
    def reset(cls, *, params: SignalParameters | None = None, save_results: list[bool] | None = None) -> None:
        cls._params = params if params is not None else default_signal_parameters()
        cls._save_results = list(save_results) if save_results is not None else [True]
        cls._save_calls = []

    @classmethod
    def get_parameters_sync(cls) -> SignalParameters:
        return cls._params

    @classmethod
    def save_parameters_sync(cls, params: SignalParameters, reason: str, **kwargs: Any) -> bool:
        # Capture the call. Bump the in-memory params version to mimic the
        # real save's behavior so subsequent reads see the new version.
        parts = (params.version or "1.0.0").split(".")
        try:
            nums = [int(p) for p in parts[:3]]
        except ValueError:
            nums = [1, 0, 0]
        while len(nums) < 3:
            nums.append(0)
        nums[2] += 1
        params.version = ".".join(str(n) for n in nums[:3])
        cls._save_calls.append((params, reason, dict(kwargs)))
        if not cls._save_results:
            return True
        return cls._save_results.pop(0)


# ---------------------------------------------------------------------------
# ProposalSummaryRow projection
# ---------------------------------------------------------------------------


def test_summary_row_swing_only_proposal() -> None:
    """Swing-only proposal: has_swing=True, has_day=False, day_lift=None."""
    p = _pending_proposal(swing=True, day=False)
    row = proposal_to_summary_row(p)
    assert row.has_swing_proposal is True
    assert row.has_day_proposal is False
    assert row.swing_val_accuracy_lift == pytest.approx(0.05)
    assert row.day_val_accuracy_lift is None
    assert row.swing_val_signal_count == 50
    assert row.day_val_signal_count is None


def test_summary_row_day_only_proposal() -> None:
    """Symmetric — day-only proposal."""
    p = _pending_proposal(swing=False, day=True)
    row = proposal_to_summary_row(p)
    assert row.has_swing_proposal is False
    assert row.has_day_proposal is True
    assert row.swing_val_accuracy_lift is None
    assert row.day_val_accuracy_lift == pytest.approx(0.05)


def test_summary_row_both_modes_proposal() -> None:
    """Both modes proposed — both lift values populated, distinct."""
    p = _pending_proposal(swing=True, day=True)
    row = proposal_to_summary_row(p)
    assert row.has_swing_proposal is True
    assert row.has_day_proposal is True
    assert row.swing_val_accuracy_lift is not None
    assert row.day_val_accuracy_lift is not None
    # Distinct accuracy numbers from the fixture mean distinct lifts.
    assert row.swing_val_accuracy_lift != row.day_val_accuracy_lift


def test_summary_row_handles_missing_evidence_gracefully() -> None:
    """No evidence at all → lift fields are None, not exceptions."""
    p = _pending_proposal(swing=True, evidence={})
    row = proposal_to_summary_row(p)
    assert row.swing_val_accuracy_lift is None
    assert row.swing_val_signal_count is None


def test_summary_row_coerces_signal_count_to_int() -> None:
    """A float in evidence (e.g. from JSON) is coerced to int for the API surface."""
    ev = {"swing": {"val_accuracy": 0.65, "val_accuracy_baseline": 0.60, "val_signal_count": 50.0}}
    p = _pending_proposal(swing=True, evidence=ev)
    row = proposal_to_summary_row(p)
    assert isinstance(row.swing_val_signal_count, int)
    assert row.swing_val_signal_count == 50


def test_summary_row_to_dict_shape_is_stable() -> None:
    """to_dict produces a stable key set the BFF + UI consume."""
    p = _pending_proposal(swing=True, day=True)
    payload = proposal_to_summary_row(p).to_dict()
    expected_keys = {
        "proposal_id",
        "status",
        "created_at",
        "created_by_job",
        "baseline_parameter_version",
        "has_swing_proposal",
        "has_day_proposal",
        "swing_val_accuracy_lift",
        "day_val_accuracy_lift",
        "swing_val_signal_count",
        "day_val_signal_count",
    }
    assert set(payload.keys()) == expected_keys


# ---------------------------------------------------------------------------
# proposal_to_detail_dict
# ---------------------------------------------------------------------------


def test_detail_dict_carries_every_field() -> None:
    """The detail endpoint exposes the full proposal payload."""
    p = _pending_proposal(swing=True, day=True)
    payload = proposal_to_detail_dict(p)
    assert payload["proposal_id"] == p.proposal_id
    assert payload["status"] == PROPOSAL_STATUS_PENDING
    assert payload["proposed_swing_composite"] is not None
    assert payload["proposed_day_composite"] is not None
    assert payload["evidence"] is not None
    # Pre-review fields are None / unset on pending proposals.
    assert payload["reviewed_at"] is None
    assert payload["reviewed_by"] is None
    assert payload["promoted_to_version"] is None


# ---------------------------------------------------------------------------
# apply_proposal_to_parameters — surgical override application
# ---------------------------------------------------------------------------


def test_apply_swing_only_proposal_preserves_existing_day_composite() -> None:
    """Swing-only override must NOT clear an existing day_composite."""
    current = default_signal_parameters()
    current.day_composite = CompositeParameters(
        technical_weight=0.32,
        news_weight=0.20,
        macro_weight=0.10,
        sector_weight=0.13,
        geopolitical_weight=0.08,
        internals_weight=0.17,
    )
    proposal = _pending_proposal(swing=True, day=False)
    updated = apply_proposal_to_parameters(proposal, current)
    assert updated.swing_composite is not None
    # Day composite preserved — exact same dataclass instance is acceptable
    # for the contract (no mutation guarantee), but we assert on values.
    assert updated.day_composite is not None
    assert updated.day_composite.technical_weight == 0.32


def test_apply_day_only_proposal_preserves_existing_swing_composite() -> None:
    """Symmetric: day-only override must NOT clear an existing swing_composite."""
    current = default_signal_parameters()
    current.swing_composite = CompositeParameters(
        technical_weight=0.40, news_weight=0.10, macro_weight=0.20,
        sector_weight=0.15, geopolitical_weight=0.10, internals_weight=0.05,
    )
    proposal = _pending_proposal(swing=False, day=True)
    updated = apply_proposal_to_parameters(proposal, current)
    assert updated.day_composite is not None
    assert updated.swing_composite is not None
    assert updated.swing_composite.technical_weight == 0.40


def test_apply_both_modes_proposal_sets_both_overrides() -> None:
    """Both-mode proposal rotates both per-mode blocks."""
    proposal = _pending_proposal(swing=True, day=True)
    updated = apply_proposal_to_parameters(proposal, default_signal_parameters())
    assert updated.swing_composite is not None
    assert updated.day_composite is not None


def test_apply_proposal_does_not_mutate_shared_composite_block() -> None:
    """The shared `composite` fallback must NEVER change — it's the back-compat anchor."""
    current = default_signal_parameters()
    snapshot = (
        current.composite.technical_weight,
        current.composite.news_weight,
        current.composite.macro_weight,
        current.composite.sector_weight,
        current.composite.geopolitical_weight,
        current.composite.internals_weight,
        current.composite.bullish_threshold,
        current.composite.bearish_threshold,
    )
    proposal = _pending_proposal(swing=True, day=True)
    updated = apply_proposal_to_parameters(proposal, current)
    after_snapshot = (
        updated.composite.technical_weight,
        updated.composite.news_weight,
        updated.composite.macro_weight,
        updated.composite.sector_weight,
        updated.composite.geopolitical_weight,
        updated.composite.internals_weight,
        updated.composite.bullish_threshold,
        updated.composite.bearish_threshold,
    )
    assert snapshot == after_snapshot


def test_apply_proposal_does_not_mutate_input_parameters() -> None:
    """apply_proposal_to_parameters returns a new instance, not the input."""
    current = default_signal_parameters()
    proposal = _pending_proposal(swing=True)
    updated = apply_proposal_to_parameters(proposal, current)
    # Input's swing_composite still None (default) — wasn't reassigned.
    assert current.swing_composite is None
    assert updated.swing_composite is not None


# ---------------------------------------------------------------------------
# promote_proposal — orchestration end-to-end
# ---------------------------------------------------------------------------


def test_promote_proposal_happy_path() -> None:
    """Pending proposal → secret save → mark_promoted → returns new version."""
    proposal = _pending_proposal(swing=True)
    store = _store_with(proposal)
    _FakeParameterStore.reset()

    result = promote_proposal(
        proposal.proposal_id,
        reviewed_by="admin-sub-123",
        proposal_store=store,
        parameter_store=_FakeParameterStore,
    )

    assert result.success is True
    assert result.proposal_id == proposal.proposal_id
    # 1.0.0 → 1.0.1 after one bump.
    assert result.new_parameter_version == "1.0.1"
    # Exactly one save call — the proposal carries the swing override.
    assert len(_FakeParameterStore._save_calls) == 1
    saved_params, reason, kwargs = _FakeParameterStore._save_calls[0]
    assert saved_params.swing_composite is not None
    assert "promoted by admin-sub-123" in reason
    assert kwargs.get("changed_by") == "d10-admin:admin-sub-123"
    # Proposal row transitioned to promoted.
    refreshed = store.get(proposal.proposal_id)
    assert refreshed is not None
    assert refreshed.status == PROPOSAL_STATUS_PROMOTED
    assert refreshed.promoted_to_version == "1.0.1"


def test_promote_proposal_not_found_returns_error() -> None:
    """Missing proposal → success=False with friendly error."""
    store = _store_with()
    _FakeParameterStore.reset()
    result = promote_proposal(
        "nonexistent-id",
        reviewed_by="admin",
        proposal_store=store,
        parameter_store=_FakeParameterStore,
    )
    assert result.success is False
    assert result.error == "not found"
    # No secret write happened.
    assert _FakeParameterStore._save_calls == []


def test_promote_proposal_already_promoted_returns_error() -> None:
    """Already-promoted proposal → success=False with status-aware error."""
    proposal = _pending_proposal(swing=True)
    store = _store_with(proposal)
    # Force the proposal into the promoted state directly.
    store.mark_promoted(
        proposal.proposal_id,
        reviewed_at="2026-05-12T00:00:00+00:00",
        reviewed_by="prior-admin",
        promoted_to_version="1.0.1",
    )
    _FakeParameterStore.reset()
    result = promote_proposal(
        proposal.proposal_id,
        reviewed_by="admin",
        proposal_store=store,
        parameter_store=_FakeParameterStore,
    )
    assert result.success is False
    assert result.error is not None
    assert "not pending" in result.error
    assert "promoted" in result.error
    # No new secret write.
    assert _FakeParameterStore._save_calls == []


def test_promote_proposal_secret_save_failure_leaves_proposal_pending() -> None:
    """When save_parameters_sync returns False, the proposal stays pending."""
    proposal = _pending_proposal(swing=True)
    store = _store_with(proposal)
    _FakeParameterStore.reset(save_results=[False])
    result = promote_proposal(
        proposal.proposal_id,
        reviewed_by="admin",
        proposal_store=store,
        parameter_store=_FakeParameterStore,
    )
    assert result.success is False
    assert result.error == "parameter save failed"
    # Proposal still pending.
    refreshed = store.get(proposal.proposal_id)
    assert refreshed is not None
    assert refreshed.status == PROPOSAL_STATUS_PENDING


def test_promote_proposal_supersedes_other_pending_proposals() -> None:
    """When a promotion succeeds, OTHER pending proposals are auto-superseded."""
    target = _pending_proposal(proposal_id="prop-aaaaaaaa", swing=True)
    sibling_a = _pending_proposal(
        proposal_id="prop-bbbbbbbb", swing=False, day=True,
        created_at="2026-05-09T03:00:00+00:00",
    )
    sibling_b = _pending_proposal(
        proposal_id="prop-cccccccc", swing=True, day=True,
        created_at="2026-05-08T03:00:00+00:00",
    )
    store = _store_with(target, sibling_a, sibling_b)
    _FakeParameterStore.reset()

    result = promote_proposal(
        target.proposal_id,
        reviewed_by="admin",
        proposal_store=store,
        parameter_store=_FakeParameterStore,
    )

    assert result.success is True
    # Both siblings appear in the superseded list (order may vary by GSI sort).
    assert set(result.superseded_pending_ids) == {sibling_a.proposal_id, sibling_b.proposal_id}
    # Both siblings transitioned in DDB.
    sib_a_refreshed = store.get(sibling_a.proposal_id)
    sib_b_refreshed = store.get(sibling_b.proposal_id)
    assert sib_a_refreshed is not None and sib_a_refreshed.status == PROPOSAL_STATUS_SUPERSEDED
    assert sib_b_refreshed is not None and sib_b_refreshed.status == PROPOSAL_STATUS_SUPERSEDED


def test_promote_proposal_no_siblings_to_supersede() -> None:
    """A single-pending-proposal promotion has empty superseded_pending_ids."""
    proposal = _pending_proposal(swing=True)
    store = _store_with(proposal)
    _FakeParameterStore.reset()
    result = promote_proposal(
        proposal.proposal_id,
        reviewed_by="admin",
        proposal_store=store,
        parameter_store=_FakeParameterStore,
    )
    assert result.success is True
    assert result.superseded_pending_ids == []


def test_promote_proposal_mark_promoted_failure_after_secret_write() -> None:
    """If mark_promoted raises AFTER the secret was rotated, surface the error
    with new_parameter_version set so the admin can reconcile."""
    proposal = _pending_proposal(swing=True)
    store = _store_with(proposal)
    _FakeParameterStore.reset()

    real_mark = store.mark_promoted

    def _flaky_mark(*args: Any, **kwargs: Any) -> ParameterProposal:
        raise RuntimeError("synthetic DDB outage")

    with patch.object(store, "mark_promoted", side_effect=_flaky_mark):
        result = promote_proposal(
            proposal.proposal_id,
            reviewed_by="admin",
            proposal_store=store,
            parameter_store=_FakeParameterStore,
        )

    assert result.success is False
    # Secret IS already rotated — version is populated.
    assert result.new_parameter_version == "1.0.1"
    assert result.error is not None
    assert "mark_promoted failed" in result.error
    assert "synthetic DDB outage" in result.error


def test_promote_proposal_applies_only_proposed_modes() -> None:
    """Swing-only proposal applies the swing block, leaves day_composite as currently
    configured. Day-only proposal does the symmetric thing."""
    swing_only = _pending_proposal(proposal_id="prop-aaaaaaaa", swing=True, day=False)
    store = _store_with(swing_only)
    _FakeParameterStore.reset()
    # Pre-set day_composite on the in-memory params so we can detect untouched.
    _FakeParameterStore._params = SignalParameters(
        version="1.0.0",
        day_composite=CompositeParameters(
            technical_weight=0.99,  # sentinel: must be preserved
            news_weight=0.01,
            macro_weight=0.0,
            sector_weight=0.0,
            geopolitical_weight=0.0,
            internals_weight=0.0,
        ),
    )

    promote_proposal(
        swing_only.proposal_id,
        reviewed_by="admin",
        proposal_store=store,
        parameter_store=_FakeParameterStore,
    )

    saved_params, _, _ = _FakeParameterStore._save_calls[0]
    # Swing block was set, day block preserved at sentinel value.
    assert saved_params.swing_composite is not None
    assert saved_params.day_composite is not None
    assert saved_params.day_composite.technical_weight == 0.99


def test_promote_proposal_reason_carries_audit_breadcrumbs() -> None:
    """The reason string passed to save_parameters_sync includes the
    proposal_id + admin sub + which modes were rotated — used by the
    ParameterHistory audit row downstream."""
    proposal = _pending_proposal(proposal_id="prop-aaaaaaaa", swing=True, day=False)
    store = _store_with(proposal)
    _FakeParameterStore.reset()
    promote_proposal(
        proposal.proposal_id,
        reviewed_by="admin-sub-xyz",
        proposal_store=store,
        parameter_store=_FakeParameterStore,
    )
    _, reason, _ = _FakeParameterStore._save_calls[0]
    assert proposal.proposal_id in reason
    assert "admin-sub-xyz" in reason
    assert "swing=yes" in reason
    assert "day=no" in reason


# ---------------------------------------------------------------------------
# reject_proposal
# ---------------------------------------------------------------------------


def test_reject_proposal_happy_path() -> None:
    """Pending proposal → rejected with note + reviewed_by stamped."""
    proposal = _pending_proposal(swing=True)
    store = _store_with(proposal)
    out = reject_proposal(
        proposal.proposal_id,
        reviewed_by="admin",
        review_note="too noisy in regime mix",
        proposal_store=store,
    )
    assert out.status == PROPOSAL_STATUS_REJECTED
    assert out.reviewed_by == "admin"
    assert out.review_note == "too noisy in regime mix"


def test_reject_proposal_raises_on_non_pending() -> None:
    """Rejecting an already-rejected proposal raises ValueError (atomic constraint)."""
    proposal = _pending_proposal(swing=True)
    store = _store_with(proposal)
    reject_proposal(
        proposal.proposal_id, reviewed_by="admin", review_note=None, proposal_store=store
    )
    with pytest.raises(ValueError, match="not in status 'pending'"):
        reject_proposal(
            proposal.proposal_id,
            reviewed_by="admin",
            review_note="second attempt",
            proposal_store=store,
        )


def test_reject_proposal_optional_review_note() -> None:
    """review_note is optional — defaults to None on the row."""
    proposal = _pending_proposal(swing=True)
    store = _store_with(proposal)
    out = reject_proposal(
        proposal.proposal_id, reviewed_by="admin", review_note=None, proposal_store=store
    )
    assert out.review_note is None
