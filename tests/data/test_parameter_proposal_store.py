"""Lock-in tests for D10 Phase 1 — parameter-proposal store.

These tests pin the data-layer contract for the proposal-only weight-tuning
pipeline. Phase 1 ships dark (no production paths invoke this store yet), so
the tests are the *entire* surface that proves the contract is correct. When
Phase 2 wires the optimizer Lambda, these tests are the safety net that lets
us evolve the optimizer without accidentally breaking the persistence layer.

What's locked in:

  * Lifecycle state machine: pending → promoted | rejected | superseded;
    no transition out of a non-pending state; atomicity via DDB
    ConditionalCheckExpression.
  * Round-trip serialization: every field survives ``to_item`` → DDB row →
    ``from_item``, including the JSON-encoded nested fields (``evidence``,
    ``proposed_swing_composite``, ``proposed_day_composite``).
  * GSI query semantics: ``list_by_status`` returns DESC by ``created_at`` and
    rejects invalid status strings loud.
  * Factory invariants: ``new_pending`` requires at least one per-mode
    override block.
  * TTL stamping: rejected/superseded rows carry a TTL; promoted rows do not.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest
from boto3.dynamodb.conditions import ConditionBase
from botocore.exceptions import ClientError

from stocvest.data.parameter_proposal_store import (
    GSI_STATUS_INDEX,
    PROPOSAL_STATUS_PENDING,
    PROPOSAL_STATUS_PROMOTED,
    PROPOSAL_STATUS_REJECTED,
    PROPOSAL_STATUS_SUPERSEDED,
    PROPOSAL_STATUS_VALUES,
    PROPOSAL_TTL_DAYS,
    ParameterProposal,
    ParameterProposalStore,
)


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


def _composite_block(
    *,
    technical: float = 0.28,
    news: float = 0.15,
    macro: float = 0.20,
    sector: float = 0.18,
    geopolitical: float = 0.12,
    internals: float = 0.07,
    bullish: float = 0.20,
    bearish: float = -0.20,
) -> dict[str, Any]:
    """Helper — a realistic CompositeParameters override dict."""
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


def _evidence_block() -> dict[str, Any]:
    """Helper — a Phase-2-shaped evidence dict for assertion stability."""
    return {
        "swing": {
            "train_accuracy": 0.62,
            "val_accuracy": 0.64,
            "train_accuracy_baseline": 0.59,
            "val_accuracy_baseline": 0.60,
            "val_signal_count": 87,
            "regime_distribution": {"risk_on": 50, "neutral": 30, "risk_off": 7},
        },
        "day": {
            "train_accuracy": 0.58,
            "val_accuracy": 0.61,
            "train_accuracy_baseline": 0.55,
            "val_accuracy_baseline": 0.57,
            "val_signal_count": 142,
            "regime_distribution": {"risk_on": 80, "neutral": 50, "risk_off": 12},
        },
    }


class _FakeTable:
    """In-process boto3-Table stand-in.

    Implements the subset of operations the proposal store uses
    (``put_item``, ``get_item``, ``query``, ``update_item``) with realistic
    semantics — including ``ConditionalCheckFailedException`` on
    ``update_item`` when the condition fails, which is the only way the
    lifecycle atomicity is actually exercised by tests.
    """

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
        # Match by status from the KeyConditionExpression — the proposal store
        # only ever queries `Key("status").eq(status)`, so we can extract the
        # target value defensively via _values, with a fallback for
        # ConditionBase shapes that don't expose it.
        target_status = _extract_eq_value(KeyConditionExpression)
        matched = [
            dict(row)
            for row in self.rows.values()
            if row.get("status") == target_status
        ]
        # Sort by created_at; ScanIndexForward=False -> DESC (newest first).
        matched.sort(key=lambda r: str(r.get("created_at", "")), reverse=not ScanIndexForward)
        # Cosmetic — assert the right GSI is used so a future caller change is
        # caught loud (we'll fail the test if the production code accidentally
        # queries the base table or a different index).
        assert IndexName == GSI_STATUS_INDEX, f"expected GSI {GSI_STATUS_INDEX!r}, got {IndexName!r}"
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
        del UpdateExpression  # not parsed — we apply extra_updates directly
        del ReturnValues  # always ALL_NEW for our store
        proposal_id = Key["proposal_id"]
        row = self.rows.get(proposal_id)
        if row is None:
            raise _conditional_check_failed()
        # ConditionExpression for the proposal store is always
        # "#st = :expected" — fetch the expected status and compare.
        assert ConditionExpression == "#st = :expected"
        expected_status = ExpressionAttributeValues[":expected"]
        if row.get("status") != expected_status:
            raise _conditional_check_failed()
        # Apply the SET ... assignments by mapping placeholders back to
        # attribute names + values.
        for placeholder_n, attr_name in ExpressionAttributeNames.items():
            if placeholder_n == "#st":
                row["status"] = ExpressionAttributeValues[":new_status"]
                continue
            placeholder_v = ":u_" + attr_name
            if placeholder_v in ExpressionAttributeValues:
                row[attr_name] = ExpressionAttributeValues[placeholder_v]
        return {"Attributes": dict(row)}


def _extract_eq_value(condition: ConditionBase) -> Any:
    """Pull the right-hand side of a ``Key('x').eq(y)`` ConditionBase.

    boto3 exposes this via ``_values`` (private but stable in 1.34.x). The
    function is local to tests so a future boto3 refactor is contained.
    """
    return getattr(condition, "_values", (None, None))[1]


def _conditional_check_failed() -> ClientError:
    """Mint a botocore ClientError shaped like a real DDB conditional failure."""
    return ClientError(
        {"Error": {"Code": "ConditionalCheckFailedException", "Message": "match"}},
        "UpdateItem",
    )


def _fresh_pending() -> ParameterProposal:
    """A canonical pending proposal — both per-mode overrides, full evidence."""
    return ParameterProposal.new_pending(
        baseline_parameter_version="1.0.0",
        proposed_swing_composite=_composite_block(),
        proposed_day_composite=_composite_block(
            technical=0.32, news=0.25, macro=0.10, sector=0.12, geopolitical=0.08, internals=0.13
        ),
        train_window_start="2026-03-15T00:00:00+00:00",
        train_window_end="2026-04-26T00:00:00+00:00",
        val_window_start="2026-04-26T00:00:00+00:00",
        val_window_end="2026-05-10T00:00:00+00:00",
        evidence=_evidence_block(),
        created_by_job="weekly-proposer-2026-W19",
        created_at="2026-05-10T03:00:00+00:00",
        proposal_id="prop-aaaaaaaa",
    )


# ---------------------------------------------------------------------------
# Factory / invariants
# ---------------------------------------------------------------------------


def test_new_pending_requires_at_least_one_per_mode_block() -> None:
    """A proposal with neither swing nor day override carries no information."""
    with pytest.raises(ValueError, match="at least one per-mode override block"):
        ParameterProposal.new_pending(
            baseline_parameter_version="1.0.0",
            proposed_swing_composite=None,
            proposed_day_composite=None,
            train_window_start="2026-03-15T00:00:00+00:00",
            train_window_end="2026-04-26T00:00:00+00:00",
            val_window_start="2026-04-26T00:00:00+00:00",
            val_window_end="2026-05-10T00:00:00+00:00",
            evidence={},
            created_by_job="weekly-proposer-2026-W19",
        )


def test_new_pending_accepts_swing_only_proposal() -> None:
    """Single-mode proposals are valid — optimizer may rotate only swing weights."""
    p = ParameterProposal.new_pending(
        baseline_parameter_version="1.0.0",
        proposed_swing_composite=_composite_block(),
        proposed_day_composite=None,
        train_window_start="2026-03-15T00:00:00+00:00",
        train_window_end="2026-04-26T00:00:00+00:00",
        val_window_start="2026-04-26T00:00:00+00:00",
        val_window_end="2026-05-10T00:00:00+00:00",
        evidence={},
        created_by_job="weekly-proposer-2026-W19",
    )
    assert p.proposed_swing_composite is not None
    assert p.proposed_day_composite is None
    assert p.status == PROPOSAL_STATUS_PENDING


def test_new_pending_accepts_day_only_proposal() -> None:
    """Symmetric — single-mode day proposals are valid."""
    p = ParameterProposal.new_pending(
        baseline_parameter_version="1.0.0",
        proposed_swing_composite=None,
        proposed_day_composite=_composite_block(),
        train_window_start="2026-03-15T00:00:00+00:00",
        train_window_end="2026-04-26T00:00:00+00:00",
        val_window_start="2026-04-26T00:00:00+00:00",
        val_window_end="2026-05-10T00:00:00+00:00",
        evidence={},
        created_by_job="weekly-proposer-2026-W19",
    )
    assert p.proposed_day_composite is not None
    assert p.proposed_swing_composite is None
    assert p.status == PROPOSAL_STATUS_PENDING


def test_new_pending_auto_generates_id_and_timestamp() -> None:
    """When proposal_id / created_at aren't passed, the factory mints fresh values."""
    p = ParameterProposal.new_pending(
        baseline_parameter_version="1.0.0",
        proposed_swing_composite=_composite_block(),
        proposed_day_composite=None,
        train_window_start="2026-03-15T00:00:00+00:00",
        train_window_end="2026-04-26T00:00:00+00:00",
        val_window_start="2026-04-26T00:00:00+00:00",
        val_window_end="2026-05-10T00:00:00+00:00",
        evidence={},
        created_by_job="weekly-proposer-2026-W19",
    )
    # UUID v4 hex is 32 hex chars; the factory's default should at least look like an id.
    assert len(p.proposal_id) >= 16
    # ISO-8601 UTC timestamp — must parse back to a datetime in UTC.
    parsed = datetime.fromisoformat(p.created_at)
    assert parsed.tzinfo is not None
    assert parsed.tzinfo.utcoffset(parsed) == timezone.utc.utcoffset(parsed)


