"""D1: persist signals and resolve outcomes against later prices (DynamoDB or in-memory)."""

from __future__ import annotations

import base64
import json
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

_MAX_HISTORY_QUERY_ROUNDS = 12


def _encode_history_cursor(state: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(state, default=str, separators=(",", ":")).encode("utf-8")).decode("ascii")


def _decode_history_cursor(token: str | None) -> dict[str, Any] | None:
    if not token or not str(token).strip():
        return None
    try:
        raw = base64.urlsafe_b64decode(str(token).strip().encode("ascii"))
        d = json.loads(raw.decode("utf-8"))
        return d if isinstance(d, dict) else None
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None


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
    if rec.status != "active":
        item["status"] = rec.status
    item["mode"] = rec.mode
    item["ledger_qualified"] = bool(rec.ledger_qualified)
    if rec.closed_at is not None:
        item["closed_at"] = rec.closed_at.astimezone(timezone.utc).isoformat()
    if rec.ledger_entry_date_et:
        item["ledger_entry_date_et"] = rec.ledger_entry_date_et
    if rec.ledger_exit_date_et:
        item["ledger_exit_date_et"] = rec.ledger_exit_date_et
    if rec.entry_rationale:
        item["entry_rationale"] = rec.entry_rationale
    if rec.exit_reason:
        item["exit_reason"] = rec.exit_reason
    if rec.decision_state_entry:
        item["decision_state_entry"] = rec.decision_state_entry
    if rec.decision_state_exit:
        item["decision_state_exit"] = rec.decision_state_exit
    if rec.market_regime_exit:
        item["market_regime_exit"] = rec.market_regime_exit
    if rec.gate_status_json:
        item["gate_status_json"] = rec.gate_status_json
    if rec.setup_type:
        item["setup_type"] = rec.setup_type
    if rec.exit_rule:
        item["exit_rule"] = rec.exit_rule
    if rec.max_adverse_excursion_pct is not None:
        item["max_adverse_excursion_pct"] = Decimal(str(rec.max_adverse_excursion_pct))
    if rec.max_favorable_excursion_pct is not None:
        item["max_favorable_excursion_pct"] = Decimal(str(rec.max_favorable_excursion_pct))
    if rec.hold_duration_minutes is not None:
        item["hold_duration_minutes"] = int(rec.hold_duration_minutes)
    if rec.stop_level is not None:
        item["stop_level"] = Decimal(str(rec.stop_level))
    if rec.reference_structure_level is not None:
        item["reference_structure_level"] = Decimal(str(rec.reference_structure_level))
    if rec.regime_label_at_entry:
        item["regime_label_at_entry"] = rec.regime_label_at_entry
    if rec.sector_label_at_entry:
        item["sector_label_at_entry"] = rec.sector_label_at_entry
    if rec.vwap_state_at_entry:
        item["vwap_state_at_entry"] = rec.vwap_state_at_entry
    if rec.regime_window_key:
        item["regime_window_key"] = rec.regime_window_key
    if rec.ledger_position_open is not None:
        item["ledger_position_open"] = bool(rec.ledger_position_open)
    if rec.validation_outcome:
        item["validation_outcome"] = rec.validation_outcome
    return item


def _item_to_record(item: dict[str, Any]) -> SignalRecord:
    return SignalRecord.from_dynamo_item(item)


def _item_ledger_validation_still_open(it: dict[str, Any]) -> bool:
    """Whether this row is a user validation ledger position waiting for rule-based closure."""
    lq = it.get("ledger_qualified")
    ledger_ok = lq is True or lq == 1 or (isinstance(lq, Decimal) and int(lq) == 1) or str(lq).lower() == "true"
    if not ledger_ok or not it.get("user_id"):
        return False
    if it.get("closed_at"):
        return False
    lpo = it.get("ledger_position_open")
    if lpo is None:
        return True
    if lpo is False or str(lpo).lower() == "false" or (isinstance(lpo, Decimal) and int(lpo) == 0):
        return False
    return True


