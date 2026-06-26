"""Best-effort CloudWatch metrics for alert-email delivery health.

Publishes ``Stocvest/Alerts EmailSendOutcome`` (Result=sent|failed) on every alert
email attempt so an outage (provider blocked, token bad, account over limit) surfaces
as a CloudWatch alarm instead of failing silently. Gated to the Lambda runtime so unit
tests and local runs never attempt a network call.
"""

from __future__ import annotations

import os

import boto3
from botocore.exceptions import ClientError

from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

METRIC_NAMESPACE = "Stocvest/Alerts"
METRIC_NAME = "EmailSendOutcome"


def publish_email_send_outcome(*, success: bool) -> None:
    """Emit one EmailSendOutcome data point. Never raises."""
    if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return
    try:
        boto3.client("cloudwatch").put_metric_data(
            Namespace=METRIC_NAMESPACE,
            MetricData=[
                {
                    "MetricName": METRIC_NAME,
                    "Dimensions": [{"Name": "Result", "Value": "sent" if success else "failed"}],
                    "Value": 1.0,
                    "Unit": "Count",
                }
            ],
        )
    except ClientError as exc:
        _LOG.warning("alert email metric publish failed: %s", exc)
    except Exception as exc:  # noqa: BLE001 — telemetry must never break delivery
        _LOG.warning("alert email metric unexpected error: %s", exc)