# ---------------------------------------------------------------------------
# Round-trip serialization
# ---------------------------------------------------------------------------


def test_to_item_round_trip_preserves_every_field() -> None:
    """to_item → from_item is the identity transform on a fully-populated proposal."""
    original = _fresh_pending()
    # Force-set the review-state fields so the round-trip covers them too.
    original.reviewed_at = "2026-05-12T14:00:00+00:00"
    original.reviewed_by = "admin@stocvest.app"
    original.review_note = "approved — val accuracy +4pts swing, +4pts day"
    original.promoted_to_version = "1.1.0"
    original.ttl = 1_700_000_000

    item = original.to_item()
    restored = ParameterProposal.from_item(item)

    assert restored == original


def test_to_item_omits_optional_fields_when_unset() -> None:
    """Fresh pending proposals don't carry review-state attributes on the DDB row."""
    p = _fresh_pending()
    item = p.to_item()
    # Review-state keys should NOT be present at all (vs present-with-empty).
    for k in ("reviewed_at", "reviewed_by", "review_note", "promoted_to_version", "ttl"):
        assert k not in item, f"key {k!r} should be omitted for fresh pending row"


def test_to_item_encodes_nested_dicts_as_json_strings() -> None:
    """Nested dicts are JSON-encoded to sidestep DDB Decimal coercion."""
    p = _fresh_pending()
    item = p.to_item()
    assert isinstance(item["evidence"], str)
    assert isinstance(item["proposed_swing_composite"], str)
    assert isinstance(item["proposed_day_composite"], str)
    # The encoded payload must still be JSON-loadable.
    import json as _json

    assert _json.loads(item["evidence"]) == _evidence_block()


