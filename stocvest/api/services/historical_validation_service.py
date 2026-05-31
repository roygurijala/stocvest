"""
Historical Signal Validation — D2 Phase 2: thin service layer.

Bridges the live ``SignalHistory`` store and the pure aggregation module in
``stocvest.signals.historical_validation``. Phase 1 was the math; this module is the
"go fetch the right rows" piece that the eventual API + UI (Phase 3) will sit on top of.

Why a separate module
---------------------
- The Phase 1 aggregator (`validate_signal_history`) is a pure function over an in-memory
  list of `SignalRecord`. That keeps it trivially testable, deterministic, and reusable —
  but it does not know how to find the right rows.
- The signal_recorder module already exposes `get_signal_history(user_id, days, mode, ...)`
  for the live UI / API surfaces. That call understands the GSI ``scope_generated_at``,
  the public / per-user scope split, pagination, and the in-memory test recorder.
- This service layer is the narrow seam between them. It takes an absolute
  ``[from_at, to_at)`` window (the natural query parameter for the historical view) and
  translates it into the recorder's "trailing N days" convention, then post-filters to
  the requested window.

Scope (Phase 2 — this commit)
-----------------------------
- One service class, `HistoricalValidationService`, built on a narrow `SignalHistoryReader`
  Protocol so both the in-memory and DynamoDB recorders can satisfy it without import
  coupling.
- Two methods:
    * `summarize(...)` — single `HistoricalValidationSummary` for the window.
    * `summarize_by_parameter_version(...)` — same window, split per `parameter_version`
      so Phase 3 can render a "v1 vs v2" diff. An `__all__` bucket carries the combined
      cross-version aggregate so the UI never has to reconstruct it.

Out of scope (deferred to Phase 3+)
-----------------------------------
- HTTP route (`GET /v1/signals/historical-validation/summary`).
- BFF route and authentication / paid-tier gating.
- Admin UI at `/dashboard/admin/historical-validation`; public mirror on `/performance`.
- Cursor-based pagination for admin cross-user analytics (the current cap is enough for
  per-user and public-scope views).
- DynamoDB schema changes — no new tables, no new GSIs. The existing
  ``scope_generated_at`` index already supports the date-range query we need.

Date-window convention
----------------------
`from_at` is inclusive, `to_at` is exclusive — same semantics as the underlying GSI's
``generated_at >= cutoff_iso`` predicate. This matches how every other STOCVEST analytics
helper handles windows (see `signal_analysis._in_window`) so a Phase 3 caller can pass
`from_at = midnight ET today, to_at = midnight ET tomorrow` and get "today's signals" with
no off-by-one surprises.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol

from stocvest.data.models import SignalRecord
from stocvest.signals.historical_validation import (
    HistoricalValidationSummary,
    Horizon,
    validate_signal_history,
)

# Safety caps. These are intentionally generous — typical per-user windows are a few
# hundred signals over 30 days — and exist so a buggy caller (or admin tooling) cannot
# drain the GSI by asking for "the last 10 years".
MAX_LOOKBACK_DAYS = 366
MAX_ROWS_PER_QUERY = 1000

#: Bucket key used by `summarize_by_parameter_version` for the combined cross-version
#: aggregate. The UI renders this as "All versions"; rendering the same number across both
#: the per-version breakdown and the overall is a common Phase 3 requirement.
ALL_VERSIONS_KEY = "__all__"

#: Bucket key used when a row has no `parameter_version` (legacy rows emitted before that
#: column shipped). Same convention as the Phase 1 aggregator's "unknown" / "other"
#: overflows — we never silently drop rows.
UNKNOWN_VERSION_KEY = "unknown"


class SignalHistoryReader(Protocol):
    """Narrow read-only view of the underlying signal-history store.

    Both `InMemorySignalRecorder` and `DynamoDBSignalRecorder` in
    `stocvest.api.services.signal_recorder` already satisfy this Protocol — we depend on
    the Protocol (not the concrete class) so tests can swap a list-backed double in
    without importing boto3 or constructing a fake DynamoDB table.
    """

    def get_signal_history(
        self,
        *,
        user_id: str | None = None,
        symbol: str | None = None,
        days: int = 30,
        limit: int = 100,
        mode: str | None = None,
        ledger_qualified_only: bool = False,
    ) -> list[SignalRecord]: ...


class HistoricalValidationService:
    """Service-layer wrapper over the Phase 1 aggregator.

    Construct once per request (or once per Lambda invocation) with the live recorder:

        store = get_signal_recorder()
        service = HistoricalValidationService(store)
        summary = service.summarize(
            user_id="abc",
            from_at=window_start,
            to_at=window_end,
            horizon="1d",
        )
    """

    def __init__(self, store: SignalHistoryReader) -> None:
        self._store = store

    def summarize(
        self,
        *,
        user_id: str | None,
        from_at: datetime,
        to_at: datetime,
        horizon: Horizon,
        mode: str | None = None,
        symbol: str | None = None,
    ) -> HistoricalValidationSummary:
        """Return a single `HistoricalValidationSummary` for ``[from_at, to_at)``.

        ``user_id=None`` queries the public scope (the rows that back the public
        ``/performance`` page). ``user_id="abc"`` queries that user's tracked outcomes
        (the rows that back admin D2 historical validation). ``mode`` and ``symbol``
        are optional filters that pass through to the underlying store.
        """
        rows = self._fetch(
            user_id=user_id,
            from_at=from_at,
            to_at=to_at,
            mode=mode,
            symbol=symbol,
        )
        return validate_signal_history(rows, horizon=horizon)

    def summarize_by_parameter_version(
        self,
        *,
        user_id: str | None,
        from_at: datetime,
        to_at: datetime,
        horizon: Horizon,
        mode: str | None = None,
        symbol: str | None = None,
    ) -> dict[str, HistoricalValidationSummary]:
        """Group rows by ``parameter_version`` and return a summary per bucket.

        Always includes an ``__all__`` bucket carrying the combined cross-version
        aggregate (same numbers as `summarize` over the identical window) so callers
        can render "all versions" alongside the per-version breakdown without
        recomputing. Rows missing a ``parameter_version`` fall into the
        ``unknown`` bucket — they are never silently dropped.
        """
        rows = self._fetch(
            user_id=user_id,
            from_at=from_at,
            to_at=to_at,
            mode=mode,
            symbol=symbol,
        )

        per_version: dict[str, list[SignalRecord]] = {}
        for row in rows:
            key = _version_key(row.parameter_version)
            per_version.setdefault(key, []).append(row)

        result: dict[str, HistoricalValidationSummary] = {
            ALL_VERSIONS_KEY: validate_signal_history(rows, horizon=horizon)
        }
        for version, version_rows in per_version.items():
            result[version] = validate_signal_history(version_rows, horizon=horizon)
        return result

    def _fetch(
        self,
        *,
        user_id: str | None,
        from_at: datetime,
        to_at: datetime,
        mode: str | None,
        symbol: str | None,
    ) -> list[SignalRecord]:
        """Pull the ``[from_at, to_at)`` window from the underlying store.

        The store's `get_signal_history(days=N)` returns the trailing N-day window.
        We pad N to cover ``from_at``, then post-filter to drop rows outside the
        requested window. This is the standard pattern for this codebase — see
        `signal_analysis._in_window` for the same approach.

        Bound semantics: lower bound inclusive, upper bound exclusive.
        """
        from_utc = _to_utc(from_at)
        to_utc = _to_utc(to_at)
        if to_utc <= from_utc:
            # Caller error — empty window. Phase 1's aggregator handles an empty list
            # cleanly (NaN accuracy), so we just return early without hitting the store.
            return []

        now = datetime.now(timezone.utc)
        seconds_back = max(0.0, (now - from_utc).total_seconds())
        # +1 day pad so the cutoff fence definitely covers `from_at` after any
        # microsecond / iso-format truncation the store applies before its GSI query.
        days_back = min(MAX_LOOKBACK_DAYS, int(seconds_back // 86400) + 1)

        page_fn = getattr(self._store, "get_user_signal_history_page", None)
        if not callable(page_fn):
            candidates = self._store.get_signal_history(
                user_id=user_id,
                symbol=symbol,
                days=days_back,
                limit=MAX_ROWS_PER_QUERY,
                mode=mode,
                ledger_qualified_only=False,
            )
            return [row for row in candidates if from_utc <= _ensure_utc(row.generated_at) < to_utc]

        collected: list[SignalRecord] = []
        cursor: str | None = None
        page_size = min(500, MAX_ROWS_PER_QUERY)
        while len(collected) < MAX_ROWS_PER_QUERY:
            page, cursor = page_fn(
                user_id=user_id,
                symbol=symbol,
                days=days_back,
                page_size=page_size,
                mode=mode,
                ledger_qualified_only=False,
                cursor=cursor,
            )
            for row in page:
                if from_utc <= _ensure_utc(row.generated_at) < to_utc:
                    collected.append(row)
            if not cursor or not page:
                break
        return collected[:MAX_ROWS_PER_QUERY]

    def fetch_backtest_window(
        self,
        *,
        scope: str,
        from_at: datetime,
        to_at: datetime,
        mode: str | None = None,
        user_id: str | None = None,
    ) -> list[SignalRecord]:
        """Load rows for desk backtesting.

        ``public`` — platform mirror partition (``user_id=None``).
        ``mine`` — caller's user scope.
        ``all`` — bounded full-table scan (admin only; dedupes platform mirrors).
        """
        scope_norm = (scope or "public").strip().lower()
        if scope_norm == "all":
            scan = getattr(self._store, "scan_records_in_window", None)
            if callable(scan):
                rows = scan(from_at=from_at, to_at=to_at, mode=mode, max_rows=MAX_ROWS_PER_QUERY)
            else:
                rows = []
            # User-scoped rows only — mirrors duplicate the same captures under PUBLIC.
            return [r for r in rows if r.user_id]
        uid = user_id if scope_norm in ("mine", "user", "self") else None
        return self._fetch(
            user_id=uid,
            from_at=from_at,
            to_at=to_at,
            mode=mode,
            symbol=None,
        )

    def summarize_backtest(
        self,
        *,
        scope: str,
        from_at: datetime,
        to_at: datetime,
        horizon: Horizon,
        mode: str | None = None,
        symbol: str | None = None,
        user_id: str | None = None,
    ) -> HistoricalValidationSummary:
        rows = self.fetch_backtest_window(
            scope=scope,
            from_at=from_at,
            to_at=to_at,
            mode=mode,
            user_id=user_id,
        )
        sym = symbol.strip().upper() if symbol else None
        if sym:
            rows = [r for r in rows if r.symbol.upper() == sym]
        return validate_signal_history(rows, horizon=horizon)


def _to_utc(dt: datetime) -> datetime:
    """Normalize a naive or zoned datetime to UTC. Naive inputs are assumed UTC."""

    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _ensure_utc(dt: datetime) -> datetime:
    """Ensure a `SignalRecord.generated_at` is timezone-aware before comparison."""

    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _version_key(version: str | None) -> str:
    """Bucket key for `parameter_version` — missing / empty values land under ``unknown``."""

    if version is None:
        return UNKNOWN_VERSION_KEY
    stripped = version.strip()
    return stripped if stripped else UNKNOWN_VERSION_KEY


__all__ = [
    "HistoricalValidationService",
    "SignalHistoryReader",
    "MAX_LOOKBACK_DAYS",
    "MAX_ROWS_PER_QUERY",
    "ALL_VERSIONS_KEY",
    "UNKNOWN_VERSION_KEY",
]
