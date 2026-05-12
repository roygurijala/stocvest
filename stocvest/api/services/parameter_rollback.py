"""D10 Phase 4 — rollback orchestrator.

This service is the partner of :mod:`stocvest.api.services.proposal_review`:

* **proposal_review.promote_proposal** — admin clicks "Promote" on a
  pending proposal, weights rotate forward via
  :meth:`ParameterStore.save_parameters_sync`.
* **parameter_rollback.rollback_to_version** — admin clicks "Roll back"
  on a prior ``ParameterHistory`` row, weights rotate **backward** via
  the same :meth:`ParameterStore.save_parameters_sync` call.

Both paths are gated by the same admin authorization helper and both
funnel through the same atomic write primitive — so the audit story is
clean (every rotation, whether forward or backward, lands as a fresh
``ParameterHistory`` row with a new monotonically-incremented version
string, never a duplicate of the old version).

Why we always **forward-write** a new version on rollback
---------------------------------------------------------
A rollback is operationally a rotation back to known-good weights, but
it must NEVER mutate or delete prior history rows. The model is "create
a new version whose payload happens to match v_old", not "make v_old
live again". This way:

* The audit trail is monotonic — every row in ``ParameterHistory``
  corresponds to exactly one promote-or-rollback admin action, with the
  reviewer's identity stamped via ``changed_by``.
* The cross-version diff view in D2 Phase 4 can naturally compare
  "v3.0.5 (rollback to v3.0.2)" vs "v3.0.2 (original)" if needed.
* A rollback that's later proven wrong can itself be rolled back
  forward to the version that the bad rollback overwrote.

Failure modes
-------------
* **Target row not found** in ``ParameterHistory`` → ``success=False``,
  ``error="not found"``. Caller (admin handler) maps this to a 404.
* **Target row's ``parameters_json`` is malformed** → ``success=False``,
  ``error="invalid history row"``. Handler maps to 500 — a corrupted
  audit row is an ops problem, not an admin-request problem.
* **Target version equals current live version** → ``success=False``,
  ``error="already on target version"``. Handler maps to 409 — the
  rollback would be a no-op AND would create a duplicate audit row.
* **``save_parameters_sync`` returns ``False``** → ``success=False``,
  ``error="parameter save failed"``. Handler maps to 500. The live
  secret is NOT mutated in this case (boto3 either fully wrote or
  raised before mark_promoted of any audit row).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from stocvest.config.parameter_store import (
    ParameterStore,
    signal_parameters_from_dict,
)
from stocvest.data.parameter_history_store import (
    ParameterHistoryRow,
    get_parameter_history_version,
    list_parameter_history_versions,
    parameters_dict_from_history_row,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


# ── Dataclasses ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RollbackResult:
    """Outcome of one :func:`rollback_to_version` invocation.

    ``success=False`` means the secret was NOT rotated — the admin can
    retry. ``rolled_back_from`` is the version that WAS live at the
    moment of the call (before the rotation). ``new_parameter_version``
    is the freshly-minted version string (always different from
    ``target_version`` — see module docstring on why we forward-write).
    """

    success: bool
    target_version: str
    rolled_back_from: str | None = None
    new_parameter_version: str | None = None
    error: str | None = None
    extras: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "target_version": self.target_version,
            "rolled_back_from": self.rolled_back_from,
            "new_parameter_version": self.new_parameter_version,
            "error": self.error,
            "extras": dict(self.extras),
        }


@dataclass(frozen=True)
class ParameterHistorySummaryRow:
    """Compact projection of a :class:`ParameterHistoryRow` for the picker UI.

    The admin UI doesn't need the full ``parameters_json`` payload to
    render the list — it needs the version, when it went live, why,
    and who flipped it. The detail (full per-mode composite weights)
    is shown after the admin picks a row.
    """

    version: str
    created_at: str
    reason: str
    changed_by: str
    signal_count_on_change: int
    accuracy_before_change: float
    is_current_live_version: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "created_at": self.created_at,
            "reason": self.reason,
            "changed_by": self.changed_by,
            "signal_count_on_change": int(self.signal_count_on_change),
            "accuracy_before_change": float(self.accuracy_before_change),
            "is_current_live_version": bool(self.is_current_live_version),
        }


# ── Projection helpers ───────────────────────────────────────────────────


def history_row_to_summary(
    row: ParameterHistoryRow,
    *,
    current_live_version: str | None,
) -> ParameterHistorySummaryRow:
    """Project a :class:`ParameterHistoryRow` into the list-view shape.

    ``is_current_live_version`` is computed against the current live
    parameters so the UI can disable the "Roll back to this" button on
    the row that's already active (no-op rollback). Comparison is exact
    string match — versions are namespaced 3-part dotted (``1.0.7``).
    """
    is_live = bool(
        current_live_version
        and isinstance(row.version, str)
        and row.version.strip() == current_live_version.strip()
    )
    return ParameterHistorySummaryRow(
        version=row.version,
        created_at=row.created_at,
        reason=row.reason,
        changed_by=row.changed_by,
        signal_count_on_change=row.signal_count_on_change,
        accuracy_before_change=row.accuracy_before_change,
        is_current_live_version=is_live,
    )


# ── Orchestration ────────────────────────────────────────────────────────


def list_history_with_live_marker(
    *,
    limit: int = 50,
    parameter_store: type[ParameterStore] | None = None,
) -> list[ParameterHistorySummaryRow]:
    """List ``ParameterHistory`` rows newest-first with a live-version flag.

    The list endpoint returns these. The picker UI uses
    ``is_current_live_version`` to disable the row that matches the
    currently-active secret value — rolling back to the same version
    is rejected at the orchestrator layer too (defense in depth).
    """
    pstore_cls = parameter_store if parameter_store is not None else ParameterStore
    try:
        live = pstore_cls.get_parameters_sync()
        current_version: str | None = str(live.version) if live else None
    except Exception:  # pragma: no cover — defensive
        current_version = None

    rows = list_parameter_history_versions(limit=limit)
    return [history_row_to_summary(r, current_live_version=current_version) for r in rows]


def rollback_to_version(
    target_version: str,
    *,
    reviewed_by: str,
    parameter_store: type[ParameterStore] | None = None,
) -> RollbackResult:
    """Roll the live parameters back to ``target_version`` from history.

    See module docstring for the full flow + failure modes. Returns a
    :class:`RollbackResult` rather than raising so the admin handler can
    map common errors to friendly status codes.

    Note on ``changed_by``: we prefix the live-secret audit row's
    ``changed_by`` with ``"d10-rollback:"`` so the audit trail makes the
    rollback intent explicit in ``ParameterHistory``. Promotions use
    ``"d10-admin:"`` for the same reason (see ``proposal_review``).
    """
    pstore_cls = parameter_store if parameter_store is not None else ParameterStore
    target = (target_version or "").strip()
    if not target:
        return RollbackResult(
            success=False,
            target_version=target_version or "",
            error="target_version is required",
        )

    row = get_parameter_history_version(target)
    if row is None:
        return RollbackResult(
            success=False,
            target_version=target,
            error="not found",
        )

    parsed = parameters_dict_from_history_row(row)
    if parsed is None:
        _LOG.error(
            "rollback_to_version: malformed parameters_json on history row %s", target
        )
        return RollbackResult(
            success=False,
            target_version=target,
            error="invalid history row",
        )

    try:
        live = pstore_cls.get_parameters_sync()
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception("rollback_to_version: failed to read live params: %s", exc)
        return RollbackResult(
            success=False,
            target_version=target,
            error=f"parameter load failed: {exc}",
        )
    rolled_back_from = str(live.version) if live else None

    if rolled_back_from and rolled_back_from == target:
        return RollbackResult(
            success=False,
            target_version=target,
            rolled_back_from=rolled_back_from,
            error="already on target version",
        )

    try:
        target_params = signal_parameters_from_dict(parsed)
    except Exception as exc:
        _LOG.exception(
            "rollback_to_version: signal_parameters_from_dict failed for v%s: %s",
            target,
            exc,
        )
        return RollbackResult(
            success=False,
            target_version=target,
            rolled_back_from=rolled_back_from,
            error="invalid history row",
        )

    reason = (
        f"D10 rollback: from v{rolled_back_from} to v{target} by {reviewed_by} "
        f"(target reason: {row.reason!r})"
    )
    save_ok = pstore_cls.save_parameters_sync(
        target_params,
        reason=reason,
        changed_by=f"d10-rollback:{reviewed_by}",
    )
    if not save_ok:
        return RollbackResult(
            success=False,
            target_version=target,
            rolled_back_from=rolled_back_from,
            error="parameter save failed",
        )

    new_version = str(target_params.version)
    _LOG.info(
        "rollback_to_version succeeded: target=%s from=%s new=%s reviewer=%s",
        target,
        rolled_back_from,
        new_version,
        reviewed_by,
    )
    return RollbackResult(
        success=True,
        target_version=target,
        rolled_back_from=rolled_back_from,
        new_parameter_version=new_version,
        extras={"target_reason": row.reason},
    )


__all__ = [
    "ParameterHistorySummaryRow",
    "RollbackResult",
    "history_row_to_summary",
    "list_history_with_live_marker",
    "rollback_to_version",
]