def test_from_item_tolerates_raw_dict_in_nested_fields() -> None:
    """Defensive: a hand-written DDB row with raw dicts (vs JSON strings) round-trips."""
    p = _fresh_pending()
    item = p.to_item()
    # Replace the JSON-encoded strings with raw dicts to simulate a hand-written row.
    import json as _json

    item["evidence"] = _json.loads(item["evidence"])
    item["proposed_swing_composite"] = _json.loads(item["proposed_swing_composite"])
    item["proposed_day_composite"] = _json.loads(item["proposed_day_composite"])

    restored = ParameterProposal.from_item(item)
    assert restored.evidence == p.evidence
    assert restored.proposed_swing_composite == p.proposed_swing_composite
    assert restored.proposed_day_composite == p.proposed_day_composite


# ---------------------------------------------------------------------------
# CRUD — happy paths
# ---------------------------------------------------------------------------


def test_put_then_get_returns_equivalent_proposal() -> None:
    """Round-trip through the store preserves the proposal."""
    store = ParameterProposalStore(table=_FakeTable())
    p = _fresh_pending()
    store.put(p)
    restored = store.get(p.proposal_id)
    assert restored == p


def test_get_returns_none_for_missing_id() -> None:
    """Missing proposal id returns None, not an exception."""
    store = ParameterProposalStore(table=_FakeTable())
    assert store.get("does-not-exist") is None


def test_put_is_idempotent_for_same_id() -> None:
    """A second put with the same id overwrites the first — retry-safe."""
    store = ParameterProposalStore(table=_FakeTable())
    p = _fresh_pending()
    store.put(p)
    # Mutate and re-put; the store should now return the mutated version.
    p2 = ParameterProposal(**{**p.__dict__, "review_note": "(injected)"})
    store.put(p2)
    restored = store.get(p.proposal_id)
    assert restored is not None
    assert restored.review_note == "(injected)"


