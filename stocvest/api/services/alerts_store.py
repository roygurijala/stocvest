"""Lightweight writes to the DynamoDB ``Alerts`` table (scanner digest rows)."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from stocvest.utils.config import get_settings


SYSTEM_ALERTS_USER_ID = "SYSTEM_SCANNER"


def put_scanner_alert(*, title: str, detail: dict[str, Any], ttl_seconds: int = 7 * 86400) -> str | None:
    """Store a short-lived alert row. Returns ``alert_id`` or ``None`` if alerts table is not configured."""
    settings = get_settings()
    table_name = settings.dynamodb_alerts.strip()
    if not table_name:
        return None
    alert_id = str(uuid.uuid4())
    now = int(time.time())
    import boto3

    kwargs: dict[str, Any] = {"region_name": settings.aws_region}
    if settings.dynamodb_endpoint_url:
        kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
    dynamodb = boto3.resource("dynamodb", **kwargs)
    table = dynamodb.Table(table_name)
    table.put_item(
        Item={
            "userId": SYSTEM_ALERTS_USER_ID,
            "alertId": alert_id,
            "title": title[:500],
            "detailJson": json.dumps(detail, default=str)[:35000],
            "createdAt": now,
            "expiresAt": now + ttl_seconds,
        }
    )
    return alert_id
