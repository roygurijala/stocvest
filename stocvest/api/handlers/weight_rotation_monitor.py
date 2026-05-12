"""D10 Phase 4 — scheduled Lambda that publishes the post-rotation accuracy delta.

Invoked by EventBridge daily (cron defined in
``infra/lambda_weight_rotation_monitor.tf``). Each run:

1. Reads the **current** live ``parameter_version`` from
   :class:`ParameterStore` (read-only — this Lambda's IAM role has NO
   ``secretsmanager:UpdateSecret``, same security posture as the
   Phase-2b weight-proposer worker).
2. Reads the **previous** ``parameter_version`` from
   ``ParameterHistory`` — that is, the second-most-recent row by
   ``created_at`` (the most-recent row IS the current live version
   since :meth:`save_parameters_sync` writes one row per rotation).
3. Hands both to :func:`evaluate_post_rotation_accuracy` to compute a
   :class:`DegradationResult` from the trailing 14-day window of the
   live ``SignalHistory``.
4. Publishes a single CloudWatch custom metric
   ``Stocvest/Signals/PostRotationAccuracyDelta`` (unit: ``None`` /
   raw percentage points) so the alarm defined in Terraform can fire
   when the value crosses the configured threshold. Status-tagged
   dimensions ensure the alarm only triggers on ``degraded`` runs —
   ``ok`` / ``insufficient_sample`` / ``baseline_unavailable`` runs
   publish their metric so dashboards stay populated but do not
   threshold-breach by themselves.

The handler always returns HTTP 200 — even on internal failure — so
EventBridge does not retry-storm. Errors are surfaced inside the
response body for CloudWatch debugging.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from stocvest.api.services.historical_validation_service import (
    HistoricalValidationService,
)
from stocvest.api.services.post_rotation_monitor import (
    DEFAULT_DEGRADATION_THRESHOLD_PP,
    DEFAULT_WINDOW_DAYS,
    DegradationResult,
    evaluate_post_rotation_accuracy,
)
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.config.parameter_store import ParameterStore
from stocvest.data.parameter_history_store import list_parameter_history_versions
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

#: CloudWatch namespace + metric name — Terraform alarm pins exactly
#: these strings via the matching variables in
#: ``lambda_weight_rotation_monitor.tf``.
CLOUDWATCH_NAMESPACE = "Stocvest/Signals"
CLOUDWATCH_METRIC_NAME = "PostRotationAccuracyDelta"

#: Dimension name used to scope the alarm to ``status="degraded"`` only.
#: The publisher always emits the metric, but the alarm condition in
#: Terraform filters on this dimension so non-actionable statuses can
#: still populate dashboards without firing.
CLOUDWATCH_STATUS_DIMENSION = "Status"


def _resolve_previous_version(*, current_version: str) -> str | None:
    """Pick the most-recent ``ParameterHistory`` row that is NOT the current live one.

    ``ParameterHistory`` rows are sorted by ``created_at`` descending
    in :func:`list_parameter_history_versions`. The first row matching
    ``current_version`` is skipped; the next row's version (if any) is
    the previous one. Returns ``None`` when no such row exists (e.g.
    the rotation that produced ``current_version`` was the very first
    one, OR the table is empty).
    """
    rows = list_parameter_history_versions(limit=10)
    found_current = False
    for row in rows:
        if row.version == current_version:
            found_current = True
            continue
        if found_current:
            return row.version
        # Defensive: if the current version somehow isn't the head of
        # the audit list (e.g. an out-of-band write), return the first
        # non-matching row we see rather than insisting on a strict
        # order. Better to compare against *some* prior version than
        # silently report ``baseline_unavailable``.
        return row.version
    return None


def _publish_cloudwatch(result: DegradationResult, *, environment: str) -> None:
    """Best-effort metric publish to CloudWatch.

    Always emits the metric so dashboards stay populated even on
    ``ok`` / ``insufficient_sample`` / ``baseline_unavailable``
    statuses. The alarm in Terraform filters by the ``Status``
    dimension to fire only on ``degraded``.

    Logs and returns on any boto3 error — the monitor's job is to
    surface degradation; a metric-publish failure does NOT roll back
    weights or block subsequent runs.
    """
    # When the delta is None (insufficient sample / baseline missing) we
    # still publish a 0.0 to keep the metric continuous, but tag the
    # ``Status`` dimension so the alarm policy in Terraform can ignore
    # those data points.
    value = 0.0 if result.delta_pp is None else float(result.delta_pp)
    timestamp = datetime.now(timezone.utc)

    try:
        client = boto3.client("cloudwatch", region_name=get_settings().aws_region)
        client.put_metric_data(
            Namespace=CLOUDWATCH_NAMESPACE,
            MetricData=[
                {
                    "MetricName": CLOUDWATCH_METRIC_NAME,
                    "Timestamp": timestamp,
                    "Value": value,
                    "Unit": "None",
                    "Dimensions": [
                        {"Name": CLOUDWATCH_STATUS_DIMENSION, "Value": result.status},
                        {"Name": "Environment", "Value": environment or "development"},
                    ],
                }
            ],
        )
    except (BotoCoreError, ClientError) as exc:
        _LOG.warning(
            "weight_rotation_monitor: CloudWatch put_metric_data failed: %s", exc
        )
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.warning(
            "weight_rotation_monitor: CloudWatch publish unexpected error: %s", exc
        )


def _build_service() -> HistoricalValidationService:
    """Construct the validation service against the live signal recorder.

    Imported lazily so tests can monkeypatch the recorder without the
    module-load side effects of importing boto3 transitively.
    """
    from stocvest.api.services.signal_recorder import get_signal_recorder

    recorder = get_signal_recorder()
    return HistoricalValidationService(recorder)


def weight_rotation_monitor_scheduled_handler(
    event: LambdaEvent, context: LambdaContext
) -> dict[str, Any]:
    """EventBridge-scheduled entry point (no HTTP route).

    Always returns HTTP 200 even on internal failure to keep EventBridge
    from retry-storming. The structured response body carries the
    :class:`DegradationResult` (or an ``error`` field) for CloudWatch
    log analytics.
    """
    _ = context
    if isinstance(event, dict):
        src = event.get("source")
        _LOG.info(
            "weight_rotation_monitor triggered by EventBridge: %s",
            src or "(unknown)",
        )

    environment = os.environ.get("STOCVEST_ENVIRONMENT", "development")

    try:
        params = ParameterStore.get_parameters_sync()
        current_version = str(params.version)
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception("weight_rotation_monitor: parameter load failed: %s", exc)
        body = {"error": f"parameter load failed: {exc}"}
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, separators=(",", ":")),
        }

    try:
        previous_version = _resolve_previous_version(current_version=current_version)
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception(
            "weight_rotation_monitor: previous version lookup failed: %s", exc
        )
        previous_version = None

    try:
        service = _build_service()
        result = evaluate_post_rotation_accuracy(
            current_parameter_version=current_version,
            previous_parameter_version=previous_version,
            service=service,
            window_days=DEFAULT_WINDOW_DAYS,
            threshold_pp=DEFAULT_DEGRADATION_THRESHOLD_PP,
        )
    except Exception as exc:
        _LOG.exception(
            "weight_rotation_monitor: degradation evaluation failed: %s", exc
        )
        body = {"error": f"evaluation failed: {exc}"}
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, separators=(",", ":")),
        }

    _publish_cloudwatch(result, environment=environment)

    _LOG.info(
        "weight_rotation_monitor result: status=%s delta_pp=%s current_v=%s previous_v=%s",
        result.status,
        result.delta_pp,
        current_version,
        previous_version,
    )
    body = {
        "current_parameter_version": current_version,
        "previous_parameter_version": previous_version,
        "result": result.to_dict(),
    }
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, separators=(",", ":"), default=str),
    }
