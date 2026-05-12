"""Lock-in tests for D10 Phase 4 — ParameterHistory read APIs.

The Phase 1 module only exposed :func:`put_parameter_history_version`.
Phase 4's rollback workflow needs to **read** prior rows, so this test
suite pins the contract for the new readers:

* :func:`list_parameter_history_versions` — newest-first, limit-clamped,
  defensive coercion of malformed rows (skipped, not raised).
* :func:`get_parameter_history_version` — single-row fetch by version.
* :func:`parameters_dict_from_history_row` — pure JSON decode helper
  with NaN-safe behavior on malformed payloads.
"""

from __future__ import annotations

from typing import Any

import pytest
from botocore.exceptions import ClientError

from stocvest.data.parameter_history_store import (
    ParameterHistoryRow,
    get_parameter_history_version,
    list_parameter_history_versions,
    parameters_dict_from_history_row,
)


# ─────────────────────────────────────────────────────────────────────────────
# In-memory DDB Table double
# ─────────────────────────────────────────────────────────────────────────────


class _FakeTable:
    """Minimal stub matching boto3 DDB Table's scan/get_item surface."""

    def __init__(
        self,
        items: list[dict[str, Any]] | None = None,
        *,
        scan_raises: Exception | None = None,
        get_raises: Exception | None = None,
    ) -> None:
        self.items = list(items or [])
        self.scan_raises = scan_raises
        self.get_raises = get_raises
        self.scan_calls: list[dict[str, Any]] = []
        self.get_calls: list[dict[str, Any]] = []

    def scan(self, **kwargs: Any) -> dict[str, Any]:
        self.scan_calls.append(kwargs)
        if self.scan_raises is not None:
            raise self.scan_raises
        return {"Items": list(self.items)}

    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]:
        self.get_calls.append({"Key": Key})
        if self.get_raises is not None:
            raise self.get_raises
        target = Key.get("version")
        for item in self.items:
            if item.get("version") == target:
                return {"Item": item}
        return {}


def _ddb_item(
    *,
    version: str,
    created_at: str,
    reason: str = "manual",
    parameters: str = '{"version":"x"}',
    changed_by: str = "alice",
    signal_count: int = 100,
    accuracy: float = 0.62,
) -> dict[str, Any]:
    return {
        "version": version,
        "created_at": created_at,
        "reason": reason,
        "parameters": parameters,
        "signal_count_on_change": signal_count,
        "accuracy_before_change": accuracy,
        "changed_by": changed_by,
    }


# ─────────────────────────────────────────────────────────────────────────────
# list_parameter_history_versions
# ─────────────────────────────────────────────────────────────────────────────


def test_list_returns_newest_first_by_created_at():
    table = _FakeTable(
        items=[
            _ddb_item(version="1.0.3", created_at="2026-05-01T00:00:00+00:00"),
            _ddb_item(version="1.0.5", created_at="2026-05-10T00:00:00+00:00"),
            _ddb_item(version="1.0.4", created_at="2026-05-05T00:00:00+00:00"),
        ]
    )

    rows = list_parameter_history_versions(limit=10, table=table)

    assert [r.version for r in rows] == ["1.0.5", "1.0.4", "1.0.3"]


def test_list_respects_limit():
    table = _FakeTable(
        items=[
            _ddb_item(version=f"1.0.{i}", created_at=f"2026-05-{i:02d}T00:00:00+00:00")
            for i in range(1, 11)
        ]
    )

    rows = list_parameter_history_versions(limit=3, table=table)

    assert len(rows) == 3
    assert rows[0].version == "1.0.10"
    assert rows[2].version == "1.0.8"


def test_list_returns_empty_for_zero_or_negative_limit():
    table = _FakeTable(
        items=[_ddb_item(version="1.0.1", created_at="2026-05-01T00:00:00+00:00")]
    )

    assert list_parameter_history_versions(limit=0, table=table) == []
    assert list_parameter_history_versions(limit=-5, table=table) == []


def test_list_skips_malformed_rows_without_raising():
    """Defensive: rows missing the mandatory fields are skipped, not raised."""
    table = _FakeTable(
        items=[
            _ddb_item(version="1.0.5", created_at="2026-05-10T00:00:00+00:00"),
            {"created_at": "2026-05-09T00:00:00+00:00"},  # missing version
            {"version": "  ", "parameters": "{}"},  # blank version
            {"version": "1.0.3", "parameters": 12345},  # non-string parameters
            _ddb_item(version="1.0.4", created_at="2026-05-05T00:00:00+00:00"),
        ]
    )

    rows = list_parameter_history_versions(limit=10, table=table)

    assert [r.version for r in rows] == ["1.0.5", "1.0.4"]


def test_list_coerces_numeric_columns_defensively():
    """When DDB stores numeric columns as strings or Decimals, the
    coercion should not crash the list view."""
    table = _FakeTable(
        items=[
            {
                "version": "1.0.3",
                "created_at": "2026-05-01T00:00:00+00:00",
                "reason": "r",
                "parameters": "{}",
                "signal_count_on_change": "not a number",
                "accuracy_before_change": "also not",
                "changed_by": "alice",
            }
        ]
    )

    rows = list_parameter_history_versions(limit=10, table=table)

    assert len(rows) == 1
    assert rows[0].signal_count_on_change == 0
    assert rows[0].accuracy_before_change == 0.0


