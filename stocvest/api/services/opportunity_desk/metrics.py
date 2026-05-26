"""CloudWatch metrics for Opportunity Desk batch runs (D13 Phase 6)."""

from __future__ import annotations

from typing import Literal

import boto3
from botocore.exceptions import ClientError

from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

METRIC_NAMESPACE = "OpportunityDesk"
DeskBatchTierMetric = Literal["full", "movers"]


def publish_opportunity_desk_batch_metrics(
    *,
    tier: DeskBatchTierMetric,
    duration_ms: float,
    survivor_count: int,
    composite_failures: int,
    scanned_snapshot_count: int,
) -> None:
    """Best-effort custom metrics — never raises."""
    tier_dim = {"Name": "Tier", "Value": tier}
    try:
        boto3.client("cloudwatch").put_metric_data(
            Namespace=METRIC_NAMESPACE,
            MetricData=[
                {
                    "MetricName": "BatchDuration",
                    "Dimensions": [tier_dim],
                    "Value": max(0.0, duration_ms),
                    "Unit": "Milliseconds",
                },
                {
                    "MetricName": "SurvivorCount",
                    "Dimensions": [tier_dim],
                    "Value": float(max(0, survivor_count)),
                    "Unit": "Count",
                },
                {
                    "MetricName": "CompositeFailures",
                    "Dimensions": [tier_dim],
                    "Value": float(max(0, composite_failures)),
                    "Unit": "Count",
                },
                {
                    "MetricName": "ScannedSnapshotCount",
                    "Dimensions": [tier_dim],
                    "Value": float(max(0, scanned_snapshot_count)),
                    "Unit": "Count",
                },
            ],
        )
    except ClientError as exc:
        _LOG.warning("opportunity_desk CloudWatch metrics failed tier=%s: %s", tier, exc)
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("opportunity_desk CloudWatch metrics unexpected tier=%s: %s", tier, exc)
