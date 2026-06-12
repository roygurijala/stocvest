"""Persist platform-level signal state + transitions from composite payloads."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from stocvest.api.services.system_signal_transition_log import try_log_system_signal_transition
from stocvest.data.system_signal_transition_repository import (
    SystemSignalTransitionRepository,
    get_system_signal_transition_repository,
)
from stocvest.models.system_signal_state import SystemEvaluationSource, SystemSignalStateEntry
from stocvest.models.watchlist import (
    MATURATION_LAYER_KEYS,
    WatchlistMode,
    WatchlistState,
    derive_maturation_state,
    derive_progress_band,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_REASON = "system_composite"

SystemSyncResult = Literal[
    "written",
    "skipped_bad_body",
    "skipped_no_repo",
    "skipped_empty_symbol",
    "failed_put",
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _skip_body(body: dict[str, Any]) -> bool:
    if body.get("error"):
        return True
    st = str(body.get("status") or "").strip().lower()
    if st == "incomplete":
        return True
    return False


def _alignment_fields(
    composite_body: dict[str, Any],
) -> tuple[int, list[str], float, str, Literal["long", "short", "neutral"]]:
    from stocvest.api.services.watchlist_maturation_sync import _alignment_fields as wl_align

    return wl_align(composite_body)


def _insufficient_alignment_fields(
    composite_body: dict[str, Any],
) -> tuple[int, list[str], float, str, Literal["long", "short", "neutral"]]:
    from stocvest.api.services.watchlist_maturation_sync import _insufficient_alignment_fields as wl_insuf

    return wl_insuf(composite_body)


def sync_system_signal_from_composite(
    *,
    symbol: str,
    mode: WatchlistMode,
    composite_body: dict[str, Any],
    transition_repo: SystemSignalTransitionRepository | None = None,
    evaluation_source: SystemEvaluationSource = "desk_batch",
) -> SystemSyncResult | None:
    """Best-effort platform maturation upsert for any composited symbol."""
    sym_u = (symbol or "").strip().upper()
    if not sym_u:
        return "skipped_empty_symbol"
    if _skip_body(composite_body):
        return "skipped_bad_body"

    repo = transition_repo if transition_repo is not None else get_system_signal_transition_repository()
    if repo is None:
        _LOG.debug("system signal sync skipped: DYNAMODB_SYSTEM_SIGNAL_TRANSITION_TABLE not configured")
        return "skipped_no_repo"

    wl_mode: WatchlistMode = mode if mode in ("swing", "day") else "swing"
    if str(composite_body.get("status") or "").strip().lower() == "insufficient_data":
        layers_aligned, missing_layers, alignment_pct, top_missing_reason, bias = _insufficient_alignment_fields(
            composite_body
        )
    else:
        layers_aligned, missing_layers, alignment_pct, top_missing_reason, bias = _alignment_fields(composite_body)

    prev = repo.get_state(sym_u, wl_mode)
    prev_state = prev.state if prev else None
    was_invalidated = prev_state == WatchlistState.INVALIDATED
    composite_decision = str(composite_body.get("decision_state") or "").strip().lower()
    if not composite_decision:
        summary = str(composite_body.get("signal_summary") or "").strip().lower()
        if summary in ("bullish", "bearish"):
            composite_decision = "actionable"
        elif summary == "neutral":
            composite_decision = "monitor"
    new_state = derive_maturation_state(
        layers_aligned,
        prev_state,
        was_invalidated=was_invalidated,
        composite_decision_state=composite_decision or None,
    )

    now = _utc_now()
    state_changed = prev_state is None or new_state != prev_state
    state_changed_at = now if state_changed else (prev.state_changed_at if prev else now)

    if state_changed:
        previous_state_on_row: WatchlistState | None = None if prev_state is None else prev_state
    else:
        previous_state_on_row = prev.previous_state if prev else None

    first_evaluated_at = prev.first_evaluated_at if prev and prev.first_evaluated_at else now
    progress_band = derive_progress_band(layers_aligned, state=new_state)

    entry = SystemSignalStateEntry(
        symbol=sym_u,
        mode=wl_mode,
        state=new_state,
        previous_state=previous_state_on_row,
        state_changed_at=state_changed_at,
        state_change_reason=_REASON if state_changed else (prev.state_change_reason if prev else _REASON),
        layers_aligned=layers_aligned,
        layers_total=len(MATURATION_LAYER_KEYS),
        alignment_pct=alignment_pct,
        bias=bias,
        missing_layers=missing_layers,
        top_missing_reason=top_missing_reason,
        first_evaluated_at=first_evaluated_at,
        last_evaluated_at=now,
        progress_band=progress_band,
    )
    try:
        repo.put_state(entry)
        _LOG.debug(
            "system signal state upserted sym=%s mode=%s state=%s aligned=%s/%s",
            sym_u,
            wl_mode,
            new_state.value,
            layers_aligned,
            len(MATURATION_LAYER_KEYS),
        )
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("system signal put_state failed sym=%s: %s", sym_u, exc)
        return "failed_put"

    try:
        try_log_system_signal_transition(
            prev=prev,
            next_entry=entry,
            recorded_at=now,
            composite_body=composite_body,
            evaluation_source=evaluation_source,
            transition_repo=repo,
        )
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("system signal transition log failed sym=%s: %s", sym_u, exc)

    return "written"
