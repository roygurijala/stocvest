"""DynamoDB rows for SignalParameters version history."""

from __future__ import annotations

from typing import Any

import boto3
from botocore.exceptions import ClientError

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def put_parameter_history_version(
    *,
    version: str,
    created_at: str,
    reason: str,
    parameters_json: str,
    signal_count_on_change: int | None,
    accuracy_before_change: float | None,
    changed_by: str = "stocvest-admin",
) -> None:
    """Best-effort write; logs and returns if table not configured or AWS errors."""
    settings = get_settings()
    name = (settings.dynamodb_parameter_history_table or "").strip()
    if not name:
        _LOG.debug("parameter history skipped: DYNAMODB_PARAMETER_HISTORY_TABLE unset")
        return
    item: dict[str, Any] = {
        "version": version,
        "created_at": created_at,
        "reason": reason,
        "parameters": parameters_json,
        "signal_count_on_change": int(signal_count_on_change or 0),
        "accuracy_before_change": float(accuracy_before_change or 0.0),
        "changed_by": changed_by,
    }
    try:
        kwargs: dict[str, Any] = {}
        if settings.dynamodb_endpoint_url:
            kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
        dynamodb = boto3.resource("dynamodb", region_name=settings.aws_region, **kwargs)
        dynamodb.Table(name).put_item(Item=item)
    except ClientError as exc:
        _LOG.warning("parameter history put failed: %s", exc)
