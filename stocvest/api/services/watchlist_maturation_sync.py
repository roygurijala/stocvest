"""Persist watchlist maturation from a successful composite (evidence) payload.

Dual-writes to ``WatchlistMaturation`` when ``DYNAMODB_WATCHLIST_MATURATION_TABLE`` is set.
Only updates symbols on the user's **default** watchlist to avoid maturing arbitrary tickers.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, cast

from stocvest.data.watchlist_maturation_repository import (
    WatchlistMaturationRepository,
    get_watchlist_maturation_repository,
)
from stocvest.data.watchlist_maturation_transition_repository import (
    WatchlistMaturationTransitionRepository,
)
from stocvest.data.watchlist_store import WatchlistStore, get_watchlist_store
from stocvest.models.watchlist import (
    MATURATION_LAYER_KEYS,
    WatchlistEntry,
    WatchlistMode,
    WatchlistState,
    derive_maturation_state,
    derive_progress_band,
    derive_state,
)
from stocvest.models.watchlist_transition import EvaluationSource
from stocvest.signals.layer_directional_alignment import count_directional_layers
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_REASON = "evidence_composite"

MaturationSyncResult = Literal[
    "written",
    "skipped_no_user",
    "skipped_bad_body",
    "skipped_no_repo",
    "skipped_no_watchlist",
    "skipped_symbol_not_on_watchlist",
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


def _insufficient_alignment_fields(body: dict[str, Any]) -> tuple[int, list[str], float, str, Literal["long", "short", "neutral"]]:
    """Map insufficient-data composite to a conservative maturation row (still records last_evaluated_at)."""
    available = int(body.get("available_layers") or 0)
    layers_aligned = max(0, min(available, len(MATURATION_LAYER_KEYS)))
    missing_layers = list(MATURATION_LAYER_KEYS[layers_aligned:])
    total = len(MATURATION_LAYER_KEYS)
    pct = (100.0 * float(layers_aligned)) / float(total) if total else 0.0
    reason = str(body.get("message") or "Insufficient layer data for full maturation")[:240]
    return layers_aligned, missing_layers, pct, reason, "neutral"


def _layer_row_available(row: dict[str, Any]) -> bool:
    if str(row.get("status") or "").strip().lower() == "unavailable":
        return False
    if row.get("score") is None:
        return False
    return True


def _composite_bias(signal_summary: str) -> Literal["long", "short", "neutral"]:
    s = (signal_summary or "").strip().lower()
    if s == "bullish":
        return "long"
    if s == "bearish":
        return "short"
    return "neutral"


def _layer_verdict(row: dict[str, Any]) -> str:
    return str(row.get("verdict") or "neutral").strip().lower()


def _layer_aligned_with_composite(
    row: dict[str, Any],
    *,
    composite_bias: Literal["long", "short", "neutral"],
    dominant_tilt: Literal["long", "short"] | None = None,
) -> bool:
    if not _layer_row_available(row):
        return False
    v = _layer_verdict(row)
    if composite_bias == "neutral":
        if v not in ("bullish", "bearish"):
            return False
        if dominant_tilt == "long":
            return v == "bullish"
        if dominant_tilt == "short":
            return v == "bearish"
        return False
    if composite_bias == "long":
        return v == "bullish"
    if composite_bias == "short":
        return v == "bearish"
    return False


def _aligned_layers_from_ratio(body: dict[str, Any]) -> int | None:
    """Match Signals UI: whole-layer count from composite ``alignment_ratio`` (0–1)."""
    raw = body.get("alignment_ratio")
    if raw is None:
        return None
    try:
        ratio = float(raw)
    except (TypeError, ValueError):
        return None
    if ratio != ratio:  # NaN
        return None
    ratio = max(0.0, min(1.0, ratio))
    total = len(MATURATION_LAYER_KEYS)
    return max(0, min(total, round(ratio * total)))


def _missing_layers_for_alignment(
    body: dict[str, Any],
    *,
    composite_bias: Literal["long", "short", "neutral"],
    aligned: int,
    dominant_tilt: Literal["long", "short"] | None = None,
) -> tuple[list[str], str]:
    total = len(MATURATION_LAYER_KEYS)
    need = max(0, total - aligned)
    if need <= 0:
        return [], ""
    missing: list[str] = []
    top_reason = ""
    conflicted_raw = body.get("conflicted_layers")
    if isinstance(conflicted_raw, list):
        for item in conflicted_raw:
            lid = str(item).strip().lower()
            if lid in MATURATION_LAYER_KEYS and lid not in missing:
                missing.append(lid)
    by_layer = _layers_index(body)
    for lid in MATURATION_LAYER_KEYS:
        if len(missing) >= need:
            break
        if lid in missing:
            continue
        row = by_layer.get(lid)
        if row is None:
            missing.append(lid)
            if not top_reason:
                top_reason = f"{lid}: no layer row"
            continue
        if not _layer_aligned_with_composite(
            row, composite_bias=composite_bias, dominant_tilt=dominant_tilt
        ):
            missing.append(lid)
            if not top_reason:
                reason = str(row.get("reasoning") or row.get("status") or "").strip()
                top_reason = (f"{lid}: {reason}" if reason else f"{lid}: not aligned")[:240]
    missing = missing[:need]
    for lid in MATURATION_LAYER_KEYS:
        if len(missing) >= need:
            break
        if lid not in missing:
            missing.append(lid)
    return missing, top_reason


def _layers_index(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = body.get("layers")
    if not isinstance(raw, list):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        lid = str(item.get("layer") or "").strip().lower()
        if lid:
            out[lid] = item
    return out


def _alignment_fields(
    body: dict[str, Any],
) -> tuple[int, list[str], float, str, Literal["long", "short", "neutral"]]:
    summary = str(body.get("signal_summary") or "")
    cb = _composite_bias(summary)
    bias = cast(Literal["long", "short", "neutral"], cb)
    layer_metrics = count_directional_layers(
        body.get("layers") if isinstance(body.get("layers"), list) else None
    )
    dominant_tilt = layer_metrics.get("directional_tilt")
    tilt_arg = dominant_tilt if dominant_tilt in ("long", "short") else None
    from_ratio = _aligned_layers_from_ratio(body)

    if cb == "neutral":
        aligned = int(layer_metrics["directional_aligned"])
        missing, top_reason = _missing_layers_for_alignment(
            body,
            composite_bias=cb,
            aligned=aligned,
            dominant_tilt=tilt_arg,
        )
    elif from_ratio is not None:
        aligned = from_ratio
        missing, top_reason = _missing_layers_for_alignment(
            body, composite_bias=cb, aligned=aligned, dominant_tilt=tilt_arg
        )
    else:
        by_layer = _layers_index(body)
        missing = []
        aligned = 0
        top_reason = ""
        for lid in MATURATION_LAYER_KEYS:
            row = by_layer.get(lid)
            if row is None:
                missing.append(lid)
                if not top_reason:
                    top_reason = f"{lid}: no layer row"
                continue
            if _layer_aligned_with_composite(
                row, composite_bias=cb, dominant_tilt=tilt_arg
            ):
                aligned += 1
            else:
                missing.append(lid)
                if not top_reason:
                    reason = str(row.get("reasoning") or row.get("status") or "").strip()
                    top_reason = (f"{lid}: {reason}" if reason else f"{lid}: not aligned")[:240]
    total = len(MATURATION_LAYER_KEYS)
    pct = (100.0 * float(aligned)) / float(total) if total else 0.0
    return aligned, missing, pct, top_reason, bias


def sync_watchlist_maturation_from_composite(
    *,
    user_id: str,
    symbol: str,
    mode: WatchlistMode,
    composite_body: dict[str, Any],
    maturation_repo: WatchlistMaturationRepository | None = None,
    transition_repo: WatchlistMaturationTransitionRepository | None = None,
    watchlist_store: WatchlistStore | None = None,
    email_on_state_change: bool = True,
    evaluation_source: EvaluationSource = "evidence",
) -> MaturationSyncResult | None:
    """Best-effort maturation upsert; logs and returns a status (or ``None`` when symbol empty)."""
    if not (user_id or "").strip():
        return "skipped_no_user"
    sym_u = (symbol or "").strip().upper()
    if not sym_u:
        return None
    if _skip_body(composite_body):
        return "skipped_bad_body"

    repo = maturation_repo if maturation_repo is not None else get_watchlist_maturation_repository()
    if repo is None:
        _LOG.warning("watchlist maturation sync skipped: DYNAMODB_WATCHLIST_MATURATION_TABLE not configured")
        return "skipped_no_repo"

    store = watchlist_store if watchlist_store is not None else get_watchlist_store()
    wl = store.get_default_watchlist(user_id)
    if not wl:
        return "skipped_no_watchlist"
    if sym_u not in {s.strip().upper() for s in wl.symbols}:
        _LOG.info(
            "watchlist maturation sync skipped: %s not on default watchlist user=%s",
            sym_u,
            user_id,
        )
        return "skipped_symbol_not_on_watchlist"

    wl_mode: WatchlistMode = mode if mode in ("swing", "day") else "swing"
    if str(composite_body.get("status") or "").strip().lower() == "insufficient_data":
        layers_aligned, missing_layers, alignment_pct, top_missing_reason, bias = _insufficient_alignment_fields(
            composite_body
        )
    else:
        layers_aligned, missing_layers, alignment_pct, top_missing_reason, bias = _alignment_fields(composite_body)

    prev = repo.get_entry(user_id, sym_u, wl_mode)
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

    invalidated_at = prev.invalidated_at if prev else None
    invalidation_reason = prev.invalidation_reason if prev else None
    if new_state == WatchlistState.INVALIDATED and prev_state != WatchlistState.INVALIDATED:
        invalidated_at = now
        invalidation_reason = "layers_below_viability"
    elif new_state != WatchlistState.INVALIDATED:
        invalidated_at = None
        invalidation_reason = None

    if state_changed:
        previous_state_on_row: WatchlistState | None = None if prev_state is None else prev_state
    else:
        previous_state_on_row = prev.previous_state if prev else None

    added_at = prev.added_at if prev and prev.added_at else now
    added_from = prev.added_from if prev and prev.added_from else "evidence"

    progress_band = derive_progress_band(layers_aligned, state=new_state)

    entry = WatchlistEntry(
        user_id=user_id,
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
        added_at=added_at,
        added_from=added_from,
        last_evaluated_at=now,
        last_evaluated_session=wl_mode,
        invalidated_at=invalidated_at,
        invalidation_reason=invalidation_reason,
        archive_after=prev.archive_after if prev else None,
        progress_band=progress_band,
    )
    try:
        repo.put_entry(entry)
        _LOG.info(
            "watchlist maturation upserted user=%s sym=%s mode=%s state=%s aligned=%s/%s",
            user_id,
            sym_u,
            wl_mode,
            new_state.value,
            layers_aligned,
            len(MATURATION_LAYER_KEYS),
        )
    except Exception as exc:  # noqa: BLE001 — never break composite response
        _LOG.warning("watchlist maturation put_entry failed user=%s sym=%s: %s", user_id, sym_u, exc)
        return "failed_put"

    try:
        from stocvest.api.services.watchlist_maturation_transition_log import (
            try_log_maturation_transition,
        )

        try_log_maturation_transition(
            prev=prev,
            next_entry=entry,
            recorded_at=now,
            composite_body=composite_body,
            evaluation_source=evaluation_source,
            transition_repo=transition_repo,
        )
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("maturation transition log failed user=%s sym=%s: %s", user_id, sym_u, exc)

    if (
        email_on_state_change
        and state_changed
        and prev_state is not None
        and new_state != prev_state
    ):
        try:
            from stocvest.api.services.watchlist_maturation_notify import (
                try_notify_watchlist_maturation_state_change,
            )

            try_notify_watchlist_maturation_state_change(
                user_id=user_id,
                symbol=sym_u,
                mode=wl_mode,
                previous_state=prev_state,
                new_state=new_state,
            )
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("watchlist maturation notify failed user=%s sym=%s: %s", user_id, sym_u, exc)
    return "written"
