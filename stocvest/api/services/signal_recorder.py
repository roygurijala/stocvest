"""D1: persist signals and resolve outcomes against later prices (DynamoDB or in-memory)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from decimal import Decimal
from typing import Any, Protocol, runtime_checkable
from uuid import uuid4

from botocore.exceptions import ClientError

from stocvest.data.models import SignalRecord
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

log = get_logger(__name__)

NEUTRAL_MOVE_PCT = 0.1
GSI_NAME = "scope_generated_at"
_ET = ZoneInfo("America/New_York")


def _et_today() -> date:
    return datetime.now(_ET).date()


def _signal_calendar_date_et(rec: SignalRecord) -> date:
    """Calendar date in US/Eastern for ``generated_at`` (display aligns with market day)."""
    ga = rec.generated_at
    if ga.tzinfo is None:
        ga = ga.replace(tzinfo=timezone.utc)
    return ga.astimezone(_ET).date()


def outcome_from_prices(direction: str, price_at: float, price_after: float | None) -> str:
    if price_after is None or price_at <= 0:
        return "neutral"
    move_pct = abs((price_after - price_at) / price_at) * 100.0
    if move_pct <= NEUTRAL_MOVE_PCT:
        return "neutral"
    d = direction.lower()
    if d == "bullish":
        return "correct" if price_after > price_at else "incorrect"
    if d == "bearish":
        return "correct" if price_after < price_at else "incorrect"
    return "neutral"


def _scope_key(user_id: str | None) -> str:
    return f"USER#{user_id}" if user_id else "PUBLIC"


def _to_decimals(obj: Any) -> Any:
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_decimals(v) for k, v in obj.items()}
    return obj


def _record_to_item(rec: SignalRecord) -> dict[str, Any]:
    layer = _to_decimals(rec.layer_scores)
    item: dict[str, Any] = {
        "signal_id": rec.signal_id,
        "scope_key": _scope_key(rec.user_id),
        "generated_at": rec.generated_at.astimezone(timezone.utc).isoformat(),
        "symbol": rec.symbol.upper(),
        "direction": rec.direction,
        "signal_strength": rec.signal_strength,
        "pattern": rec.pattern,
        "layer_scores": layer,
        "price_at_signal": Decimal(str(rec.price_at_signal)),
        "resolved_1h": rec.resolved_1h,
        "resolved_1d": rec.resolved_1d,
    }
    if rec.user_id:
        item["user_id"] = rec.user_id
    if rec.price_1h_after is not None:
        item["price_1h_after"] = Decimal(str(rec.price_1h_after))
    if rec.price_1d_after is not None:
        item["price_1d_after"] = Decimal(str(rec.price_1d_after))
    if rec.outcome_1h is not None:
        item["outcome_1h"] = rec.outcome_1h
    if rec.outcome_1d is not None:
        item["outcome_1d"] = rec.outcome_1d
    if rec.ai_summary:
        item["ai_summary"] = rec.ai_summary
    if rec.technical_snapshot_json:
        item["technical_snapshot_json"] = rec.technical_snapshot_json
    if rec.news_snapshot_json:
        item["news_snapshot_json"] = rec.news_snapshot_json
    if rec.macro_snapshot_json:
        item["macro_snapshot_json"] = rec.macro_snapshot_json
    if rec.sector_snapshot_json:
        item["sector_snapshot_json"] = rec.sector_snapshot_json
    if rec.internals_snapshot_json:
        item["internals_snapshot_json"] = rec.internals_snapshot_json
    if rec.layer_scores_json:
        item["layer_scores_json"] = rec.layer_scores_json
    if rec.parameter_version:
        item["parameter_version"] = rec.parameter_version
    return item


def _item_to_record(item: dict[str, Any]) -> SignalRecord:
    return SignalRecord.from_dynamo_item(item)


@runtime_checkable
class SignalOutcomePriceSource(Protocol):
    """Historical minute-bar pricing for signal outcome tracking (1h / 1d horizons)."""

    async def get_evaluated_price_after_signal(self, symbol: str, generated_at: datetime, *, horizon: str) -> float | None: ...


class InMemorySignalRecorder:
    def __init__(self) -> None:
        self._items: dict[str, dict[str, Any]] = {}

    def record_signal(self, record: SignalRecord) -> str:
        sid = record.signal_id.strip() or str(uuid4())
        rec = record.model_copy(update={"signal_id": sid})
        self._items[sid] = _record_to_item(rec)
        return sid

    def get_public_recent(self, *, limit: int = 50) -> list[dict[str, Any]]:
        rows = [it for it in self._items.values() if it.get("scope_key") == "PUBLIC"]
        rows.sort(key=lambda x: str(x.get("generated_at") or ""), reverse=True)
        return [_public_api_shape(_item_to_record(r)) for r in rows[:limit]]

    def get_public_landing_items(self, *, limit: int = 5) -> list[dict[str, Any]]:
        rows = [it for it in self._items.values() if it.get("scope_key") == "PUBLIC"]
        records = [_item_to_record(r) for r in rows]
        resolved = [r for r in records if r.outcome_1h is not None]
        resolved.sort(key=lambda r: r.generated_at, reverse=True)
        return [_landing_api_shape(r) for r in resolved[:limit]]

    def get_signal_history(
        self,
        *,
        user_id: str | None = None,
        symbol: str | None = None,
        days: int = 30,
        limit: int = 100,
    ) -> list[SignalRecord]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
        sym_filter = symbol.strip().upper() if symbol else None
        scope = _scope_key(user_id)
        out: list[SignalRecord] = []
        for it in self._items.values():
            if it.get("scope_key") != scope:
                continue
            rec = _item_to_record(it)
            if rec.generated_at < cutoff:
                continue
            if sym_filter and rec.symbol.upper() != sym_filter:
                continue
            out.append(rec)
        out.sort(key=lambda r: r.generated_at, reverse=True)
        return out[:limit]

    def iter_public_records(self) -> list[SignalRecord]:
        return [
            _item_to_record(it) for it in self._items.values() if it.get("scope_key") == "PUBLIC"
        ]

    def get_signal_record_raw(self, signal_id: str) -> SignalRecord | None:
        raw = self._items.get(signal_id.strip())
        if not raw:
            return None
        return _item_to_record(raw)

    def scan_all_records(self) -> list[SignalRecord]:
        """Full table scan (admin / analysis only)."""
        return [_item_to_record(it) for it in self._items.values() if isinstance(it, dict)]

    async def resolve_signals(
        self,
        cutoff_minutes: int,
        polygon: SignalOutcomePriceSource,
        *,
        horizon: str,
    ) -> int:
        if horizon not in {"1h", "1d"}:
            raise ValueError("horizon must be 1h or 1d")
        now = datetime.now(timezone.utc)
        cutoff_time = now - timedelta(minutes=cutoff_minutes)
        resolved_attr = "resolved_1h" if horizon == "1h" else "resolved_1d"
        price_attr = "price_1h_after" if horizon == "1h" else "price_1d_after"
        outcome_attr = "outcome_1h" if horizon == "1h" else "outcome_1d"
        updated = 0
        for sid, it in list(self._items.items()):
            if it.get(resolved_attr):
                continue
            gen = datetime.fromisoformat(str(it["generated_at"]).replace("Z", "+00:00"))
            if gen.tzinfo is None:
                gen = gen.replace(tzinfo=timezone.utc)
            if gen > cutoff_time:
                continue
            sym = str(it["symbol"]).upper()
            price_after = await polygon.get_evaluated_price_after_signal(sym, gen, horizon=horizon)
            if price_after is None:
                continue
            price_at = float(it["price_at_signal"])
            direction = str(it["direction"])
            outcome = outcome_from_prices(direction, price_at, float(price_after))
            it[price_attr] = Decimal(str(float(price_after)))
            it[outcome_attr] = outcome
            it[resolved_attr] = True
            self._items[sid] = it
            updated += 1
        return updated


class DynamoDBSignalRecorder:
    def __init__(self, *, table: Any) -> None:
        self._table = table

    @classmethod
    def from_settings(cls) -> DynamoDBSignalRecorder:
        import boto3

        settings = get_settings()
        name = settings.dynamodb_signal_history_table.strip()
        if not name:
            raise ValueError("DYNAMODB_SIGNAL_HISTORY_TABLE is not set")
        kwargs: dict[str, Any] = {}
        if settings.dynamodb_endpoint_url:
            kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
        dynamodb = boto3.resource("dynamodb", **kwargs)
        return cls(table=dynamodb.Table(name))

    def record_signal(self, record: SignalRecord) -> str:
        sid = record.signal_id.strip() or str(uuid4())
        rec = record.model_copy(update={"signal_id": sid})
        self._table.put_item(Item=_record_to_item(rec))
        return sid

    def get_public_recent(self, *, limit: int = 50) -> list[dict[str, Any]]:
        try:
            from boto3.dynamodb.conditions import Key

            resp = self._table.query(
                IndexName=GSI_NAME,
                KeyConditionExpression=Key("scope_key").eq("PUBLIC"),
                ScanIndexForward=False,
                Limit=limit,
            )
        except ClientError as exc:
            code = str((exc.response or {}).get("Error", {}).get("Code", ""))
            if code in {"ResourceNotFoundException", "ValidationException"}:
                log.warning("signal history query failed: %s", code)
                return []
            raise
        items = resp.get("Items") or []
        records = [_item_to_record(x) for x in items if isinstance(x, dict)]
        return [_public_api_shape(r) for r in records]

    def get_public_landing_items(self, *, limit: int = 5) -> list[dict[str, Any]]:
        try:
            from boto3.dynamodb.conditions import Key

            resp = self._table.query(
                IndexName=GSI_NAME,
                KeyConditionExpression=Key("scope_key").eq("PUBLIC"),
                ScanIndexForward=False,
                Limit=200,
            )
        except ClientError as exc:
            code = str((exc.response or {}).get("Error", {}).get("Code", ""))
            if code in {"ResourceNotFoundException", "ValidationException"}:
                log.warning("signal history landing query failed: %s", code)
                return []
            raise
        items = resp.get("Items") or []
        resolved: list[SignalRecord] = []
        for raw in items:
            if not isinstance(raw, dict):
                continue
            rec = _item_to_record(raw)
            if rec.outcome_1h is not None:
                resolved.append(rec)
        resolved.sort(key=lambda r: r.generated_at, reverse=True)
        return [_landing_api_shape(r) for r in resolved[:limit]]

    def get_signal_history(
        self,
        *,
        user_id: str | None = None,
        symbol: str | None = None,
        days: int = 30,
        limit: int = 100,
    ) -> list[SignalRecord]:
        scope = _scope_key(user_id)
        try:
            from boto3.dynamodb.conditions import Key

            resp = self._table.query(
                IndexName=GSI_NAME,
                KeyConditionExpression=Key("scope_key").eq(scope),
                ScanIndexForward=False,
                Limit=min(500, max(limit, 1) * 5),
            )
        except ClientError as exc:
            code = str((exc.response or {}).get("Error", {}).get("Code", ""))
            if code in {"ResourceNotFoundException", "ValidationException"}:
                return []
            raise
        cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
        sym_filter = symbol.strip().upper() if symbol else None
        out: list[SignalRecord] = []
        for raw in resp.get("Items") or []:
            if not isinstance(raw, dict):
                continue
            rec = _item_to_record(raw)
            if rec.generated_at < cutoff:
                continue
            if sym_filter and rec.symbol.upper() != sym_filter:
                continue
            out.append(rec)
            if len(out) >= limit:
                break
        return out

    def iter_public_records(self) -> list[SignalRecord]:
        return [
            _item_to_record(x)
            for x in self._scan_all()
            if isinstance(x, dict) and x.get("scope_key") == "PUBLIC"
        ]

    def get_signal_record_raw(self, signal_id: str) -> SignalRecord | None:
        sid = signal_id.strip()
        if not sid:
            return None
        try:
            resp = self._table.get_item(Key={"signal_id": sid})
        except ClientError as exc:
            log.warning("signal get_item failed: %s", exc)
            return None
        item = resp.get("Item")
        if not isinstance(item, dict):
            return None
        return _item_to_record(item)

    def scan_all_records(self) -> list[SignalRecord]:
        """Full table scan (admin / analysis only)."""
        return [_item_to_record(x) for x in self._scan_all() if isinstance(x, dict)]

    def _scan_all(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        scan_kwargs: dict[str, Any] = {}
        while True:
            try:
                result = self._table.scan(**scan_kwargs)
            except ClientError as exc:
                code = str((exc.response or {}).get("Error", {}).get("Code", ""))
                if code in {"ResourceNotFoundException", "ValidationException"}:
                    return []
                raise
            batch = result.get("Items") or []
            items.extend(x for x in batch if isinstance(x, dict))
            lek = result.get("LastEvaluatedKey")
            if not lek:
                break
            scan_kwargs["ExclusiveStartKey"] = lek
        return items

    async def resolve_signals(
        self,
        cutoff_minutes: int,
        polygon: SignalOutcomePriceSource,
        *,
        horizon: str,
    ) -> int:
        if horizon not in {"1h", "1d"}:
            raise ValueError("horizon must be 1h or 1d")
        now = datetime.now(timezone.utc)
        cutoff_time = now - timedelta(minutes=cutoff_minutes)
        resolved_attr = "resolved_1h" if horizon == "1h" else "resolved_1d"
        price_attr = "price_1h_after" if horizon == "1h" else "price_1d_after"
        outcome_attr = "outcome_1h" if horizon == "1h" else "outcome_1d"
        updated = 0
        for item in self._scan_all():
            if not item.get("signal_id"):
                continue
            if item.get(resolved_attr):
                continue
            gen = datetime.fromisoformat(str(item["generated_at"]).replace("Z", "+00:00"))
            if gen.tzinfo is None:
                gen = gen.replace(tzinfo=timezone.utc)
            if gen > cutoff_time:
                continue
            sym = str(item["symbol"]).upper()
            price_after = await polygon.get_evaluated_price_after_signal(sym, gen, horizon=horizon)
            if price_after is None:
                continue
            price_at = float(item["price_at_signal"])
            direction = str(item["direction"])
            outcome = outcome_from_prices(direction, price_at, float(price_after))
            try:
                self._table.update_item(
                    Key={"signal_id": item["signal_id"]},
                    UpdateExpression=(
                        f"SET #{price_attr} = :p, #{outcome_attr} = :o, #{resolved_attr} = :r"
                    ),
                    ExpressionAttributeNames={
                        f"#{price_attr}": price_attr,
                        f"#{outcome_attr}": outcome_attr,
                        f"#{resolved_attr}": resolved_attr,
                    },
                    ExpressionAttributeValues={
                        ":p": Decimal(str(float(price_after))),
                        ":o": outcome,
                        ":r": True,
                    },
                )
            except ClientError as exc:
                log.warning("resolve update failed signal_id=%s: %s", item.get("signal_id"), exc)
                continue
            updated += 1
        return updated


def _tracked_outcome_summary(outcome_1d: str | None, outcome_1h: str | None) -> str:
    """Single summary label for API consumers: prefer 1d horizon, then 1h; values are correct|incorrect|neutral|pending."""
    o = outcome_1d if outcome_1d is not None else outcome_1h
    if o in ("correct", "incorrect", "neutral"):
        return o
    return "pending"


def _public_api_shape(rec: SignalRecord) -> dict[str, Any]:
    from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER

    ts = rec.generated_at.astimezone(timezone.utc).isoformat()
    strength = float(rec.signal_strength)
    return {
        "signal_id": rec.signal_id,
        "symbol": rec.symbol.upper(),
        "direction": rec.direction,
        "signal_strength": strength,
        "pattern": rec.pattern,
        "layer_scores": dict(rec.layer_scores),
        "price_at_signal": rec.price_at_signal,
        "timestamp_iso": ts,
        "generated_at": ts,
        "resolved_1h": rec.resolved_1h,
        "resolved_1d": rec.resolved_1d,
        "price_1h_after": rec.price_1h_after,
        "price_1d_after": rec.price_1d_after,
        "outcome_1h": rec.outcome_1h,
        "outcome_1d": rec.outcome_1d,
        "outcome": _tracked_outcome_summary(rec.outcome_1d, rec.outcome_1h),
        "disclaimer": API_SIGNAL_DISCLAIMER,
    }


def public_signal_detail_dict(rec: SignalRecord) -> dict[str, Any]:
    """API payload for a single signal row (outcome tracking transparency)."""
    out = _public_api_shape(rec)
    out["signal_scope"] = "platform" if rec.user_id is None else "user"
    return out


_LANDING_LAYER_KEYS: tuple[str, ...] = (
    "technical",
    "news",
    "macro",
    "sector",
    "geopolitical",
    "internals",
)


def _normalize_landing_layer_scores(rec: SignalRecord) -> dict[str, int]:
    raw = {str(k).lower(): float(v) for k, v in rec.layer_scores.items()}
    out: dict[str, int] = {}
    for key in _LANDING_LAYER_KEYS:
        v = raw.get(key)
        if v is None and key == "geopolitical":
            v = raw.get("geo")
        if v is None:
            v = 50.0
        n = int(round(max(0.0, min(100.0, v))))
        out[key] = n
    return out


def _truncate_landing_ai_summary(text: str | None, *, max_len: int = 120) -> str | None:
    if text is None:
        return None
    t = str(text).strip()
    if not t:
        return None
    if len(t) <= max_len:
        return t
    return t[: max_len - 3].rstrip() + "..."


def _landing_api_shape(rec: SignalRecord) -> dict[str, Any]:
    from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER

    ts = rec.generated_at.astimezone(timezone.utc).isoformat()
    return {
        "symbol": rec.symbol.upper(),
        "direction": rec.direction,
        "signal_strength": int(rec.signal_strength),
        "pattern": rec.pattern,
        "generated_at": ts,
        "layer_scores": _normalize_landing_layer_scores(rec),
        "outcome_1h": rec.outcome_1h,
        "price_at_signal": float(rec.price_at_signal),
        "price_1h_after": float(rec.price_1h_after) if rec.price_1h_after is not None else None,
        "ai_summary": _truncate_landing_ai_summary(rec.ai_summary, max_len=120),
        "disclaimer": API_SIGNAL_DISCLAIMER,
    }


def performance_summary_from_records(records: list[SignalRecord]) -> dict[str, Any]:
    from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER

    launch_date = _et_today()
    if records:
        launch_date = min(_signal_calendar_date_et(r) for r in records)

    evaluated: list[SignalRecord] = [r for r in records if r.outcome_1d is not None]
    correct = sum(1 for r in evaluated if r.outcome_1d == "correct")
    incorrect = sum(1 for r in evaluated if r.outcome_1d == "incorrect")
    neutral = sum(1 for r in evaluated if r.outcome_1d == "neutral")
    denom = correct + incorrect
    accuracy = round((correct / denom) * 100.0, 1) if denom > 0 else 0.0
    days = max(0, (_et_today() - launch_date).days)

    return {
        "total_signals_tracked": len(records),
        "signals_evaluated": len(evaluated),
        "correct_direction_count": correct,
        "incorrect_direction_count": incorrect,
        "neutral_direction_count": neutral,
        "directional_accuracy_percent": accuracy,
        "launch_date": launch_date.isoformat(),
        "date_range_days": days,
        "disclaimer": API_SIGNAL_DISCLAIMER,
    }


_recorder: InMemorySignalRecorder | DynamoDBSignalRecorder | None = None


def get_signal_recorder() -> InMemorySignalRecorder | DynamoDBSignalRecorder:
    global _recorder
    if _recorder is not None:
        return _recorder
    settings = get_settings()
    if settings.dynamodb_signal_history_table.strip():
        _recorder = DynamoDBSignalRecorder.from_settings()
    else:
        if settings.is_production:
            raise ValueError("DYNAMODB_SIGNAL_HISTORY_TABLE must be set in production.")
        _recorder = InMemorySignalRecorder()
        log.warning("Using in-memory signal recorder (no DYNAMODB_SIGNAL_HISTORY_TABLE).")
    return _recorder


def reset_signal_recorder_for_tests() -> None:
    global _recorder
    _recorder = None
