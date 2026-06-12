"""DynamoDB platform-level setup evolution (symbol + mode, no user)."""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal, Protocol, cast, runtime_checkable

from stocvest.models.system_signal_state import SystemSignalStateEntry, SystemEvaluationSource
from stocvest.models.system_signal_transition import SystemSignalTransition, TRANSITION_TTL_DAYS
from stocvest.models.watchlist import ProgressBand, WatchlistMode, WatchlistState
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)
_SK_PREFIX = "TS#"
_CURR_SK = "CURR"
_MODE_TIMELINE_INDEX = "ModeTimelineIndex"


def _pk(symbol: str, mode: WatchlistMode) -> str:
    return f"SYM#{symbol.upper()}#MODE#{mode}"


def _sk(recorded_at: str, *, unique_ns: int | None = None) -> str:
    if unique_ns is not None:
        return f"{_SK_PREFIX}{recorded_at}#{unique_ns}"
    return f"{_SK_PREFIX}{recorded_at}"


def _mode_gsi_pk(mode: WatchlistMode) -> str:
    return f"MODE#{mode}"


def _mode_gsi_sk(recorded_at: str, symbol: str) -> str:
    return f"{recorded_at}#{symbol.upper()}"


def recorded_at_cutoff_iso(days: int) -> str:
    d = max(1, int(days))
    dt = datetime.now(timezone.utc) - timedelta(days=d)
    return dt.replace(microsecond=0).isoformat()


@runtime_checkable
class _DynamoTable(Protocol):
    def put_item(self, *, Item: dict[str, Any]) -> Any: ...
    def query(self, **kwargs: Any) -> dict[str, Any]: ...
    def get_item(self, *, Key: dict[str, str]) -> dict[str, Any]: ...


def _num(v: Any) -> int:
    if isinstance(v, Decimal):
        return int(v)
    return int(v or 0)


def _float(v: Any) -> float:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (int, float)):
        return float(v)
    return float(v or 0.0)


def _to_decimal(v: float | int) -> Decimal:
    return Decimal(str(v))


class SystemSignalTransitionRepository:
    def __init__(self, table: _DynamoTable) -> None:
        self._table = table

    def put_transition(self, transition: SystemSignalTransition) -> None:
        now_epoch = int(time.time())
        ttl = now_epoch + TRANSITION_TTL_DAYS * 86400
        item: dict[str, Any] = {
            "pk": _pk(transition.symbol, transition.mode),
            "sk": _sk(transition.recorded_at, unique_ns=time.time_ns()),
            "symbol": transition.symbol.upper(),
            "mode": transition.mode,
            "recorded_at": transition.recorded_at,
            "session_date": transition.session_date,
            "from_state": transition.from_state,
            "to_state": transition.to_state,
            "layers_aligned": transition.layers_aligned,
            "layers_total": transition.layers_total,
            "alignment_pct": _to_decimal(transition.alignment_pct),
            "bias": transition.bias,
            "transition_type": transition.transition_type,
            "missing_layers": list(transition.missing_layers),
            "evaluation_source": transition.evaluation_source,
            "ttl": ttl,
            "gsi1pk": _mode_gsi_pk(transition.mode),
            "gsi1sk": _mode_gsi_sk(transition.recorded_at, transition.symbol),
        }
        if transition.previous_layers_aligned is not None:
            item["previous_layers_aligned"] = transition.previous_layers_aligned
        if transition.parameter_version:
            item["parameter_version"] = transition.parameter_version
        if transition.fundamental_backdrop:
            item["fundamental_backdrop"] = transition.fundamental_backdrop
        if transition.earnings_days_away is not None:
            item["earnings_days_away"] = transition.earnings_days_away
        if transition.price_at_event is not None:
            item["price_at_event"] = _to_decimal(transition.price_at_event)
        if transition.signal_score is not None:
            item["signal_score"] = transition.signal_score
        self._table.put_item(Item=item)

    def put_state(self, entry: SystemSignalStateEntry) -> None:
        item: dict[str, Any] = {
            "pk": _pk(entry.symbol, entry.mode),
            "sk": _CURR_SK,
            "symbol": entry.symbol.upper(),
            "mode": entry.mode,
            "state": entry.state.value,
            "previous_state": entry.previous_state.value if entry.previous_state else None,
            "state_changed_at": entry.state_changed_at,
            "state_change_reason": entry.state_change_reason,
            "layers_aligned": entry.layers_aligned,
            "layers_total": entry.layers_total,
            "alignment_pct": _to_decimal(entry.alignment_pct),
            "bias": entry.bias,
            "missing_layers": list(entry.missing_layers),
            "top_missing_reason": entry.top_missing_reason,
            "first_evaluated_at": entry.first_evaluated_at,
            "last_evaluated_at": entry.last_evaluated_at,
            "progress_band": entry.progress_band,
        }
        self._table.put_item(Item=item)

    def get_state(self, symbol: str, mode: WatchlistMode) -> SystemSignalStateEntry | None:
        resp = self._table.get_item(Key={"pk": _pk(symbol, mode), "sk": _CURR_SK})
        item = resp.get("Item")
        if not item:
            return None
        return _item_to_state(item)

    def list_for_symbol(
        self,
        symbol: str,
        mode: WatchlistMode,
        *,
        limit: int = 120,
        scan_forward: bool = True,
    ) -> list[SystemSignalTransition]:
        cap = max(1, min(int(limit), 500))
        items: list[dict[str, Any]] = []
        eks: dict[str, Any] | None = None
        while len(items) < cap:
            q: dict[str, Any] = {
                "KeyConditionExpression": "pk = :pk AND begins_with(sk, :pref)",
                "ExpressionAttributeValues": {":pk": _pk(symbol, mode), ":pref": _SK_PREFIX},
                "ScanIndexForward": scan_forward,
                "Limit": cap - len(items),
            }
            if eks:
                q["ExclusiveStartKey"] = eks
            resp = self._table.query(**q)
            items.extend(resp.get("Items") or [])
            eks = resp.get("LastEvaluatedKey")
            if not eks:
                break
        return [_item_to_transition(i) for i in items[:cap]]


