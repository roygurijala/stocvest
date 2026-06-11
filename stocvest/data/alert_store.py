"""User alert preferences + delivery history in DynamoDB ``Alerts`` table (SK ``preferences`` or ``hist#…``)."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from stocvest.data.models import AlertChannel, AlertPreferences, AlertRecord, AlertStatus, AlertType
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_ET = ZoneInfo("America/New_York")
PREFS_ALERT_ID = "preferences"
HIST_PREFIX = "hist#"
_HISTORY_TTL_SECONDS = 90 * 86400


def _defaults(user_id: str) -> AlertPreferences:
    return AlertPreferences(user_id=user_id)


def _parse_alert_created_at(created_at: str) -> datetime | None:
    if not created_at or not str(created_at).strip():
        return None
    raw = str(created_at).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _et_calendar_date(utc_dt: datetime) -> date:
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=timezone.utc)
    return utc_dt.astimezone(_ET).date()


def _maturation_transition_tuple_from_body(body: str) -> tuple[str, str, str] | None:
    """Parse stored ``preview_context_json`` body; return ``(mode, previous_state, new_state)`` lowercased."""
    try:
        d = json.loads(body or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    mode = str(d.get("mode") or "").strip().lower()
    prev_s = str(d.get("previous_state") or "").strip().lower()
    new_s = str(d.get("new_state") or "").strip().lower()
    if not mode or not prev_s or not new_s:
        return None
    return (mode, prev_s, new_s)


class DynamoDBAlertStore(Protocol):
    def get_preferences(self, user_id: str) -> AlertPreferences: ...
    def save_preferences(self, user_id: str, prefs: AlertPreferences) -> AlertPreferences: ...
    def create_alert_record(self, record: AlertRecord) -> AlertRecord: ...
    def get_recent_alerts(self, user_id: str, limit: int = 20) -> list[AlertRecord]: ...
    def had_signal_email_for_symbol_within_hours(
        self, user_id: str, symbol: str, *, hours: float = 4.0
    ) -> bool: ...
    def had_watchlist_maturation_email_for_symbol_within_hours(
        self, user_id: str, symbol: str, *, hours: float = 24.0
    ) -> bool: ...
    def had_watchlist_maturation_email_for_symbol_on_et_calendar_day(
        self, user_id: str, symbol: str, *, reference_utc: datetime | None = None
    ) -> bool: ...
    def had_watchlist_maturation_transition_on_et_calendar_day(
        self,
        user_id: str,
        symbol: str,
        mode: str,
        previous_state: str,
        new_state: str,
        *,
        reference_utc: datetime | None = None,
    ) -> bool: ...


@dataclass
class InMemoryAlertStore:
    prefs: dict[str, AlertPreferences] = field(default_factory=dict)
    history: dict[str, list[AlertRecord]] = field(default_factory=dict)

    def get_preferences(self, user_id: str) -> AlertPreferences:
        return self.prefs.get(user_id) or _defaults(user_id)

    def save_preferences(self, user_id: str, prefs: AlertPreferences) -> AlertPreferences:
        merged = prefs.model_copy(update={"user_id": user_id})
        self.prefs[user_id] = merged
        return merged

    def create_alert_record(self, record: AlertRecord) -> AlertRecord:
        self.history.setdefault(record.user_id, []).insert(0, record)
        self.history[record.user_id] = self.history[record.user_id][:50]
        return record

    def get_recent_alerts(self, user_id: str, limit: int = 20) -> list[AlertRecord]:
        return list(self.history.get(user_id, [])[:limit])

    def had_signal_email_for_symbol_within_hours(
        self, user_id: str, symbol: str, *, hours: float = 4.0
    ) -> bool:
        sym_u = symbol.strip().upper()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        for rec in self.history.get(user_id, [])[:50]:
            if rec.symbol != sym_u:
                continue
            if rec.alert_type not in (AlertType.SIGNAL_FIRED, AlertType.CONFLUENCE_ALERT):
                continue
            ts = _parse_alert_created_at(rec.created_at)
            if ts is not None and ts >= cutoff:
                return True
        return False

    def had_watchlist_maturation_email_for_symbol_within_hours(
        self, user_id: str, symbol: str, *, hours: float = 24.0
    ) -> bool:
        sym_u = symbol.strip().upper()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        for rec in self.history.get(user_id, [])[:50]:
            if rec.symbol != sym_u:
                continue
            if rec.alert_type != AlertType.WATCHLIST_MATURATION:
                continue
            ts = _parse_alert_created_at(rec.created_at)
            if ts is not None and ts >= cutoff:
                return True
        return False

    def had_watchlist_maturation_email_for_symbol_on_et_calendar_day(
        self, user_id: str, symbol: str, *, reference_utc: datetime | None = None
    ) -> bool:
        sym_u = symbol.strip().upper()
        ref = reference_utc if reference_utc is not None else datetime.now(timezone.utc)
        target = _et_calendar_date(ref)
        for rec in self.history.get(user_id, [])[:50]:
            if rec.symbol != sym_u:
                continue
            if rec.alert_type != AlertType.WATCHLIST_MATURATION:
                continue
            ts = _parse_alert_created_at(rec.created_at)
            if ts is not None and _et_calendar_date(ts) == target:
                return True
        return False

    def had_watchlist_maturation_transition_on_et_calendar_day(
        self,
        user_id: str,
        symbol: str,
        mode: str,
        previous_state: str,
        new_state: str,
        *,
        reference_utc: datetime | None = None,
    ) -> bool:
        sym_u = symbol.strip().upper()
        mode_l = mode.strip().lower()
        prev_l = previous_state.strip().lower()
        new_l = new_state.strip().lower()
        ref = reference_utc if reference_utc is not None else datetime.now(timezone.utc)
        target = _et_calendar_date(ref)
        for rec in self.history.get(user_id, [])[:50]:
            if rec.symbol != sym_u or rec.alert_type != AlertType.WATCHLIST_MATURATION:
                continue
            ts = _parse_alert_created_at(rec.created_at)
            if ts is None or _et_calendar_date(ts) != target:
                continue
            tup = _maturation_transition_tuple_from_body(rec.body)
            if tup == (mode_l, prev_l, new_l):
                return True
        return False


@dataclass
class DynamoDBUserAlertStore:
    table: Any

    def get_preferences(self, user_id: str) -> AlertPreferences:
        out = self.table.get_item(Key={"userId": user_id, "alertId": PREFS_ALERT_ID})
        it = out.get("Item")
        if not it:
            return _defaults(user_id)
        return AlertPreferences(
            user_id=user_id,
            email_enabled=bool(it.get("emailEnabled", True)),
            on_signal_fired=bool(it.get("onSignalFired", True)),
            on_confluence_alert=bool(it.get("onConfluenceAlert", True)),
            on_pdt_warning=bool(it.get("onPdtWarning", True)),
            on_pdt_blocked=bool(it.get("onPdtBlocked", True)),
            on_gap_detected=bool(it.get("onGapDetected", False)),
            on_watchlist_maturation=bool(it.get("onWatchlistMaturation", True)),
            on_execution_actionable=bool(it.get("onExecutionActionable", True)),
            watchlist_only=bool(it.get("watchlistOnly", True)),
            quiet_hours_enabled=bool(it.get("quietHoursEnabled", False)),
            quiet_hours_start=str(it.get("quietHoursStart") or "22:00"),
            quiet_hours_end=str(it.get("quietHoursEnd") or "07:00"),
        )

    def save_preferences(self, user_id: str, prefs: AlertPreferences) -> AlertPreferences:
        item = {
            "userId": user_id,
            "alertId": PREFS_ALERT_ID,
            "emailEnabled": prefs.email_enabled,
            "onSignalFired": prefs.on_signal_fired,
            "onConfluenceAlert": prefs.on_confluence_alert,
            "onPdtWarning": prefs.on_pdt_warning,
            "onPdtBlocked": prefs.on_pdt_blocked,
            "onGapDetected": prefs.on_gap_detected,
            "onWatchlistMaturation": prefs.on_watchlist_maturation,
            "onExecutionActionable": prefs.on_execution_actionable,
            "watchlistOnly": prefs.watchlist_only,
            "quietHoursEnabled": prefs.quiet_hours_enabled,
            "quietHoursStart": prefs.quiet_hours_start,
            "quietHoursEnd": prefs.quiet_hours_end,
        }
        self.table.put_item(Item=item)
        return prefs.model_copy(update={"user_id": user_id})

    def create_alert_record(self, record: AlertRecord) -> AlertRecord:
        now = int(time.time())
        item: dict[str, Any] = {
            "userId": record.user_id,
            "alertId": record.alert_id,
            "title": record.title[:500],
            "body": record.body[:49000],
            "alertType": record.alert_type.value,
            "channel": record.channel.value,
            "status": record.status.value,
            "createdAt": record.created_at,
            "sentAt": record.sent_at,
            "error": record.error,
            "expiresAt": now + _HISTORY_TTL_SECONDS,
        }
        if record.symbol:
            item["symbol"] = record.symbol.upper()
        self.table.put_item(Item=item)
        return record

    def get_recent_alerts(self, user_id: str, limit: int = 20) -> list[AlertRecord]:
        resp = self.table.query(
            KeyConditionExpression="userId = :u AND begins_with(alertId, :p)",
            ExpressionAttributeValues={":u": user_id, ":p": HIST_PREFIX},
            Limit=min(50, max(1, limit)),
            ScanIndexForward=False,
        )
        items = resp.get("Items") or []
        out: list[AlertRecord] = []
        for it in items:
            try:
                out.append(
                    AlertRecord(
                        alert_id=str(it.get("alertId") or ""),
                        user_id=user_id,
                        alert_type=AlertType(str(it.get("alertType") or "signal_fired")),
                        channel=AlertChannel(str(it.get("channel") or "email")),
                        symbol=str(it["symbol"]).upper() if it.get("symbol") else None,
                        title=str(it.get("title") or ""),
                        body=str(it.get("body") or ""),
                        status=AlertStatus(str(it.get("status") or "sent")),
                        created_at=str(it.get("createdAt") or ""),
                        sent_at=str(it["sentAt"]) if it.get("sentAt") else None,
                        error=str(it["error"]) if it.get("error") else None,
                    )
                )
            except (TypeError, ValueError):
                continue
        return out[:limit]

    def had_signal_email_for_symbol_within_hours(
        self, user_id: str, symbol: str, *, hours: float = 4.0
    ) -> bool:
        sym_u = symbol.strip().upper()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        recent = self.get_recent_alerts(user_id, limit=50)
        for rec in recent:
            if rec.symbol != sym_u:
                continue
            if rec.alert_type not in (AlertType.SIGNAL_FIRED, AlertType.CONFLUENCE_ALERT):
                continue
            ts = _parse_alert_created_at(rec.created_at)
            if ts is not None and ts >= cutoff:
                return True
        return False

    def had_watchlist_maturation_email_for_symbol_within_hours(
        self, user_id: str, symbol: str, *, hours: float = 24.0
    ) -> bool:
        sym_u = symbol.strip().upper()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        recent = self.get_recent_alerts(user_id, limit=50)
        for rec in recent:
            if rec.symbol != sym_u:
                continue
            if rec.alert_type != AlertType.WATCHLIST_MATURATION:
                continue
            ts = _parse_alert_created_at(rec.created_at)
            if ts is not None and ts >= cutoff:
                return True
        return False

    def had_watchlist_maturation_email_for_symbol_on_et_calendar_day(
        self, user_id: str, symbol: str, *, reference_utc: datetime | None = None
    ) -> bool:
        sym_u = symbol.strip().upper()
        ref = reference_utc if reference_utc is not None else datetime.now(timezone.utc)
        target = _et_calendar_date(ref)
        recent = self.get_recent_alerts(user_id, limit=50)
        for rec in recent:
            if rec.symbol != sym_u:
                continue
            if rec.alert_type != AlertType.WATCHLIST_MATURATION:
                continue
            ts = _parse_alert_created_at(rec.created_at)
            if ts is not None and _et_calendar_date(ts) == target:
                return True
        return False

    def had_watchlist_maturation_transition_on_et_calendar_day(
        self,
        user_id: str,
        symbol: str,
        mode: str,
        previous_state: str,
        new_state: str,
        *,
        reference_utc: datetime | None = None,
    ) -> bool:
        sym_u = symbol.strip().upper()
        mode_l = mode.strip().lower()
        prev_l = previous_state.strip().lower()
        new_l = new_state.strip().lower()
        ref = reference_utc if reference_utc is not None else datetime.now(timezone.utc)
        target = _et_calendar_date(ref)
        recent = self.get_recent_alerts(user_id, limit=50)
        for rec in recent:
            if rec.symbol != sym_u or rec.alert_type != AlertType.WATCHLIST_MATURATION:
                continue
            ts = _parse_alert_created_at(rec.created_at)
            if ts is None or _et_calendar_date(ts) != target:
                continue
            tup = _maturation_transition_tuple_from_body(rec.body)
            if tup == (mode_l, prev_l, new_l):
                return True
        return False


_in_memory_alerts: InMemoryAlertStore | None = None
_dynamo_alerts: DynamoDBUserAlertStore | None = None


def get_in_memory_alert_store() -> InMemoryAlertStore:
    global _in_memory_alerts
    if _in_memory_alerts is None:
        _in_memory_alerts = InMemoryAlertStore()
    return _in_memory_alerts


def get_alert_store() -> DynamoDBAlertStore:
    global _dynamo_alerts
    settings = get_settings()
    name = settings.dynamodb_alerts.strip()
    if not name:
        return get_in_memory_alert_store()
    if _dynamo_alerts is None:
        import boto3

        kwargs: dict[str, Any] = {"region_name": settings.aws_region}
        if settings.dynamodb_endpoint_url:
            kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
        dynamodb = boto3.resource("dynamodb", **kwargs)
        _dynamo_alerts = DynamoDBUserAlertStore(table=dynamodb.Table(name))
        _LOG.info("user alert store: DynamoDB table=%s", name)
    return _dynamo_alerts


def reset_alert_stores_for_tests() -> None:
    global _in_memory_alerts, _dynamo_alerts
    _in_memory_alerts = None
    _dynamo_alerts = None


def new_history_alert_id() -> str:
    return f"{HIST_PREFIX}{uuid.uuid4()}"
