"""Debounced CloudWatch metrics when gap-intel scenario builder enters DISABLED."""

from __future__ import annotations

import time
from typing import Any

import boto3
from botocore.exceptions import ClientError

from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_METRIC_NAMESPACE = "Stocvest/GapIntel"
_DEBOUNCE_SEC = 3600


def _scenario_builder_state(body: dict[str, Any]) -> str:
    sb = body.get("scenario_builder")
    if not isinstance(sb, dict):
        return ""
    return str(sb.get("state") or "")


def next_last_disable_metric_timestamp(
    *,
    old_sb_state: str | None,
    prior_last_disable_metric_at: int | None,
    new_body: dict[str, Any],
    symbol: str,
    trading_mode: str,
) -> int | None:
    """Return the DynamoDB ``lastDisableMetricAt`` value to persist (debounced emit)."""
    new_st = _scenario_builder_state(new_body)
    if new_st != "DISABLED" or old_sb_state == "DISABLED":
        return prior_last_disable_metric_at
    if not old_sb_state or old_sb_state not in ("ENABLED", "LIMITED"):
        return prior_last_disable_metric_at
    now = int(time.time())
    if prior_last_disable_metric_at is not None and now - prior_last_disable_metric_at < _DEBOUNCE_SEC:
        return prior_last_disable_metric_at
    try:
        boto3.client("cloudwatch").put_metric_data(
            Namespace=_METRIC_NAMESPACE,
            MetricData=[
                {
                    "MetricName": "ScenarioBuilderDisabled",
                    "Dimensions": [
                        {"Name": "symbol", "Value": symbol.strip().upper()},
                        {"Name": "trading_mode", "Value": trading_mode.strip().lower()},
                    ],
                    "Value": 1.0,
                    "Unit": "Count",
                }
            ],
        )
    except ClientError as exc:
        _LOG.warning("gap_intel ScenarioBuilderDisabled metric failed: %s", exc)
        return prior_last_disable_metric_at
    return now