def _validation_label_from_directional_outcome(outcome: str) -> str:
    o = str(outcome or "").strip().lower()
    if o == "correct":
        return "favorable"
    if o == "incorrect":
        return "unfavorable"
    return "neutral"


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
        rows = [it for it in rows if str(it.get("status") or "active") == "active"]
        rows.sort(key=lambda x: str(x.get("generated_at") or ""), reverse=True)
        return [_public_api_shape(_item_to_record(r)) for r in rows[:limit]]

    def get_public_landing_items(self, *, limit: int = 5) -> list[dict[str, Any]]:
        rows = [it for it in self._items.values() if it.get("scope_key") == "PUBLIC"]
        rows = [it for it in rows if str(it.get("status") or "active") == "active"]
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
        mode: str | None = None,
        ledger_qualified_only: bool = False,
    ) -> list[SignalRecord]:
        rows, _ = self.get_user_signal_history_page(
            user_id=user_id,
            symbol=symbol,
            days=days,
            page_size=limit,
            mode=mode,
            ledger_qualified_only=ledger_qualified_only,
            cursor=None,
        )
        return rows[:limit]

    def get_user_signal_history_page(
        self,
        *,
        user_id: str | None,
        symbol: str | None = None,
        days: int = 30,
        page_size: int = 25,
        mode: str | None = None,
        ledger_qualified_only: bool = True,
        cursor: str | None = None,
    ) -> tuple[list[SignalRecord], str | None]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
        sym_filter = symbol.strip().upper() if symbol else None
        mode_filter = mode.strip().lower() if mode else None
        if mode_filter not in (None, "", "day", "swing"):
            mode_filter = None
        scope = _scope_key(user_id)
        skip = 0
        if cursor and cursor.startswith("mem:"):
            try:
                skip = max(0, int(cursor[4:]))
            except ValueError:
                skip = 0
        out_all: list[SignalRecord] = []
        for it in self._items.values():
            if it.get("scope_key") != scope:
                continue
            rec = _item_to_record(it)
            if rec.generated_at < cutoff:
                continue
            if sym_filter and rec.symbol.upper() != sym_filter:
                continue
            if mode_filter and rec.mode != mode_filter:
                continue
            if ledger_qualified_only and not rec.ledger_qualified:
                continue
            out_all.append(rec)
        out_all.sort(key=lambda r: r.generated_at, reverse=True)
        page = out_all[skip : skip + page_size]
        next_cur = f"mem:{skip + page_size}" if skip + page_size < len(out_all) else None
        return page, next_cur

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

    def list_raw_signal_items(self) -> list[dict[str, Any]]:
        """In-memory store snapshot for batched resolution (mirrors DynamoDB recorder API)."""
        return [it for it in self._items.values() if isinstance(it, dict)]

    async def resolve_signals(
        self,
        cutoff_minutes: int,
        polygon: SignalOutcomePriceSource,
        *,
        horizon: str,
        items: list[dict[str, Any]] | None = None,
    ) -> int:
        if horizon not in {"1h", "1d"}:
            raise ValueError("horizon must be 1h or 1d")
        now = datetime.now(timezone.utc)
        cutoff_time = now - timedelta(minutes=cutoff_minutes)
        resolved_attr = "resolved_1h" if horizon == "1h" else "resolved_1d"
        price_attr = "price_1h_after" if horizon == "1h" else "price_1d_after"
        outcome_attr = "outcome_1h" if horizon == "1h" else "outcome_1d"
        updated = 0
        source = list(self._items.values()) if items is None else items
        for it in source:
            if _item_ledger_validation_still_open(it):
                continue
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
            sid = str(it.get("signal_id") or "")
            if not sid:
                continue
            it[price_attr] = Decimal(str(float(price_after)))
            it[outcome_attr] = outcome
            it[resolved_attr] = True
            self._items[sid] = it
            updated += 1
        return updated

    def has_open_validation_position(self, user_id: str, symbol: str, mode: str) -> bool:
        scope = _scope_key(user_id.strip())
        sym_u = symbol.strip().upper()
        m = mode.strip().lower()
        if m not in ("day", "swing"):
            return False
        for it in self._items.values():
            if it.get("scope_key") != scope:
                continue
            if str(it.get("symbol") or "").upper() != sym_u:
                continue
            if str(it.get("mode") or "day") != m:
                continue
            if _item_ledger_validation_still_open(it):
                return True
        return False

    def close_validation_position(
        self,
        *,
        signal_id: str,
        exit_price: float,
        exit_rule: str,
        exit_reason: str,
        mode: str,
        now: datetime,
        market_regime_exit: str | None = None,
    ) -> bool:
        sid = signal_id.strip()
        it = self._items.get(sid)
        if not isinstance(it, dict):
            return False
        if it.get("closed_at"):
            return False
        if not _item_ledger_validation_still_open(it):
            return False
        gen = datetime.fromisoformat(str(it["generated_at"]).replace("Z", "+00:00"))
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)
        direction = str(it["direction"])
        outcome = outcome_from_prices(direction, float(it["price_at_signal"]), float(exit_price))
        val = _validation_label_from_directional_outcome(outcome)
        mo = mode.strip().lower()
        if mo == "swing":
            it["price_1d_after"] = Decimal(str(float(exit_price)))
            it["resolved_1d"] = True
            it["outcome_1d"] = outcome
        else:
            it["price_1h_after"] = Decimal(str(float(exit_price)))
            it["resolved_1h"] = True
            it["outcome_1h"] = outcome
        it["closed_at"] = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        it["ledger_position_open"] = False
        it["exit_rule"] = exit_rule
        it["exit_reason"] = exit_reason
        it["ledger_exit_date_et"] = now.astimezone(_ET).date().isoformat()
        it["hold_duration_minutes"] = int((now - gen).total_seconds() // 60)
        it["decision_state_exit"] = "rule_based_exit"
        it["validation_outcome"] = val
        if market_regime_exit:
            it["market_regime_exit"] = market_regime_exit
        self._items[sid] = it
        return True

    def iter_open_validation_records(self) -> list[SignalRecord]:
        return [
            _item_to_record(it)
            for it in self._items.values()
            if isinstance(it, dict) and _item_ledger_validation_still_open(it)
        ]


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
        records = [r for r in records if r.status == "active"]
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
            if rec.status != "active":
                continue
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
        mode: str | None = None,
        ledger_qualified_only: bool = False,
    ) -> list[SignalRecord]:
        rows, _ = self.get_user_signal_history_page(
            user_id=user_id,
            symbol=symbol,
            days=days,
            page_size=limit,
            mode=mode,
            ledger_qualified_only=ledger_qualified_only,
            cursor=None,
        )
        return rows[:limit]

    def get_user_signal_history_page(
        self,
        *,
        user_id: str | None,
        symbol: str | None = None,
        days: int = 30,
        page_size: int = 25,
        mode: str | None = None,
        ledger_qualified_only: bool = True,
        cursor: str | None = None,
    ) -> tuple[list[SignalRecord], str | None]:
        from boto3.dynamodb.conditions import Key

        scope = _scope_key(user_id)
        mode_filter = mode.strip().lower() if mode else None
        if mode_filter not in (None, "", "day", "swing"):
            mode_filter = None
        sym_filter = symbol.strip().upper() if symbol else None
        cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
        cutoff_iso = cutoff.replace(microsecond=0).isoformat().replace("+00:00", "Z")

        st = _decode_history_cursor(cursor) or {}
        batch_start_key: dict[str, Any] | None = st.get("start_key")
        if batch_start_key is not None and not isinstance(batch_start_key, dict):
            batch_start_key = None
        try:
            skip = max(0, int(st.get("skip", 0)))
        except (TypeError, ValueError):
            skip = 0

        collected: list[SignalRecord] = []
        rounds = 0
        start_key_for_batch: dict[str, Any] | None = batch_start_key

        while len(collected) < page_size and rounds < _MAX_HISTORY_QUERY_ROUNDS:
            rounds += 1
            qkwargs: dict[str, Any] = {
                "IndexName": GSI_NAME,
                "KeyConditionExpression": Key("scope_key").eq(scope) & Key("generated_at").gte(cutoff_iso),
                "ScanIndexForward": False,
                "Limit": max(page_size * 3, 40),
            }
            if start_key_for_batch:
                qkwargs["ExclusiveStartKey"] = start_key_for_batch
            try:
                resp = self._table.query(**qkwargs)
            except ClientError as exc:
                code = str((exc.response or {}).get("Error", {}).get("Code", ""))
                if code in {"ResourceNotFoundException", "ValidationException"}:
                    return [], None
                raise
            items = [x for x in (resp.get("Items") or []) if isinstance(x, dict)]
            dynamo_next = resp.get("LastEvaluatedKey")
            query_start = start_key_for_batch

            i = skip
            skip = 0
            while i < len(items) and len(collected) < page_size:
                raw = items[i]
                i += 1
                rec = _item_to_record(raw)
                if sym_filter and rec.symbol.upper() != sym_filter:
                    continue
                if mode_filter and rec.mode != mode_filter:
                    continue
                if ledger_qualified_only and not rec.ledger_qualified:
                    continue
                collected.append(rec)

            if len(collected) >= page_size:
                if i < len(items):
                    return collected[:page_size], _encode_history_cursor({"start_key": query_start, "skip": i})
                if dynamo_next:
                    return collected[:page_size], _encode_history_cursor({"start_key": dynamo_next, "skip": 0})
                return collected[:page_size], None

            if not dynamo_next:
                break
            start_key_for_batch = dynamo_next

        return collected, None

    def iter_public_records(self) -> list[SignalRecord]:
        return [
            _item_to_record(x)
            for x in self._scan_all()
            if isinstance(x, dict) and x.get("scope_key") == "PUBLIC" and str(x.get("status") or "active") == "active"
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

    def list_raw_signal_items(self) -> list[dict[str, Any]]:
        """Single DynamoDB scan — reuse for multiple resolution passes in one Lambda invocation."""
        return self._scan_all()

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
        items: list[dict[str, Any]] | None = None,
    ) -> int:
        if horizon not in {"1h", "1d"}:
            raise ValueError("horizon must be 1h or 1d")
        now = datetime.now(timezone.utc)
        cutoff_time = now - timedelta(minutes=cutoff_minutes)
        resolved_attr = "resolved_1h" if horizon == "1h" else "resolved_1d"
        price_attr = "price_1h_after" if horizon == "1h" else "price_1d_after"
        outcome_attr = "outcome_1h" if horizon == "1h" else "outcome_1d"
        updated = 0
        source = self._scan_all() if items is None else items
        for item in source:
            if not item.get("signal_id"):
                continue
            if _item_ledger_validation_still_open(item):
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
            expr_parts = [
                f"#{price_attr} = :p",
                f"#{outcome_attr} = :o",
                f"#{resolved_attr} = :r",
            ]
            names: dict[str, str] = {
                f"#{price_attr}": price_attr,
                f"#{outcome_attr}": outcome_attr,
                f"#{resolved_attr}": resolved_attr,
            }
            vals: dict[str, Any] = {
                ":p": Decimal(str(float(price_after))),
                ":o": outcome,
                ":r": True,
            }
            try:
                self._table.update_item(
                    Key={"signal_id": item["signal_id"]},
                    UpdateExpression="SET " + ", ".join(expr_parts),
                    ExpressionAttributeNames=names,
                    ExpressionAttributeValues=vals,
                )
            except ClientError as exc:
                log.warning("resolve update failed signal_id=%s: %s", item.get("signal_id"), exc)
                continue
            updated += 1
        return updated

    def has_open_validation_position(self, user_id: str, symbol: str, mode: str) -> bool:
        from boto3.dynamodb.conditions import Attr, Key

        scope = _scope_key(user_id.strip())
        sym_u = symbol.strip().upper()
        m = mode.strip().lower()
        if m not in ("day", "swing"):
            return False
        cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=400)).replace(microsecond=0).isoformat().replace(
            "+00:00", "Z"
        )
        kwargs: dict[str, Any] = {
            "IndexName": GSI_NAME,
            "KeyConditionExpression": Key("scope_key").eq(scope) & Key("generated_at").gte(cutoff_iso),
            "FilterExpression": Attr("ledger_qualified").eq(True)
            & Attr("symbol").eq(sym_u)
            & Attr("mode").eq(m)
            & (Attr("ledger_position_open").not_exists() | Attr("ledger_position_open").eq(True))
            & Attr("closed_at").not_exists(),
            "Limit": 5,
        }
        try:
            resp = self._table.query(**kwargs)
        except ClientError as exc:
            log.warning("has_open_validation_position query failed: %s", exc)
            return False
        items = resp.get("Items") or []
        return len(items) > 0

    def close_validation_position(
        self,
        *,
        signal_id: str,
        exit_price: float,
        exit_rule: str,
        exit_reason: str,
        mode: str,
        now: datetime,
        market_regime_exit: str | None = None,
    ) -> bool:
        sid = signal_id.strip()
        try:
            raw = self._table.get_item(Key={"signal_id": sid}).get("Item")
        except ClientError as exc:
            log.warning("close_validation_position get_item failed: %s", exc)
            return False
        if not isinstance(raw, dict):
            return False
        gen = datetime.fromisoformat(str(raw["generated_at"]).replace("Z", "+00:00"))
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)
        direction = str(raw["direction"])
        price_at = float(raw["price_at_signal"])
        outcome = outcome_from_prices(direction, price_at, float(exit_price))
        val = _validation_label_from_directional_outcome(outcome)
        mo = mode.strip().lower()
        names: dict[str, str] = {
            "#ca": "closed_at",
            "#lp": "ledger_position_open",
            "#er": "exit_rule",
            "#exr": "exit_reason",
            "#ld": "ledger_exit_date_et",
            "#hm": "hold_duration_minutes",
            "#dse": "decision_state_exit",
            "#vo": "validation_outcome",
            "#p1h": "price_1h_after",
            "#o1h": "outcome_1h",
            "#r1h": "resolved_1h",
            "#p1d": "price_1d_after",
            "#o1d": "outcome_1d",
            "#r1d": "resolved_1d",
        }
        vals: dict[str, Any] = {
            ":ca": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            ":lp": False,
            ":er": exit_reason,
            ":exr": exit_rule,
            ":ld": now.astimezone(_ET).date().isoformat(),
            ":hm": int((now - gen).total_seconds() // 60),
            ":dse": "rule_based_exit",
            ":vo": val,
            ":p": Decimal(str(float(exit_price))),
            ":o": outcome,
            ":r": True,
        }
        if market_regime_exit:
            names["#mre"] = "market_regime_exit"
            vals[":mre"] = market_regime_exit
        if mo == "swing":
            set_parts = [
                "#p1d = :p",
                "#o1d = :o",
                "#r1d = :r",
                "#ca = :ca",
                "#lp = :lp",
                "#er = :er",
                "#exr = :exr",
                "#ld = :ld",
                "#hm = :hm",
                "#dse = :dse",
                "#vo = :vo",
            ]
        else:
            set_parts = [
                "#p1h = :p",
                "#o1h = :o",
                "#r1h = :r",
                "#ca = :ca",
                "#lp = :lp",
                "#er = :er",
                "#exr = :exr",
                "#ld = :ld",
                "#hm = :hm",
                "#dse = :dse",
                "#vo = :vo",
            ]
        if market_regime_exit:
            set_parts.append("#mre = :mre")
        try:
            self._table.update_item(
                Key={"signal_id": sid},
                UpdateExpression="SET " + ", ".join(set_parts),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=vals,
                ConditionExpression="attribute_not_exists(#ca)",
            )
        except ClientError as exc:
            code = str((exc.response or {}).get("Error", {}).get("Code", ""))
            if code == "ConditionalCheckFailedException":
                return False
            log.warning("close_validation_position update failed: %s", exc)
            return False
        return True

    def iter_open_validation_records(self) -> list[SignalRecord]:
        """Scan (filtered) — suitable for moderate table sizes; consider a sparse GSI if this grows."""
        from boto3.dynamodb.conditions import Attr

        out: list[SignalRecord] = []
        scan_kwargs: dict[str, Any] = {
            "FilterExpression": Attr("ledger_qualified").eq(True)
            & Attr("user_id").exists()
            & Attr("closed_at").not_exists()
            & (Attr("ledger_position_open").not_exists() | Attr("ledger_position_open").eq(True)),
        }
        while True:
            try:
                result = self._table.scan(**scan_kwargs)
            except ClientError as exc:
                log.warning("iter_open_validation_records scan failed: %s", exc)
                break
            for x in result.get("Items") or []:
                if isinstance(x, dict):
                    out.append(_item_to_record(x))
            lek = result.get("LastEvaluatedKey")
            if not lek:
                break
            scan_kwargs["ExclusiveStartKey"] = lek
        return out


def _tracked_outcome_summary(outcome_1d: str | None, outcome_1h: str | None) -> str:
    """Single summary label for API consumers: prefer 1d horizon, then 1h; values are correct|incorrect|neutral|pending."""
    o = outcome_1d if outcome_1d is not None else outcome_1h
    if o in ("correct", "incorrect", "neutral"):
        return o
    return "pending"


def _gate_status_object(gate_status_json: str | None) -> dict[str, Any] | list[Any] | None:
    if not gate_status_json or not str(gate_status_json).strip():
        return None
    try:
        parsed = json.loads(gate_status_json)
        if isinstance(parsed, (dict, list)):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _public_api_shape(rec: SignalRecord) -> dict[str, Any]:
    from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER

    ts = rec.generated_at.astimezone(timezone.utc).isoformat()
    strength = float(rec.signal_strength)
    out: dict[str, Any] = {
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
        "status": rec.status,
        "mode": rec.mode,
        "ledger_qualified": bool(rec.ledger_qualified),
    }
    if rec.closed_at is not None:
        out["closed_at"] = rec.closed_at.astimezone(timezone.utc).isoformat()
    if rec.ledger_entry_date_et:
        out["ledger_entry_date_et"] = rec.ledger_entry_date_et
    if rec.ledger_exit_date_et:
        out["ledger_exit_date_et"] = rec.ledger_exit_date_et
    if rec.entry_rationale:
        out["entry_rationale"] = rec.entry_rationale
    if rec.exit_reason:
        out["exit_reason"] = rec.exit_reason
    if rec.decision_state_entry:
        out["decision_state_entry"] = rec.decision_state_entry
    if rec.decision_state_exit:
        out["decision_state_exit"] = rec.decision_state_exit
    if rec.market_regime_exit:
        out["market_regime_exit"] = rec.market_regime_exit
    gs = _gate_status_object(rec.gate_status_json)
    if gs is not None:
        out["gate_status"] = gs
    if rec.setup_type:
        out["setup_type"] = rec.setup_type
    if rec.exit_rule:
        out["exit_rule"] = rec.exit_rule
    if rec.max_adverse_excursion_pct is not None:
        out["max_adverse_excursion_pct"] = float(rec.max_adverse_excursion_pct)
    if rec.max_favorable_excursion_pct is not None:
        out["max_favorable_excursion_pct"] = float(rec.max_favorable_excursion_pct)
    if rec.hold_duration_minutes is not None:
        out["hold_duration_minutes"] = int(rec.hold_duration_minutes)
    if rec.parameter_version:
        out["parameter_version"] = rec.parameter_version
        out["logic_version_id"] = rec.parameter_version
    if rec.stop_level is not None:
        out["stop_level"] = float(rec.stop_level)
    if rec.reference_structure_level is not None:
        out["reference_structure_level"] = float(rec.reference_structure_level)
    if rec.regime_label_at_entry:
        out["regime_label_at_entry"] = rec.regime_label_at_entry
    if rec.sector_label_at_entry:
        out["sector_label_at_entry"] = rec.sector_label_at_entry
    if rec.vwap_state_at_entry:
        out["vwap_state_at_entry"] = rec.vwap_state_at_entry
    if rec.regime_window_key:
        out["regime_window_key"] = rec.regime_window_key
    if rec.ledger_position_open is not None:
        out["ledger_position_open"] = bool(rec.ledger_position_open)
    if rec.validation_outcome:
        out["validation_outcome"] = rec.validation_outcome
    return out


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