# ---------------------------------------------------------------------------
# GSI query semantics
# ---------------------------------------------------------------------------


def test_list_by_status_returns_desc_by_created_at() -> None:
    """Newest pending proposal appears first (DESC sort)."""
    store = ParameterProposalStore(table=_FakeTable())
    old = ParameterProposal(**{**_fresh_pending().__dict__, "proposal_id": "p-old", "created_at": "2026-05-01T00:00:00+00:00"})
    mid = ParameterProposal(**{**_fresh_pending().__dict__, "proposal_id": "p-mid", "created_at": "2026-05-05T00:00:00+00:00"})
    new = ParameterProposal(**{**_fresh_pending().__dict__, "proposal_id": "p-new", "created_at": "2026-05-10T00:00:00+00:00"})
    for p in (old, mid, new):
        store.put(p)

    rows = store.list_by_status(PROPOSAL_STATUS_PENDING)
    assert [r.proposal_id for r in rows] == ["p-new", "p-mid", "p-old"]


def test_list_by_status_filters_by_status() -> None:
    """Only proposals matching the target status appear in the result."""
    table = _FakeTable()
    store = ParameterProposalStore(table=table)
    # Two pending, one promoted (manually inject via put_item to simulate prior state).
    p1 = _fresh_pending()
    store.put(p1)
    p2 = ParameterProposal(**{**p1.__dict__, "proposal_id": "p-2"})
    store.put(p2)
    promoted = ParameterProposal(**{**p1.__dict__, "proposal_id": "p-3", "status": PROPOSAL_STATUS_PROMOTED})
    store.put(promoted)

    pending_rows = store.list_by_status(PROPOSAL_STATUS_PENDING)
    promoted_rows = store.list_by_status(PROPOSAL_STATUS_PROMOTED)
    assert {r.proposal_id for r in pending_rows} == {p1.proposal_id, "p-2"}
    assert {r.proposal_id for r in promoted_rows} == {"p-3"}


def test_list_by_status_rejects_invalid_status_loud() -> None:
    """A typo in status should raise loud, not silently return []."""
    store = ParameterProposalStore(table=_FakeTable())
    with pytest.raises(ValueError, match="Invalid status"):
        store.list_by_status("pendng")  # typo


def test_list_by_status_honors_limit() -> None:
    """The limit parameter caps the returned rows."""
    store = ParameterProposalStore(table=_FakeTable())
    base = _fresh_pending()
    for i in range(5):
        p = ParameterProposal(**{**base.__dict__, "proposal_id": f"p-{i}", "created_at": f"2026-05-0{i + 1}T00:00:00+00:00"})
        store.put(p)
    rows = store.list_by_status(PROPOSAL_STATUS_PENDING, limit=3)
    assert len(rows) == 3


# ---------------------------------------------------------------------------
# Status transitions — atomicity is the load-bearing invariant
# ---------------------------------------------------------------------------


def test_mark_promoted_transitions_pending_to_promoted() -> None:
    """pending → promoted with reviewer audit fields stamped."""
    store = ParameterProposalStore(table=_FakeTable())
    p = _fresh_pending()
    store.put(p)
    promoted = store.mark_promoted(
        p.proposal_id,
        reviewed_at="2026-05-12T14:00:00+00:00",
        reviewed_by="admin@stocvest.app",
        promoted_to_version="1.1.0",
    )
    assert promoted.status == PROPOSAL_STATUS_PROMOTED
    assert promoted.reviewed_at == "2026-05-12T14:00:00+00:00"
    assert promoted.reviewed_by == "admin@stocvest.app"
    assert promoted.promoted_to_version == "1.1.0"
    # Promoted rows MUST NOT carry a TTL (they're the audit trail).
    assert promoted.ttl is None


def test_mark_rejected_transitions_pending_to_rejected_with_ttl() -> None:
    """pending → rejected stamps a TTL ~90 days out and preserves the review note."""
    store = ParameterProposalStore(table=_FakeTable())
    p = _fresh_pending()
    store.put(p)
    import time as _time

    before = int(_time.time())
    rejected = store.mark_rejected(
        p.proposal_id,
        reviewed_at="2026-05-12T14:00:00+00:00",
        reviewed_by="admin@stocvest.app",
        review_note="val regime mismatch — train was risk-on, val is risk-off",
    )
    after = int(_time.time())
    assert rejected.status == PROPOSAL_STATUS_REJECTED
    assert rejected.review_note == "val regime mismatch — train was risk-on, val is risk-off"
    assert rejected.ttl is not None
    # TTL should be ~PROPOSAL_TTL_DAYS days from now (allow generous slop for slow CI).
    expected_min = before + PROPOSAL_TTL_DAYS * 86400 - 5
    expected_max = after + PROPOSAL_TTL_DAYS * 86400 + 5
    assert expected_min <= rejected.ttl <= expected_max


