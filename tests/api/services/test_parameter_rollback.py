"""Lock-in tests for D10 Phase 4 — parameter rollback orchestrator.

Rollback is the second production code path (alongside Phase 3a's
promote) that mutates the live ``stocvest/signal-parameters`` secret
under admin authority. These tests pin the rules that protect against
silent rotation bugs:

* Every successful rollback **forward-writes** a new
  ``ParameterHistory`` row whose ``parameters_json`` payload happens
  to equal the target row — never reuses a prior version number.
* Rolling back to the currently-live version is rejected with
  ``error="already on target version"`` so admins can't accidentally
  produce a duplicate audit row.
* Malformed history rows surface as ``error="invalid history row"``
  rather than crashing the handler.
* Missing ``target_version`` short-circuits before touching the secret.
* The ``changed_by`` audit string is prefixed with ``d10-rollback:`` so
  the audit trail makes rollback intent explicit.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from stocvest.api.services.parameter_rollback import (
    ParameterHistorySummaryRow,
    RollbackResult,
    history_row_to_summary,
    list_history_with_live_marker,
    rollback_to_version,
)
from stocvest.config.parameter_store import ParameterStore
from stocvest.config.signal_parameters import (
    SignalParameters,
    default_signal_parameters,
    signal_parameters_to_dict,
)
from stocvest.data.parameter_history_store import ParameterHistoryRow


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _serialize_params(params: SignalParameters) -> str:
    """Same serialization used by ParameterStore.save_parameters_sync."""
    import json

    return json.dumps(signal_parameters_to_dict(params), separators=(",", ":"))


def _history_row(
    *,
    version: str,
    params: SignalParameters | None = None,
    reason: str = "manual rotation",
    changed_by: str = "d10-admin:alice",
    created_at: str = "2026-05-01T00:00:00+00:00",
) -> ParameterHistoryRow:
    if params is None:
        params = default_signal_parameters()
        params.version = version
    return ParameterHistoryRow(
        version=version,
        created_at=created_at,
        reason=reason,
        parameters_json=_serialize_params(params),
        signal_count_on_change=100,
        accuracy_before_change=0.62,
        changed_by=changed_by,
    )


class _FakeParameterStore:
    """Test double for ParameterStore — captures save calls.

    Imitates the class-level interface of the real ParameterStore so
    callers can pass ``parameter_store=FakeParameterStore`` (a class
    reference, not an instance) just like the real one.
    """

    saved: list[dict[str, Any]] = []
    save_return: bool = True
    current_version: str = "1.0.5"

    @classmethod
    def get_parameters_sync(cls) -> SignalParameters:
        params = default_signal_parameters()
        params.version = cls.current_version
        return params

    @classmethod
    def save_parameters_sync(
        cls,
        params: SignalParameters,
        reason: str,
        *,
        signal_count_on_change: int | None = None,
        accuracy_before_change: float | None = None,
        changed_by: str = "stocvest-admin",
    ) -> bool:
        cls.saved.append(
            {
                "params": params,
                "reason": reason,
                "changed_by": changed_by,
                "signal_count_on_change": signal_count_on_change,
                "accuracy_before_change": accuracy_before_change,
            }
        )
        if cls.save_return:
            # Simulate the real method's version bump.
            params.version = "1.0.6"
        return cls.save_return


@pytest.fixture(autouse=True)
def _reset_fake_store() -> None:
    _FakeParameterStore.saved = []
    _FakeParameterStore.save_return = True
    _FakeParameterStore.current_version = "1.0.5"


# ─────────────────────────────────────────────────────────────────────────────
# history_row_to_summary
# ─────────────────────────────────────────────────────────────────────────────


def test_history_row_to_summary_flags_live_version_when_match():
    row = _history_row(version="1.0.5")
    summary = history_row_to_summary(row, current_live_version="1.0.5")
    assert summary.is_current_live_version is True


def test_history_row_to_summary_does_not_flag_non_live_version():
    row = _history_row(version="1.0.3")
    summary = history_row_to_summary(row, current_live_version="1.0.5")
    assert summary.is_current_live_version is False


def test_history_row_to_summary_handles_none_live_version_safely():
    row = _history_row(version="1.0.3")
    summary = history_row_to_summary(row, current_live_version=None)
    assert summary.is_current_live_version is False


def test_history_row_to_summary_to_dict_carries_audit_columns():
    row = _history_row(version="1.0.3", changed_by="d10-admin:alice")
    summary = history_row_to_summary(row, current_live_version="1.0.5")
    payload = summary.to_dict()
    assert payload["version"] == "1.0.3"
    assert payload["changed_by"] == "d10-admin:alice"
    assert payload["signal_count_on_change"] == 100
    assert payload["accuracy_before_change"] == 0.62
    assert payload["is_current_live_version"] is False


# ─────────────────────────────────────────────────────────────────────────────
# rollback_to_version — failure modes
# ─────────────────────────────────────────────────────────────────────────────


def test_rollback_rejects_empty_target_version():
    result = rollback_to_version(
        "",
        reviewed_by="alice",
        parameter_store=_FakeParameterStore,
    )
    assert result.success is False
    assert result.error == "target_version is required"
    assert _FakeParameterStore.saved == []


def test_rollback_rejects_whitespace_target_version():
    result = rollback_to_version(
        "   ",
        reviewed_by="alice",
        parameter_store=_FakeParameterStore,
    )
    assert result.success is False
    assert result.error == "target_version is required"
    assert _FakeParameterStore.saved == []


def test_rollback_returns_not_found_when_history_missing():
    with patch(
        "stocvest.api.services.parameter_rollback.get_parameter_history_version",
        return_value=None,
    ):
        result = rollback_to_version(
            "1.0.3",
            reviewed_by="alice",
            parameter_store=_FakeParameterStore,
        )
    assert result.success is False
    assert result.error == "not found"
    assert result.target_version == "1.0.3"
    assert _FakeParameterStore.saved == []


def test_rollback_returns_invalid_when_parameters_json_unparseable():
    bad_row = ParameterHistoryRow(
        version="1.0.3",
        created_at="2026-05-01T00:00:00+00:00",
        reason="bad row",
        parameters_json="{not valid json",  # intentional malformed JSON
        signal_count_on_change=0,
        accuracy_before_change=0.0,
        changed_by="x",
    )
    with patch(
        "stocvest.api.services.parameter_rollback.get_parameter_history_version",
        return_value=bad_row,
    ):
        result = rollback_to_version(
            "1.0.3",
            reviewed_by="alice",
            parameter_store=_FakeParameterStore,
        )
    assert result.success is False
    assert result.error == "invalid history row"
    assert _FakeParameterStore.saved == []


def test_rollback_rejects_when_target_is_current_live_version():
    row = _history_row(version="1.0.5")  # same as fake store current
    with patch(
        "stocvest.api.services.parameter_rollback.get_parameter_history_version",
        return_value=row,
    ):
        result = rollback_to_version(
            "1.0.5",
            reviewed_by="alice",
            parameter_store=_FakeParameterStore,
        )
    assert result.success is False
    assert result.error == "already on target version"
    assert result.rolled_back_from == "1.0.5"
    assert _FakeParameterStore.saved == []


def test_rollback_returns_save_failed_when_secret_write_fails():
    row = _history_row(version="1.0.3")
    _FakeParameterStore.save_return = False
    with patch(
        "stocvest.api.services.parameter_rollback.get_parameter_history_version",
        return_value=row,
    ):
        result = rollback_to_version(
            "1.0.3",
            reviewed_by="alice",
            parameter_store=_FakeParameterStore,
        )
    assert result.success is False
    assert result.error == "parameter save failed"
    assert result.rolled_back_from == "1.0.5"
    # The save attempt WAS made — load-bearing for distinguishing
    # "didn't try" (no save call) from "tried, secret refused" (1 call).
    assert len(_FakeParameterStore.saved) == 1


# ─────────────────────────────────────────────────────────────────────────────
# rollback_to_version — happy path + audit invariants
# ─────────────────────────────────────────────────────────────────────────────


def test_rollback_happy_path_calls_save_with_reconstructed_params():
    """Rollback must reconstruct SignalParameters from the history row's JSON
    and pass it through save_parameters_sync verbatim."""
    target = default_signal_parameters()
    target.version = "1.0.3"
    target.composite.technical_weight = 0.55  # marker so we can assert it round-trips
    row = _history_row(version="1.0.3", params=target)

    with patch(
        "stocvest.api.services.parameter_rollback.get_parameter_history_version",
        return_value=row,
    ):
        result = rollback_to_version(
            "1.0.3",
            reviewed_by="alice",
            parameter_store=_FakeParameterStore,
        )

    assert result.success is True
    assert result.rolled_back_from == "1.0.5"
    assert result.new_parameter_version == "1.0.6"  # fake store bumps 1.0.5 → 1.0.6
    assert result.target_version == "1.0.3"
    assert len(_FakeParameterStore.saved) == 1

    saved = _FakeParameterStore.saved[0]
    # Round-trip preserved the technical_weight marker.
    assert saved["params"].composite.technical_weight == pytest.approx(0.55)


def test_rollback_changed_by_audit_prefix_is_d10_rollback():
    """Lock-in: rollback rotations are tagged ``d10-rollback:<reviewer>``
    in ParameterHistory's changed_by column so audit log analytics can
    distinguish a rollback from a forward promotion (which uses
    ``d10-admin:<reviewer>``)."""
    target = default_signal_parameters()
    target.version = "1.0.3"
    row = _history_row(version="1.0.3", params=target)

    with patch(
        "stocvest.api.services.parameter_rollback.get_parameter_history_version",
        return_value=row,
    ):
        rollback_to_version(
            "1.0.3",
            reviewed_by="alice@example.com",
            parameter_store=_FakeParameterStore,
        )

    saved = _FakeParameterStore.saved[0]
    assert saved["changed_by"] == "d10-rollback:alice@example.com"


def test_rollback_reason_mentions_from_to_and_reviewer_for_audit_traceability():
    """The reason string is what shows up in ParameterHistory's reason
    column. Lock-in: it carries the rollback shape so a future audit
    grep on `D10 rollback` finds every rollback."""
    target = default_signal_parameters()
    target.version = "1.0.3"
    row = _history_row(version="1.0.3", params=target, reason="prior tuning iter")

    with patch(
        "stocvest.api.services.parameter_rollback.get_parameter_history_version",
        return_value=row,
    ):
        rollback_to_version(
            "1.0.3",
            reviewed_by="alice",
            parameter_store=_FakeParameterStore,
        )

    reason = _FakeParameterStore.saved[0]["reason"]
    assert "D10 rollback" in reason
    assert "v1.0.5" in reason  # rolled-back-from
    assert "v1.0.3" in reason  # target
    assert "alice" in reason


def test_rollback_result_to_dict_carries_full_payload():
    target = default_signal_parameters()
    target.version = "1.0.3"
    row = _history_row(version="1.0.3", params=target, reason="prior tuning iter")

    with patch(
        "stocvest.api.services.parameter_rollback.get_parameter_history_version",
        return_value=row,
    ):
        result = rollback_to_version(
            "1.0.3",
            reviewed_by="alice",
            parameter_store=_FakeParameterStore,
        )

    payload = result.to_dict()
    assert payload["success"] is True
    assert payload["target_version"] == "1.0.3"
    assert payload["rolled_back_from"] == "1.0.5"
    assert payload["new_parameter_version"] == "1.0.6"
    assert payload["error"] is None
    assert payload["extras"]["target_reason"] == "prior tuning iter"


# ─────────────────────────────────────────────────────────────────────────────
# list_history_with_live_marker
# ─────────────────────────────────────────────────────────────────────────────


def test_list_history_marks_live_row_exactly_once():
    rows = [
        _history_row(version="1.0.5"),  # current live
        _history_row(version="1.0.4"),
        _history_row(version="1.0.3"),
    ]
    with patch(
        "stocvest.api.services.parameter_rollback.list_parameter_history_versions",
        return_value=rows,
    ):
        items = list_history_with_live_marker(
            limit=10,
            parameter_store=_FakeParameterStore,
        )

    assert len(items) == 3
    live_flags = [r.is_current_live_version for r in items]
    assert live_flags == [True, False, False]


def test_list_history_marks_nothing_live_when_current_not_in_history():
    """Defensive: if the live version doesn't appear in ParameterHistory
    (e.g. table was just bootstrapped), the picker UI should not be
    able to confuse any prior row with the live one."""
    rows = [_history_row(version="1.0.4"), _history_row(version="1.0.3")]
    with patch(
        "stocvest.api.services.parameter_rollback.list_parameter_history_versions",
        return_value=rows,
    ):
        items = list_history_with_live_marker(
            limit=10,
            parameter_store=_FakeParameterStore,
        )

    assert all(r.is_current_live_version is False for r in items)


def test_list_history_returns_empty_when_store_returns_empty():
    with patch(
        "stocvest.api.services.parameter_rollback.list_parameter_history_versions",
        return_value=[],
    ):
        items = list_history_with_live_marker(
            limit=10,
            parameter_store=_FakeParameterStore,
        )
    assert items == []
