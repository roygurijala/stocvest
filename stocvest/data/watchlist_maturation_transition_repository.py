"""DynamoDB append-only log for watchlist maturation transitions (setup evolution)."""

from __future__ import annotations

import time
from decimal import Decimal
from typing import Any, Literal, Protocol, cast, runtime_checkable

from stocvest.models.watchlist import WatchlistMode
from stocvest.models.watchlist_transition import (
    TRANSITION_TTL_DAYS,
    WatchlistMaturationTransition,
)
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)
_SK_PREFIX = "TS#"


@runtime_checkable
class _DynamoTable(Protocol):
    def put_item(self, *, Item: dict[str, Any]) -> Any: ...
    def query(self, **kwargs: Any) -> dict[str, Any]: ...


def _pk(user_id: str, symbol: str, mode: WatchlistMode) -> str:
    return f"USER#{user_id}#SYM#{symbol.upper()}#MODE#{mode}"


def _sk(recorded_at: str, *, unique_ns: int | None = None) -> str:
    if unique_ns is not None:
        return f"{_SK_PREFIX}{recorded_at}#{unique_ns}"
    return f"{_SK_PREFIX}{recorded_at}"


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


class WatchlistMaturationTransitionRepository:
    def __init__(self, table: _DynamoTable) -> None:
        self._table = table

    def put_transition(self, transition: WatchlistMaturationTransition) -> None:
        now_epoch = int(time.time())
        ttl = now_epoch + TRANSITION_TTL_DAYS * 86400
        item: dict[str, Any] = {
            "pk": _pk(transition.user_id, transition.symbol, transition.mode),
            "sk": _sk(transition.recorded_at, unique_ns=time.time_ns()),
            "user_id": transition.user_id,
            "symbol": transition.symbol.upper(),
            "mode": transition.mode,
            "recorded_at": transition.recorded_at,
            "session_date": transition.session_date,
            "from_state": transition.from_state,
            "to_state": transition.to_state,
            "layers_aligned": transition.layers_aligned,
            "layers_total": transition.layers_total,
            "alignment_pct": transition.alignment_pct,
            "bias": transition.bias,
            "transition_type": transition.transition_type,
            "missing_layers": list(transition.missing_layers),
            "evaluation_source": transition.evaluation_source,
            "ttl": ttl,
        }
        if transition.previous_layers_aligned is not None:
            item["previous_layers_aligned"] = transition.previous_layers_aligned
        if transition.parameter_version:
            item["parameter_version"] = transition.parameter_version
        self._table.put_item(Item=item)

    def list_for_symbol(
        self,
        user_id: str,
        symbol: str,
        mode: WatchlistMode,
        *,
        limit: int = 120,
        scan_forward: bool = True,
    ) -> list[WatchlistMaturationTransition]:
        cap = max(1, min(int(limit), 500))
        items: list[dict[str, Any]] = []
        eks: dict[str, Any] | None = None
        while len(items) < cap:
            q: dict[str, Any] = {
                "KeyConditionExpression": "pk = :pk AND begins_with(sk, :pref)",
                "ExpressionAttributeValues": {":pk": _pk(user_id, symbol, mode), ":pref": _SK_PREFIX},
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


def _item_to_transition(item: dict[str, Any]) -> WatchlistMaturationTransition:
    prev_raw = item.get("previous_layers_aligned")
    prev_layers = _num(prev_raw) if prev_raw is not None else None
    from_raw = item.get("from_state")
    mode_raw = str(item.get("mode") or "swing")
    mode_norm: WatchlistMode = mode_raw if mode_raw in ("swing", "day") else "swing"
    return WatchlistMaturationTransition(
        user_id=str(item.get("user_id") or ""),
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
        evaluation_source=cast(
            Literal["evidence", "maturation_refresh"],
            str(item.get("evaluation_source") or "evidence"),
        ),
        parameter_version=str(item["parameter_version"]) if item.get("parameter_version") else None,
    )


_repo: WatchlistMaturationTransitionRepository | None = None


def get_watchlist_maturation_transition_repository() -> WatchlistMaturationTransitionRepository | None:
    global _repo
    settings = get_settings()
    name = (settings.dynamodb_watchlist_maturation_transition_table or "").strip()
    if not name:
        return None
    if _repo is None:
        import boto3

        kwargs: dict[str, Any] = {"region_name": settings.aws_region}
        if settings.dynamodb_endpoint_url:
            kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
        dynamodb = boto3.resource("dynamodb", **kwargs)
        _repo = WatchlistMaturationTransitionRepository(table=dynamodb.Table(name))
        _LOG.info("watchlist maturation transitions: DynamoDB table=%s", name)
    return _repo


def reset_watchlist_maturation_transition_repository_for_tests() -> None:
    global _repo
    _repo = None