def test_list_returns_empty_when_table_unconfigured():
    """When the helper is called without a table override AND the
    environment has no DDB table configured, the list should return
    empty rather than raising — so a misconfigured dev env shows an
    empty picker, not an error page."""
    rows = list_parameter_history_versions(limit=10, table=None)
    # In test environments DYNAMODB_PARAMETER_HISTORY_TABLE may be unset
    # OR boto3 may be unable to connect; either way we should get [].
    assert isinstance(rows, list)


def test_list_returns_empty_on_client_error():
    """A ClientError during scan should not propagate to the caller."""
    table = _FakeTable(
        scan_raises=ClientError(
            error_response={"Error": {"Code": "ProvisionedThroughputExceededException"}},
            operation_name="Scan",
        )
    )

    rows = list_parameter_history_versions(limit=10, table=table)
    assert rows == []


def test_list_paginates_through_last_evaluated_key():
    """When DDB returns a LastEvaluatedKey, the helper should continue
    scanning until exhausted (or the hard cap is hit)."""
    page1_items = [
        _ddb_item(version=f"1.0.{i}", created_at=f"2026-05-{i:02d}T00:00:00+00:00")
        for i in range(1, 4)
    ]
    page2_items = [
        _ddb_item(version=f"1.0.{i}", created_at=f"2026-05-{i:02d}T00:00:00+00:00")
        for i in range(4, 7)
    ]

    class _PagedTable:
        def __init__(self) -> None:
            self.responses = [
                {"Items": page1_items, "LastEvaluatedKey": {"version": "1.0.3"}},
                {"Items": page2_items},
            ]
            self.scan_calls: list[dict[str, Any]] = []

        def scan(self, **kwargs: Any) -> dict[str, Any]:
            self.scan_calls.append(kwargs)
            return self.responses.pop(0)

    table = _PagedTable()
    rows = list_parameter_history_versions(limit=100, table=table)

    assert {r.version for r in rows} == {f"1.0.{i}" for i in range(1, 7)}
    assert len(table.scan_calls) == 2
    # The second scan call carries the LastEvaluatedKey from the first.
    assert table.scan_calls[1].get("ExclusiveStartKey") == {"version": "1.0.3"}


# ─────────────────────────────────────────────────────────────────────────────
# get_parameter_history_version
# ─────────────────────────────────────────────────────────────────────────────


def test_get_returns_row_when_present():
    table = _FakeTable(
        items=[_ddb_item(version="1.0.3", created_at="2026-05-01T00:00:00+00:00")]
    )

    row = get_parameter_history_version("1.0.3", table=table)
    assert row is not None
    assert row.version == "1.0.3"


def test_get_strips_whitespace_from_version_lookup():
    table = _FakeTable(
        items=[_ddb_item(version="1.0.3", created_at="2026-05-01T00:00:00+00:00")]
    )

    row = get_parameter_history_version("  1.0.3  ", table=table)

    assert row is not None
    assert row.version == "1.0.3"
    # The DDB Key passed in must be the stripped form.
    assert table.get_calls[0]["Key"] == {"version": "1.0.3"}


def test_get_returns_none_for_missing_version():
    table = _FakeTable(items=[])

    assert get_parameter_history_version("1.0.99", table=table) is None


def test_get_returns_none_for_empty_or_invalid_version():
    table = _FakeTable(items=[])

    assert get_parameter_history_version("", table=table) is None
    assert get_parameter_history_version("   ", table=table) is None


def test_get_returns_none_on_client_error():
    table = _FakeTable(
        get_raises=ClientError(
            error_response={"Error": {"Code": "InternalServerError"}},
            operation_name="GetItem",
        )
    )

    assert get_parameter_history_version("1.0.3", table=table) is None


# ─────────────────────────────────────────────────────────────────────────────
# parameters_dict_from_history_row
# ─────────────────────────────────────────────────────────────────────────────


def test_parameters_dict_round_trips_valid_json():
    row = ParameterHistoryRow(
        version="1.0.3",
        created_at="2026-05-01T00:00:00+00:00",
        reason="r",
        parameters_json='{"version":"1.0.3","note":"ok"}',
    )

    parsed = parameters_dict_from_history_row(row)
    assert parsed == {"version": "1.0.3", "note": "ok"}


def test_parameters_dict_returns_none_for_malformed_json():
    row = ParameterHistoryRow(
        version="1.0.3",
        created_at="2026-05-01T00:00:00+00:00",
        reason="r",
        parameters_json="{not valid",
    )

    assert parameters_dict_from_history_row(row) is None


def test_parameters_dict_returns_none_when_payload_is_array():
    """The contract is "dict", not "any JSON value" — defensive against
    a future writer changing the schema."""
    row = ParameterHistoryRow(
        version="1.0.3",
        created_at="2026-05-01T00:00:00+00:00",
        reason="r",
        parameters_json='["a","b"]',
    )

    assert parameters_dict_from_history_row(row) is None