def _item_to_state(item: dict[str, Any]) -> SystemSignalStateEntry:
    prev_raw = item.get("previous_state")
    prev_state = WatchlistState(str(prev_raw)) if prev_raw else None
    state_raw = str(item.get("state") or WatchlistState.NOT_ALIGNED.value)
    mode_raw = str(item.get("mode") or "swing")
    mode_norm: WatchlistMode = mode_raw if mode_raw in ("swing", "day") else "swing"
    band_raw = str(item.get("progress_band") or "not_aligned")
    band: ProgressBand = (
        band_raw
        if band_raw in ("not_aligned", "developing", "near_ready", "actionable")
        else "not_aligned"
    )
    return SystemSignalStateEntry(
        symbol=str(item.get("symbol") or "").upper(),
        mode=mode_norm,
        state=WatchlistState(state_raw),
        previous_state=prev_state,
        state_changed_at=str(item.get("state_changed_at") or ""),
        state_change_reason=str(item.get("state_change_reason") or ""),
        layers_aligned=_num(item.get("layers_aligned")),
        layers_total=_num(item.get("layers_total")) or 6,
        alignment_pct=_float(item.get("alignment_pct")),
        bias=cast(Literal["long", "short", "neutral"], str(item.get("bias") or "neutral")),
        missing_layers=list(item.get("missing_layers") or []),
        top_missing_reason=str(item.get("top_missing_reason") or ""),
        first_evaluated_at=str(item.get("first_evaluated_at") or ""),
        last_evaluated_at=str(item.get("last_evaluated_at") or ""),
        progress_band=band,
    )


def _item_to_transition(item: dict[str, Any]) -> SystemSignalTransition:
    prev_raw = item.get("previous_layers_aligned")
    prev_layers = _num(prev_raw) if prev_raw is not None else None
    from_raw = item.get("from_state")
    mode_raw = str(item.get("mode") or "swing")
    mode_norm: WatchlistMode = mode_raw if mode_raw in ("swing", "day") else "swing"
    eval_raw = str(item.get("evaluation_source") or "desk_batch")
    eval_src: SystemEvaluationSource = (
        eval_raw if eval_raw in ("desk_batch", "on_demand", "evidence") else "desk_batch"
    )
    return SystemSignalTransition(
        symbol=str(item.get("symbol") or "").upper(),
        mode=mode_norm,
        recorded_at=str(item.get("recorded_at") or ""),
        session_date=str(item.get("session_date") or ""),
        from_state=str(from_raw) if from_raw else None,
        to_state=str(item.get("to_state") or ""),
        layers_aligned=_num(item.get("layers_aligned")),
        previous_layers_aligned=prev_layers,
        layers_total=_num(item.get("layers_total")) or 6,
        alignment_pct=_float(item.get("alignment_pct")),
        bias=cast(Literal["long", "short", "neutral"], str(item.get("bias") or "neutral")),
        transition_type=cast(
            Literal["initial", "improved", "worsened", "unchanged"],
            str(item.get("transition_type") or "unchanged"),
        ),
        missing_layers=list(item.get("missing_layers") or []),
        evaluation_source=eval_src,
        parameter_version=str(item["parameter_version"]) if item.get("parameter_version") else None,
        fundamental_backdrop=str(item["fundamental_backdrop"]) if item.get("fundamental_backdrop") else None,
        earnings_days_away=_num(item["earnings_days_away"])
        if item.get("earnings_days_away") is not None
        else None,
        price_at_event=_float(item["price_at_event"])
        if item.get("price_at_event") is not None
        else None,
        signal_score=_num(item["signal_score"]) if item.get("signal_score") is not None else None,
    )


_repo: SystemSignalTransitionRepository | None = None


def get_system_signal_transition_repository() -> SystemSignalTransitionRepository | None:
    global _repo
    settings = get_settings()
    name = (settings.dynamodb_system_signal_transition_table or "").strip()
    if not name:
        return None
    endpoint = (settings.dynamodb_endpoint_url or "").strip()
    if endpoint.startswith("#"):
        endpoint = ""
    if _repo is None:
        import boto3

        kwargs: dict[str, Any] = {"region_name": settings.aws_region}
        if endpoint:
            kwargs["endpoint_url"] = endpoint
        dynamodb = boto3.resource("dynamodb", **kwargs)
        _repo = SystemSignalTransitionRepository(table=dynamodb.Table(name))
        _LOG.info("system signal transitions: DynamoDB table=%s", name)
    return _repo


def reset_system_signal_transition_repository_for_tests() -> None:
    global _repo
    _repo = None
