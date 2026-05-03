"""User alert preferences + delivery history in DynamoDB ``Alerts`` table (SK ``preferences`` or ``hist#…``)."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol

from stocvest.data.models import AlertChannel, AlertPreferences, AlertRecord, AlertStatus, AlertType
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

PREFS_ALERT_ID = "preferences"
HIST_PREFIX = "hist#"
_HISTORY_TTL_SECONDS = 90 * 86400


def _defaults(user_id: str) -> AlertPreferences:
    return AlertPreferences(user_id=user_id)


class DynamoDBAlertStore(Protocol):
    def get_preferences(self, user_id: str) -> AlertPreferences: ...
    def save_preferences(self, user_id: str, prefs: AlertPreferences) -> AlertPreferences: ...
    def create_alert_record(self, record: AlertRecord) -> AlertRecord: ...
    def get_recent_alerts(self, user_id: str, limit: int = 20) -> list[AlertRecord]: ...


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
