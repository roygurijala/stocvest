"""Write setup-evolution transition rows after maturation upsert."""

from __future__ import annotations

from typing import Any

from stocvest.data.scanner_evaluation_trace_store import session_date_et
from stocvest.data.watchlist_maturation_transition_repository import (
    WatchlistMaturationTransitionRepository,
    get_watchlist_maturation_transition_repository,
)
from stocvest.models.watchlist import WatchlistEntry
from stocvest.models.watchlist_transition import (
    EvaluationSource,
    WatchlistMaturationTransition,
    derive_transition_type,
    should_log_maturation_transition,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _fundamental_fields_from_composite(body: dict[str, Any]) -> tuple[str | None, int | None]:
    fc = body.get("fundamental_context")
    backdrop: str | None = None
    if isinstance(fc, dict):
        raw = fc.get("backdrop")
        if isinstance(raw, str) and raw.strip():
            backdrop = raw.strip()
    days_raw = body.get("earnings_days_away")
    days: int | None = int(days_raw) if isinstance(days_raw, (int, float)) and days_raw == days_raw else None
    return backdrop, days


def _price_at_event(body: dict[str, Any]) -> float | None:
    raw = body.get("last_trade_price")
    if isinstance(raw, (int, float)) and raw > 0:
        return float(raw)
    return None


def _parameter_version(body: dict[str, Any]) -> str | None:
    raw = body.get("parameter_version")
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def try_log_maturation_transition(
    *,
    prev: WatchlistEntry | None,
    next_entry: WatchlistEntry,
    recorded_at: str,
    composite_body: dict[str, Any],
    evaluation_source: EvaluationSource = "evidence",
    transition_repo: WatchlistMaturationTransitionRepository | None = None,
) -> None:
    if not should_log_maturation_transition(prev, next_entry):
        return
    repo = (
        transition_repo
        if transition_repo is not None
        else get_watchlist_maturation_transition_repository()
    )
    if repo is None:
        return
    fundamental_backdrop, earnings_days_away = _fundamental_fields_from_composite(composite_body)
    transition = WatchlistMaturationTransition(
        user_id=next_entry.user_id,
        symbol=next_entry.symbol,
        mode=next_entry.mode,
        recorded_at=recorded_at,
        session_date=session_date_et(),
        from_state=prev.state.value if prev else None,
        to_state=next_entry.state.value,
        layers_aligned=next_entry.layers_aligned,
        previous_layers_aligned=prev.layers_aligned if prev else None,
        layers_total=next_entry.layers_total,
        alignment_pct=next_entry.alignment_pct,
        bias=next_entry.bias,
        transition_type=derive_transition_type(prev, next_entry),
        missing_layers=list(next_entry.missing_layers),
        evaluation_source=evaluation_source,
        parameter_version=_parameter_version(composite_body),
        fundamental_backdrop=fundamental_backdrop if next_entry.mode == "swing" else None,
        earnings_days_away=earnings_days_away if next_entry.mode == "swing" else None,
        price_at_event=_price_at_event(composite_body),
    )
    try:
        repo.put_transition(transition)
    except Exception as exc:  # noqa: BLE001
        _LOG.warning(
            "maturation transition put failed user=%s sym=%s: %s",
            next_entry.user_id,
            next_entry.symbol,
            exc,
        )