def test_mark_superseded_transitions_pending_to_superseded_with_pointer() -> None:
    """pending → superseded carries a pointer back to the proposal that displaced it."""
    store = ParameterProposalStore(table=_FakeTable())
    p = _fresh_pending()
    store.put(p)
    superseded = store.mark_superseded(
        p.proposal_id,
        superseded_at="2026-05-19T03:00:00+00:00",
        superseded_by_proposal_id="prop-bbbbbbbb",
    )
    assert superseded.status == PROPOSAL_STATUS_SUPERSEDED
    assert superseded.reviewed_at == "2026-05-19T03:00:00+00:00"
    assert superseded.review_note == "superseded_by:prop-bbbbbbbb"
    assert superseded.ttl is not None


def test_cannot_promote_already_promoted_proposal() -> None:
    """A row already in `promoted` cannot be re-promoted (DDB ConditionalCheck)."""
    store = ParameterProposalStore(table=_FakeTable())
    p = _fresh_pending()
    store.put(p)
    store.mark_promoted(
        p.proposal_id,
        reviewed_at="2026-05-12T14:00:00+00:00",
        reviewed_by="admin@stocvest.app",
        promoted_to_version="1.1.0",
    )
    with pytest.raises(ValueError, match="not in status 'pending'"):
        store.mark_promoted(
            p.proposal_id,
            reviewed_at="2026-05-12T15:00:00+00:00",
            reviewed_by="other-admin@stocvest.app",
            promoted_to_version="1.2.0",
        )


def test_cannot_reject_already_rejected_proposal() -> None:
    """Symmetric — already-rejected proposals cannot be re-rejected."""
    store = ParameterProposalStore(table=_FakeTable())
    p = _fresh_pending()
    store.put(p)
    store.mark_rejected(
        p.proposal_id,
        reviewed_at="2026-05-12T14:00:00+00:00",
        reviewed_by="admin@stocvest.app",
    )
    with pytest.raises(ValueError, match="not in status 'pending'"):
        store.mark_rejected(
            p.proposal_id,
            reviewed_at="2026-05-12T15:00:00+00:00",
            reviewed_by="admin@stocvest.app",
        )


def test_cannot_promote_rejected_proposal() -> None:
    """The load-bearing atomicity guarantee — rejected cannot be promoted later."""
    store = ParameterProposalStore(table=_FakeTable())
    p = _fresh_pending()
    store.put(p)
    store.mark_rejected(
        p.proposal_id,
        reviewed_at="2026-05-12T14:00:00+00:00",
        reviewed_by="admin@stocvest.app",
    )
    with pytest.raises(ValueError, match="not in status 'pending'"):
        store.mark_promoted(
            p.proposal_id,
            reviewed_at="2026-05-12T15:00:00+00:00",
            reviewed_by="admin@stocvest.app",
            promoted_to_version="1.1.0",
        )


def test_cannot_transition_missing_proposal() -> None:
    """Transitioning a non-existent proposal raises ValueError, not silently no-ops."""
    store = ParameterProposalStore(table=_FakeTable())
    with pytest.raises(ValueError, match="not in status 'pending'"):
        store.mark_promoted(
            "does-not-exist",
            reviewed_at="2026-05-12T14:00:00+00:00",
            reviewed_by="admin@stocvest.app",
            promoted_to_version="1.1.0",
        )


# ---------------------------------------------------------------------------
# Closed-set invariants
# ---------------------------------------------------------------------------


def test_proposal_status_values_closed_set() -> None:
    """PROPOSAL_STATUS_VALUES is the canonical enumeration the tests / app rely on."""
    assert PROPOSAL_STATUS_VALUES == (
        PROPOSAL_STATUS_PENDING,
        PROPOSAL_STATUS_PROMOTED,
        PROPOSAL_STATUS_REJECTED,
        PROPOSAL_STATUS_SUPERSEDED,
    )


def test_proposal_ttl_days_documented_invariant() -> None:
    """TTL window is 90 days — documented as the Phase-1 default; tests fail if changed."""
    assert PROPOSAL_TTL_DAYS == 90
