"""
Tests for ``stocvest.api.services.historical_validation_service``.

These lock in the Phase 2 service-layer contract that Phase 3 (API + UI) will sit on top of:

- The service queries the underlying store using its trailing-N-day convention but then
  post-filters to an absolute ``[from_at, to_at)`` window. Lower bound inclusive, upper
  bound exclusive — same semantics as the GSI ``scope_generated_at`` predicate.
- ``user_id`` / ``symbol`` / ``mode`` pass straight through to the store.
- ``horizon`` flows through to the Phase 1 aggregator.
- ``summarize_by_parameter_version`` produces one bucket per ``parameter_version`` plus an
  ``__all__`` bucket for the combined aggregate. Rows missing a version land in
  ``unknown`` and are never silently dropped.
- Empty windows return an empty summary cleanly without touching the store.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.api.services.historical_validation_service import (
    ALL_VERSIONS_KEY,
    UNKNOWN_VERSION_KEY,
    HistoricalValidationService,
)
from stocvest.data.models import SignalRecord


# ─────────────────────────────────────────────────────────────────────────────
# Test fixtures
# ─────────────────────────────────────────────────────────────────────────────


def _signal(
    *,
    signal_id: str = "sig-1",
    symbol: str = "TEST",
    direction: str = "bullish",
    signal_strength: int = 75,
    pattern: str = "swing_composite",
    mode: str = "swing",
    decision_state_entry: str | None = "actionable",
    regime_label_at_entry: str | None = "risk_on",
    outcome_1h: str | None = None,
    outcome_1d: str | None = None,
    parameter_version: str | None = "v1",
    generated_at: datetime | None = None,
) -> SignalRecord:
    """Build a minimally-valid ``SignalRecord`` for tests.

    Mirrors the fixture used in `tests/signals/test_historical_validation.py` so the two
    test suites describe the same shape from opposite ends of the seam.
    """

    return SignalRecord(
        signal_id=signal_id,
        symbol=symbol,
        direction=direction,
        signal_strength=signal_strength,
        pattern=pattern,
        layer_scores={},
        price_at_signal=100.0,
        generated_at=generated_at or datetime(2026, 5, 10, 14, 30, tzinfo=timezone.utc),
        outcome_1h=outcome_1h,
        outcome_1d=outcome_1d,
        mode=mode,
        decision_state_entry=decision_state_entry,
        regime_label_at_entry=regime_label_at_entry,
        parameter_version=parameter_version,
    )


class _StubStore:
    """In-memory ``SignalHistoryReader`` double.

    Records every call so tests can assert the service forwarded ``user_id`` / ``symbol`` /
    ``mode`` correctly, and so we can check the computed ``days_back`` matches the window.
    """

    def __init__(self, rows: list[SignalRecord] | None = None) -> None:
        self.rows = list(rows or [])
        self.calls: list[dict[str, Any]] = []

    def get_signal_history(
        self,
        *,
        user_id: str | None = None,
        symbol: str | None = None,
        days: int = 30,
        limit: int = 100,
        mode: str | None = None,
        ledger_qualified_only: bool = False,
    ) -> list[SignalRecord]:
        self.calls.append(
            {
                "user_id": user_id,
                "symbol": symbol,
                "days": days,
                "limit": limit,
                "mode": mode,
                "ledger_qualified_only": ledger_qualified_only,
            }
        )
        return list(self.rows)


# ─────────────────────────────────────────────────────────────────────────────
# summarize(): empty / boundary windows
# ─────────────────────────────────────────────────────────────────────────────


def test_summarize_empty_store_returns_nan_accuracy() -> None:
    """Window is fine, but the store has no rows → NaN accuracy (UI renders "—")."""

    store = _StubStore(rows=[])
    service = HistoricalValidationService(store)

    summary = service.summarize(
        user_id=None,
        from_at=datetime(2026, 4, 1, tzinfo=timezone.utc),
        to_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        horizon="1h",
    )

    assert summary.overall.total_signals == 0
    assert math.isnan(summary.overall.accuracy)
    assert summary.parameter_versions == ()
    assert len(store.calls) == 1


def test_summarize_inverted_window_short_circuits_without_hitting_store() -> None:
    """``to_at <= from_at`` is caller error; we return an empty summary without I/O."""

    store = _StubStore(rows=[_signal(outcome_1h="correct")])
    service = HistoricalValidationService(store)

    summary = service.summarize(
        user_id="abc",
        from_at=datetime(2026, 5, 10, tzinfo=timezone.utc),
        to_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        horizon="1h",
    )

    assert summary.overall.total_signals == 0
    assert math.isnan(summary.overall.accuracy)
    assert store.calls == []


def test_summarize_equal_bounds_returns_empty_without_hitting_store() -> None:
    """Upper bound is exclusive — equal bounds means a zero-width window."""

    store = _StubStore(rows=[_signal(outcome_1h="correct")])
    service = HistoricalValidationService(store)

    instant = datetime(2026, 5, 10, tzinfo=timezone.utc)
    summary = service.summarize(
        user_id=None,
        from_at=instant,
        to_at=instant,
        horizon="1h",
    )

    assert summary.overall.total_signals == 0
    assert store.calls == []


# ─────────────────────────────────────────────────────────────────────────────
# summarize(): happy path + window filtering
# ─────────────────────────────────────────────────────────────────────────────


def test_summarize_aggregates_correct_incorrect_and_excludes_neutral_from_denominator() -> None:
    """Sanity check that the Phase 1 contract flows through unchanged: 2 correct + 1 incorrect
    in a window of three rows → 66.7% accuracy; neutrals are out of the denominator."""

    base = datetime(2026, 5, 5, 14, 0, tzinfo=timezone.utc)
    rows = [
        _signal(signal_id="a", outcome_1h="correct", generated_at=base),
        _signal(signal_id="b", outcome_1h="correct", generated_at=base + timedelta(hours=1)),
        _signal(signal_id="c", outcome_1h="incorrect", generated_at=base + timedelta(hours=2)),
        _signal(signal_id="d", outcome_1h="neutral", generated_at=base + timedelta(hours=3)),
    ]
    store = _StubStore(rows=rows)
    service = HistoricalValidationService(store)

    summary = service.summarize(
        user_id=None,
        from_at=base - timedelta(hours=1),
        to_at=base + timedelta(hours=24),
        horizon="1h",
    )

    assert summary.overall.total_signals == 4
    assert summary.overall.correct == 2
    assert summary.overall.incorrect == 1
    assert summary.overall.neutral == 1
    # 2 / (2 + 1) == 0.666… — Phase 1 returns the ratio, not a percent.
    assert summary.overall.accuracy == 2 / 3


def test_summarize_filters_to_inclusive_lower_exclusive_upper_window() -> None:
    """The store returns five rows spanning the bound edges; the service keeps only the
    three rows inside ``[from_at, to_at)``.

    - row "before" sits strictly before ``from_at`` → dropped
    - row "on_lower" sits exactly at ``from_at`` → kept (inclusive)
    - row "inside" sits inside the window → kept
    - row "on_upper" sits exactly at ``to_at`` → dropped (exclusive)
    - row "after" sits strictly after ``to_at`` → dropped
    """

    from_at = datetime(2026, 5, 1, 0, 0, tzinfo=timezone.utc)
    to_at = datetime(2026, 5, 10, 0, 0, tzinfo=timezone.utc)
    rows = [
        _signal(signal_id="before", outcome_1h="correct", generated_at=from_at - timedelta(seconds=1)),
        _signal(signal_id="on_lower", outcome_1h="correct", generated_at=from_at),
        _signal(signal_id="inside", outcome_1h="correct", generated_at=from_at + timedelta(days=2)),
        _signal(signal_id="on_upper", outcome_1h="incorrect", generated_at=to_at),
        _signal(signal_id="after", outcome_1h="incorrect", generated_at=to_at + timedelta(seconds=1)),
    ]
    store = _StubStore(rows=rows)
    service = HistoricalValidationService(store)

    summary = service.summarize(
        user_id=None,
        from_at=from_at,
        to_at=to_at,
        horizon="1h",
    )

    # Two correct rows kept (on_lower, inside); on_upper / after / before are dropped.
    assert summary.overall.total_signals == 2
    assert summary.overall.correct == 2
    assert summary.overall.incorrect == 0


def test_summarize_treats_naive_record_generated_at_as_utc() -> None:
    """Old DynamoDB rows occasionally hydrate naive — the service should not crash and
    should treat them as UTC for comparison purposes."""

    from_at = datetime(2026, 5, 1, 0, 0, tzinfo=timezone.utc)
    to_at = datetime(2026, 5, 10, 0, 0, tzinfo=timezone.utc)
    naive_inside = datetime(2026, 5, 5, 0, 0)  # naive, but logically UTC and inside window
    rows = [_signal(signal_id="naive", outcome_1h="correct", generated_at=naive_inside)]
    store = _StubStore(rows=rows)
    service = HistoricalValidationService(store)

    summary = service.summarize(
        user_id=None,
        from_at=from_at,
        to_at=to_at,
        horizon="1h",
    )

    assert summary.overall.correct == 1


# ─────────────────────────────────────────────────────────────────────────────
# summarize(): parameter passthrough
# ─────────────────────────────────────────────────────────────────────────────


def test_summarize_passes_user_id_symbol_and_mode_through_to_store() -> None:
    """The store is the auth perimeter — the service must not silently change scope."""

    store = _StubStore(rows=[])
    service = HistoricalValidationService(store)

    service.summarize(
        user_id="user-123",
        from_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        to_at=datetime(2026, 5, 10, tzinfo=timezone.utc),
        horizon="1h",
        mode="swing",
        symbol="AAPL",
    )

    assert len(store.calls) == 1
    call = store.calls[0]
    assert call["user_id"] == "user-123"
    assert call["symbol"] == "AAPL"
    assert call["mode"] == "swing"
    # Validation is read-only; we look at every row in the window, qualified or not.
    assert call["ledger_qualified_only"] is False


def test_summarize_computes_days_back_to_cover_from_at() -> None:
    """The store API takes a trailing-day count, so the service must pad ``days`` to cover
    the absolute ``from_at`` boundary."""

    store = _StubStore(rows=[])
    service = HistoricalValidationService(store)

    now = datetime.now(timezone.utc)
    service.summarize(
        user_id=None,
        from_at=now - timedelta(days=14),
        to_at=now,
        horizon="1h",
    )

    assert len(store.calls) == 1
    # Lower bound is now-14d; service should ask for at least 14 days back. The +1 pad
    # accounts for microsecond / ISO truncation in the underlying GSI query.
    assert store.calls[0]["days"] in (14, 15)


def test_summarize_clamps_days_back_at_max_lookback() -> None:
    """A pathological 10-year window must not stream every row in the table."""

    from stocvest.api.services.historical_validation_service import MAX_LOOKBACK_DAYS

    store = _StubStore(rows=[])
    service = HistoricalValidationService(store)

    service.summarize(
        user_id=None,
        from_at=datetime(2010, 1, 1, tzinfo=timezone.utc),
        to_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        horizon="1h",
    )

    assert store.calls[0]["days"] == MAX_LOOKBACK_DAYS


# ─────────────────────────────────────────────────────────────────────────────
# summarize(): horizon routing
# ─────────────────────────────────────────────────────────────────────────────


def test_summarize_horizon_1d_reads_outcome_1d_not_outcome_1h() -> None:
    """``horizon`` flows through to the Phase 1 aggregator: a row with ``outcome_1h``
    populated but ``outcome_1d`` still pending counts as zero at horizon ``1d``."""

    base = datetime(2026, 5, 5, tzinfo=timezone.utc)
    rows = [
        _signal(
            signal_id="x",
            outcome_1h="correct",  # 1h is resolved
            outcome_1d=None,  # 1d still pending
            generated_at=base,
        ),
    ]
    store = _StubStore(rows=rows)
    service = HistoricalValidationService(store)

    s1h = service.summarize(
        user_id=None,
        from_at=base - timedelta(days=1),
        to_at=base + timedelta(days=1),
        horizon="1h",
    )
    s1d = service.summarize(
        user_id=None,
        from_at=base - timedelta(days=1),
        to_at=base + timedelta(days=1),
        horizon="1d",
    )

    assert s1h.horizon == "1h"
    assert s1h.overall.total_signals == 1
    assert s1h.overall.correct == 1

    assert s1d.horizon == "1d"
    # Row exists in the window but has no 1d outcome → zero in the 1d denominator.
    assert s1d.overall.total_signals == 0
    assert math.isnan(s1d.overall.accuracy)
    # rows_examined still sees the row — useful for "X resolved of Y" UI copy.
    assert s1d.rows_examined == 1


# ─────────────────────────────────────────────────────────────────────────────
# summarize_by_parameter_version()
# ─────────────────────────────────────────────────────────────────────────────


def test_summarize_by_parameter_version_buckets_each_version_plus_all() -> None:
    """v1 (2/2 correct) and v2 (1 correct, 1 incorrect) get their own summaries, and an
    ``__all__`` bucket carries the combined 3/4 cross-version aggregate."""

    base = datetime(2026, 5, 5, tzinfo=timezone.utc)
    rows = [
        _signal(signal_id="a", outcome_1h="correct", parameter_version="v1", generated_at=base),
        _signal(
            signal_id="b",
            outcome_1h="correct",
            parameter_version="v1",
            generated_at=base + timedelta(hours=1),
        ),
        _signal(
            signal_id="c",
            outcome_1h="correct",
            parameter_version="v2",
            generated_at=base + timedelta(hours=2),
        ),
        _signal(
            signal_id="d",
            outcome_1h="incorrect",
            parameter_version="v2",
            generated_at=base + timedelta(hours=3),
        ),
    ]
    store = _StubStore(rows=rows)
    service = HistoricalValidationService(store)

    result = service.summarize_by_parameter_version(
        user_id=None,
        from_at=base - timedelta(days=1),
        to_at=base + timedelta(days=1),
        horizon="1h",
    )

    assert set(result.keys()) == {ALL_VERSIONS_KEY, "v1", "v2"}

    # v1: two correct, zero incorrect → 100%.
    assert result["v1"].overall.correct == 2
    assert result["v1"].overall.incorrect == 0
    assert result["v1"].overall.accuracy == 1.0

    # v2: one correct, one incorrect → 50%.
    assert result["v2"].overall.correct == 1
    assert result["v2"].overall.incorrect == 1
    assert result["v2"].overall.accuracy == 0.5

    # __all__: combined 3/4 → 75%, and parameter_versions sees both.
    all_bucket = result[ALL_VERSIONS_KEY]
    assert all_bucket.overall.correct == 3
    assert all_bucket.overall.incorrect == 1
    assert all_bucket.overall.accuracy == 0.75
    assert all_bucket.parameter_versions == ("v1", "v2")


def test_summarize_by_parameter_version_buckets_missing_version_as_unknown() -> None:
    """Legacy rows (no ``parameter_version``) land in ``unknown`` rather than vanishing."""

    base = datetime(2026, 5, 5, tzinfo=timezone.utc)
    rows = [
        _signal(signal_id="legacy", outcome_1h="correct", parameter_version=None, generated_at=base),
        _signal(
            signal_id="blank",
            outcome_1h="incorrect",
            parameter_version="   ",
            generated_at=base + timedelta(hours=1),
        ),
        _signal(
            signal_id="modern",
            outcome_1h="correct",
            parameter_version="v3",
            generated_at=base + timedelta(hours=2),
        ),
    ]
    store = _StubStore(rows=rows)
    service = HistoricalValidationService(store)

    result = service.summarize_by_parameter_version(
        user_id=None,
        from_at=base - timedelta(days=1),
        to_at=base + timedelta(days=1),
        horizon="1h",
    )

    assert set(result.keys()) == {ALL_VERSIONS_KEY, UNKNOWN_VERSION_KEY, "v3"}
    # legacy + blank-string version → 1 correct, 1 incorrect in the unknown bucket.
    assert result[UNKNOWN_VERSION_KEY].overall.correct == 1
    assert result[UNKNOWN_VERSION_KEY].overall.incorrect == 1
    assert result["v3"].overall.correct == 1


def test_summarize_by_parameter_version_empty_window_returns_only_all_bucket() -> None:
    """No rows in window → ``__all__`` is the only bucket, holds an empty summary."""

    store = _StubStore(rows=[])
    service = HistoricalValidationService(store)

    result = service.summarize_by_parameter_version(
        user_id=None,
        from_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        to_at=datetime(2026, 5, 10, tzinfo=timezone.utc),
        horizon="1h",
    )

    assert set(result.keys()) == {ALL_VERSIONS_KEY}
    assert result[ALL_VERSIONS_KEY].overall.total_signals == 0
    assert math.isnan(result[ALL_VERSIONS_KEY].overall.accuracy)


def test_summarize_by_parameter_version_only_counts_in_window_rows() -> None:
    """Window filter is applied before the version split: out-of-window v1 rows must not
    inflate the v1 bucket."""

    base = datetime(2026, 5, 5, tzinfo=timezone.utc)
    from_at = base
    to_at = base + timedelta(days=1)
    rows = [
        _signal(
            signal_id="v1_in",
            outcome_1h="correct",
            parameter_version="v1",
            generated_at=base + timedelta(hours=1),
        ),
        _signal(
            signal_id="v1_out",
            outcome_1h="correct",
            parameter_version="v1",
            generated_at=base - timedelta(days=5),
        ),
        _signal(
            signal_id="v2_in",
            outcome_1h="incorrect",
            parameter_version="v2",
            generated_at=base + timedelta(hours=2),
        ),
    ]
    store = _StubStore(rows=rows)
    service = HistoricalValidationService(store)

    result = service.summarize_by_parameter_version(
        user_id=None,
        from_at=from_at,
        to_at=to_at,
        horizon="1h",
    )

    # v1_out is dropped by the window filter; v1 bucket should have one row, not two.
    assert result["v1"].overall.total_signals == 1
    assert result["v1"].overall.correct == 1
    assert result["v2"].overall.total_signals == 1
    assert result["v2"].overall.incorrect == 1
