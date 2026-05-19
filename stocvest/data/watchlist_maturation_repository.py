"""DynamoDB access for per-(user, symbol, mode) watchlist maturation rows.

See docs/WATCHLIST_MATURATION_ARCH.md. Table: ``WatchlistMaturation`` (pk/sk + UserStateIndex).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal, Protocol, cast, runtime_checkable

from stocvest.models.watchlist import (
    WatchlistEntry,
    WatchlistMode,
    WatchlistState,
    user_state_gsi_keys,
    user_state_gsi_partition_key,
)
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


@runtime_checkable
class _DynamoTable(Protocol):
    def get_item(self, *, Key: dict[str, str]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> Any: ...
    def delete_item(self, *, Key: dict[str, str]) -> Any: ...
    def query(self, **kwargs: Any) -> dict[str, Any]: ...


def _pk(user_id: str) -> str:
    return f"USER#{user_id}"


def _sk(symbol: str, mode: WatchlistMode) -> str:
    return f"SYM#{symbol.upper()}#{mode}"


def _num(v: Any) -> int:
    if isinstance(v, Decimal):
        return int(v)
    if isinstance(v, bool):
        return int(v)
    return int(v or 0)


def _float(v: Any) -> float:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (int, float)):
        return float(v)
    return float(v or 0.0)


def _to_decimal(v: float | int) -> Decimal:
    """DynamoDB/boto3 rejects Python ``float`` on ``put_item`` — use ``Decimal``."""
    return Decimal(str(v))


class WatchlistMaturationRepository:
    """Pure Dynamo I/O for maturation items (no composite / business rules)."""

    def __init__(self, table: _DynamoTable) -> None:
        self._table = table

    def get_entry(self, user_id: str, symbol: str, mode: WatchlistMode) -> WatchlistEntry | None:
        resp = self._table.get_item(Key={"pk": _pk(user_id), "sk": _sk(symbol, mode)})
        item = resp.get("Item")
        if not item:
            return None
        return _item_to_entry(item)

    def put_entry(self, entry: WatchlistEntry) -> None:
        item = _entry_to_item(entry)
        gsi1pk, gsi1sk = user_state_gsi_keys(
            entry.user_id, entry.state, entry.symbol, entry.mode
        )
        item["gsi1pk"] = gsi1pk
        item["gsi1sk"] = gsi1sk
        self._table.put_item(Item=item)

    def delete_symbol(self, user_id: str, symbol: str, mode: WatchlistMode | None = None) -> int:
        modes: tuple[WatchlistMode, ...] = (mode,) if mode else ("swing", "day")
        n = 0
        for m in modes:
            self._table.delete_item(Key={"pk": _pk(user_id), "sk": _sk(symbol, m)})
            n += 1
        return n

    def list_for_user(
        self,
        user_id: str,
        *,
        mode: WatchlistMode | None = None,
        exclude_archived: bool = True,
    ) -> list[WatchlistEntry]:
        items: list[dict[str, Any]] = []
        eks: dict[str, Any] | None = None
        while True:
            q: dict[str, Any] = {
                "KeyConditionExpression": "pk = :pk AND begins_with(sk, :pref)",
                "ExpressionAttributeValues": {":pk": _pk(user_id), ":pref": "SYM#"},
            }
            if eks:
                q["ExclusiveStartKey"] = eks
            resp = self._table.query(**q)
            items.extend(resp.get("Items") or [])
            eks = resp.get("LastEvaluatedKey")
            if not eks:
                break
        entries = [_item_to_entry(i) for i in items]
        if mode:
            entries = [e for e in entries if e.mode == mode]
        if exclude_archived:
            entries = [e for e in entries if not e.should_exclude_from_active_queries()]
        return entries

    def list_by_state(
        self,
        user_id: str,
        state: WatchlistState,
        *,
        mode: WatchlistMode | None = None,
    ) -> list[WatchlistEntry]:
        """Query UserStateIndex for one user + state prefix."""
        gpk = user_state_gsi_partition_key(user_id)
        prefix = f"STATE#{state.value}#"
        items: list[dict[str, Any]] = []
        eks: dict[str, Any] | None = None
        while True:
            q: dict[str, Any] = {
                "IndexName": "UserStateIndex",
                "KeyConditionExpression": "gsi1pk = :gpk AND begins_with(gsi1sk, :pre)",
                "ExpressionAttributeValues": {":gpk": gpk, ":pre": prefix},
            }
            if eks:
                q["ExclusiveStartKey"] = eks
            resp = self._table.query(**q)
            items.extend(resp.get("Items") or [])
            eks = resp.get("LastEvaluatedKey")
            if not eks:
                break
        entries = [_item_to_entry(i) for i in items]
        if mode:
            entries = [e for e in entries if e.mode == mode]
        return entries

    def replace_entry(self, entry: WatchlistEntry) -> WatchlistEntry | None:
        """Write ``entry`` and return the stored row."""
        self.put_entry(entry)
        return self.get_entry(entry.user_id, entry.symbol, entry.mode)


_repo: WatchlistMaturationRepository | None = None


def get_watchlist_maturation_repository() -> WatchlistMaturationRepository | None:
    """Return repository when ``DYNAMODB_WATCHLIST_MATURATION_TABLE`` is set; else ``None``."""
    global _repo
    settings = get_settings()
    name = (settings.dynamodb_watchlist_maturation_table or "").strip()
    if not name:
        return None
    if _repo is None:
        import boto3

        kwargs: dict[str, Any] = {"region_name": settings.aws_region}
        if settings.dynamodb_endpoint_url:
            kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
        dynamodb = boto3.resource("dynamodb", **kwargs)
        _repo = WatchlistMaturationRepository(table=dynamodb.Table(name))
        _LOG.info("watchlist maturation: DynamoDB table=%s", name)
    return _repo


def reset_watchlist_maturation_repository_for_tests() -> None:
    global _repo
    _repo = None


def _item_to_entry(item: dict[str, Any]) -> WatchlistEntry:
    prev_raw = item.get("previous_state")
    prev = WatchlistState(prev_raw) if prev_raw else None
    mode_raw = str(item.get("mode") or "swing")
    mode_norm: WatchlistMode = mode_raw if mode_raw in ("swing", "day") else "swing"
    return WatchlistEntry(
        user_id=str(item.get("user_id") or ""),
        symbol=str(item.get("symbol") or "").upper(),
        mode=mode_norm,
        state=WatchlistState(str(item.get("state") or WatchlistState.NOT_ALIGNED.value)),
        previous_state=prev,
        state_changed_at=str(item.get("state_changed_at") or ""),
        state_change_reason=str(item.get("state_change_reason") or ""),
        layers_aligned=_num(item.get("layers_aligned")),
        layers_total=_num(item.get("layers_total")) or 6,
        alignment_pct=_float(item.get("alignment_pct")),
        bias=cast(Literal["long", "short", "neutral"], str(item.get("bias") or "neutral")),
        missing_layers=list(item.get("missing_layers") or []),
        top_missing_reason=str(item.get("top_missing_reason") or ""),
        added_at=str(item.get("added_at") or ""),
        added_from=str(item.get("added_from") or "search"),
        last_evaluated_at=str(item.get("last_evaluated_at") or ""),
        last_evaluated_session=str(item.get("last_evaluated_session") or ""),
        invalidated_at=item.get("invalidated_at"),
        invalidation_reason=item.get("invalidation_reason"),
        archive_after=item.get("archive_after"),
    )


def _entry_to_item(entry: WatchlistEntry) -> dict[str, Any]:
    item: dict[str, Any] = {
        "pk": _pk(entry.user_id),
        "sk": _sk(entry.symbol, entry.mode),
        "user_id": entry.user_id,
        "symbol": entry.symbol.upper(),
        "mode": entry.mode,
        "state": entry.state.value,
        "state_changed_at": entry.state_changed_at,
        "state_change_reason": entry.state_change_reason,
        "layers_aligned": entry.layers_aligned,
        "layers_total": entry.layers_total,
        "alignment_pct": _to_decimal(entry.alignment_pct),
        "bias": entry.bias,
        "missing_layers": list(entry.missing_layers),
        "top_missing_reason": entry.top_missing_reason,
        "added_at": entry.added_at,
        "added_from": entry.added_from,
        "last_evaluated_at": entry.last_evaluated_at,
        "last_evaluated_session": entry.last_evaluated_session,
    }
    if entry.previous_state is not None:
        item["previous_state"] = entry.previous_state.value
    if entry.invalidated_at:
        item["invalidated_at"] = entry.invalidated_at
    if entry.invalidation_reason:
        item["invalidation_reason"] = entry.invalidation_reason
    if entry.archive_after:
        item["archive_after"] = entry.archive_after
    return item
