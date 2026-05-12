"""Lock-in tests for D10 Phase 4 — the EventBridge-scheduled monitor Lambda.

The handler is a thin wrapper around
:func:`evaluate_post_rotation_accuracy`. These tests pin the wiring:

* Reads the live ``parameter_version`` from
  :class:`ParameterStore.get_parameters_sync`.
* Resolves the previous version from ``ParameterHistory`` (skipping the
  current-live row when present).
* Always returns HTTP 200 (never 4xx/5xx) — EventBridge must NOT retry.
* Publishes the custom CloudWatch metric with the ``Status`` dimension
  matching the result's status, so the alarm's filter never accidentally
  fires on a non-degraded run.
* Handles ParameterStore / SignalHistory failures without raising.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from stocvest.api.handlers.weight_rotation_monitor import (
    CLOUDWATCH_METRIC_NAME,
    CLOUDWATCH_NAMESPACE,
    CLOUDWATCH_STATUS_DIMENSION,
    weight_rotation_monitor_scheduled_handler,
)
from stocvest.api.services.post_rotation_monitor import (
    DegradationResult,
    WindowAccuracy,
)
from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.data.parameter_history_store import ParameterHistoryRow


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _hist_row(version: str, created_at: str) -> ParameterHistoryRow:
    return ParameterHistoryRow(
        version=version,
        created_at=created_at,
        reason="rotation",
        parameters_json="{}",
        signal_count_on_change=100,
        accuracy_before_change=0.62,
        changed_by="alice",
    )


def _degraded_result() -> DegradationResult:
    return DegradationResult(
        status="degraded",
        current=WindowAccuracy(
            parameter_version="1.0.6",
            resolved_correct=20,
            resolved_incorrect=20,
            resolved_neutral=0,
            accuracy_pct=50.0,
            window_start="2026-05-01T00:00:00+00:00",
            window_end="2026-05-15T00:00:00+00:00",
            rows_examined=40,
        ),
        baseline=WindowAccuracy(
            parameter_version="1.0.5",
            resolved_correct=32,
            resolved_incorrect=8,
            resolved_neutral=0,
            accuracy_pct=80.0,
            window_start="2026-04-17T00:00:00+00:00",
            window_end="2026-05-01T00:00:00+00:00",
            rows_examined=40,
        ),
        delta_pp=-30.0,
        threshold_pp=5.0,
        message="degraded",
    )


def _ok_result() -> DegradationResult:
    return DegradationResult(
        status="ok",
        current=WindowAccuracy(
            parameter_version="1.0.6",
            resolved_correct=35,
            resolved_incorrect=5,
            resolved_neutral=0,
            accuracy_pct=87.5,
            window_start="2026-05-01T00:00:00+00:00",
            window_end="2026-05-15T00:00:00+00:00",
            rows_examined=40,
        ),
        baseline=WindowAccuracy(
            parameter_version="1.0.5",
            resolved_correct=32,
            resolved_incorrect=8,
            resolved_neutral=0,
            accuracy_pct=80.0,
            window_start="2026-04-17T00:00:00+00:00",
            window_end="2026-05-01T00:00:00+00:00",
            rows_examined=40,
        ),
        delta_pp=7.5,
        threshold_pp=5.0,
        message="ok",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Handler returns HTTP 200 (always)
# ─────────────────────────────────────────────────────────────────────────────


def test_handler_returns_200_on_happy_path():
    params = default_signal_parameters()
    params.version = "1.0.6"

    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.ParameterStore.get_parameters_sync",
        return_value=params,
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.list_parameter_history_versions",
        return_value=[
            _hist_row("1.0.6", "2026-05-10T00:00:00+00:00"),
            _hist_row("1.0.5", "2026-05-01T00:00:00+00:00"),
        ],
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._build_service",
        return_value=MagicMock(),
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.evaluate_post_rotation_accuracy",
        return_value=_ok_result(),
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._publish_cloudwatch"
    ):
        response = weight_rotation_monitor_scheduled_handler({}, None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["current_parameter_version"] == "1.0.6"
    assert body["previous_parameter_version"] == "1.0.5"
    assert body["result"]["status"] == "ok"


def test_handler_returns_200_even_when_evaluation_fails():
    params = default_signal_parameters()
    params.version = "1.0.6"

    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.ParameterStore.get_parameters_sync",
        return_value=params,
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.list_parameter_history_versions",
        return_value=[],
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._build_service",
        return_value=MagicMock(),
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.evaluate_post_rotation_accuracy",
        side_effect=RuntimeError("boom"),
    ):
        response = weight_rotation_monitor_scheduled_handler({}, None)

    # Must NOT propagate the exception — EventBridge sees 200 with
    # ``error`` in the body.
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert "error" in body
    assert "boom" in body["error"]


def test_handler_returns_200_when_parameter_load_fails():
    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.ParameterStore.get_parameters_sync",
        side_effect=RuntimeError("aws down"),
    ):
        response = weight_rotation_monitor_scheduled_handler({}, None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert "error" in body
    assert "aws down" in body["error"]


# ─────────────────────────────────────────────────────────────────────────────
# Previous-version resolution
# ─────────────────────────────────────────────────────────────────────────────


def test_handler_resolves_previous_version_skipping_current_live():
    """ParameterHistory's first row is always the just-promoted current
    version. The resolver should skip it and return the next row down."""
    params = default_signal_parameters()
    params.version = "1.0.6"

    captured: dict[str, Any] = {}

    def _capture(*, current_parameter_version: str, previous_parameter_version: str | None, **_kw: Any) -> DegradationResult:
        captured["current"] = current_parameter_version
        captured["previous"] = previous_parameter_version
        return _ok_result()

    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.ParameterStore.get_parameters_sync",
        return_value=params,
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.list_parameter_history_versions",
        return_value=[
            _hist_row("1.0.6", "2026-05-10T00:00:00+00:00"),
            _hist_row("1.0.5", "2026-05-01T00:00:00+00:00"),
            _hist_row("1.0.4", "2026-04-20T00:00:00+00:00"),
        ],
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._build_service",
        return_value=MagicMock(),
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.evaluate_post_rotation_accuracy",
        side_effect=_capture,
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._publish_cloudwatch"
    ):
        weight_rotation_monitor_scheduled_handler({}, None)

    assert captured["current"] == "1.0.6"
    assert captured["previous"] == "1.0.5"


def test_handler_returns_none_previous_when_history_is_empty():
    """First-ever rotation: history has only the current version, no prior."""
    params = default_signal_parameters()
    params.version = "1.0.1"

    captured: dict[str, Any] = {}

    def _capture(*, previous_parameter_version: str | None, **_kw: Any) -> DegradationResult:
        captured["previous"] = previous_parameter_version
        return _ok_result()

    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.ParameterStore.get_parameters_sync",
        return_value=params,
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.list_parameter_history_versions",
        return_value=[_hist_row("1.0.1", "2026-05-10T00:00:00+00:00")],
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._build_service",
        return_value=MagicMock(),
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.evaluate_post_rotation_accuracy",
        side_effect=_capture,
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._publish_cloudwatch"
    ):
        weight_rotation_monitor_scheduled_handler({}, None)

    assert captured["previous"] is None


def test_handler_handles_history_lookup_failure_gracefully():
    """If ParameterHistory scan crashes, we should still publish a metric
    with previous=None rather than 500-ing the Lambda."""
    params = default_signal_parameters()
    params.version = "1.0.6"

    captured: dict[str, Any] = {}

    def _capture(*, previous_parameter_version: str | None, **_kw: Any) -> DegradationResult:
        captured["previous"] = previous_parameter_version
        return _ok_result()

    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.ParameterStore.get_parameters_sync",
        return_value=params,
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.list_parameter_history_versions",
        side_effect=RuntimeError("ddb down"),
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._build_service",
        return_value=MagicMock(),
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.evaluate_post_rotation_accuracy",
        side_effect=_capture,
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._publish_cloudwatch"
    ):
        response = weight_rotation_monitor_scheduled_handler({}, None)

    assert response["statusCode"] == 200
    assert captured["previous"] is None


# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch publishing contract
# ─────────────────────────────────────────────────────────────────────────────


def test_handler_publishes_cloudwatch_metric_with_status_dimension():
    """Lock-in: the CloudWatch publish carries the result's status in
    the ``Status`` dimension so the alarm's filter is honest."""
    params = default_signal_parameters()
    params.version = "1.0.6"

    publish_calls: list[Any] = []

    def _record_publish(result: DegradationResult, *, environment: str) -> None:
        publish_calls.append((result, environment))

    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.ParameterStore.get_parameters_sync",
        return_value=params,
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.list_parameter_history_versions",
        return_value=[
            _hist_row("1.0.6", "2026-05-10T00:00:00+00:00"),
            _hist_row("1.0.5", "2026-05-01T00:00:00+00:00"),
        ],
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._build_service",
        return_value=MagicMock(),
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor.evaluate_post_rotation_accuracy",
        return_value=_degraded_result(),
    ), patch(
        "stocvest.api.handlers.weight_rotation_monitor._publish_cloudwatch",
        side_effect=_record_publish,
    ):
        weight_rotation_monitor_scheduled_handler({}, None)

    assert len(publish_calls) == 1
    result, _env = publish_calls[0]
    assert result.status == "degraded"
    assert result.delta_pp == -30.0


def test_publish_calls_cloudwatch_put_metric_data_with_correct_namespace_and_dimensions():
    """Lock-in: the publisher uses the namespace/metric/dimensions that
    Terraform's alarm depends on. A drift here silently unhooks the
    alarm."""
    from stocvest.api.handlers.weight_rotation_monitor import _publish_cloudwatch

    cw_client = MagicMock()
    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.boto3.client",
        return_value=cw_client,
    ):
        _publish_cloudwatch(_degraded_result(), environment="development")

    cw_client.put_metric_data.assert_called_once()
    call_kwargs = cw_client.put_metric_data.call_args.kwargs
    assert call_kwargs["Namespace"] == CLOUDWATCH_NAMESPACE
    assert CLOUDWATCH_NAMESPACE == "Stocvest/Signals"
    metric = call_kwargs["MetricData"][0]
    assert metric["MetricName"] == CLOUDWATCH_METRIC_NAME
    assert CLOUDWATCH_METRIC_NAME == "PostRotationAccuracyDelta"
    assert metric["Value"] == -30.0
    dims = {d["Name"]: d["Value"] for d in metric["Dimensions"]}
    assert dims[CLOUDWATCH_STATUS_DIMENSION] == "degraded"
    assert dims["Environment"] == "development"


def test_publish_emits_zero_for_insufficient_sample_to_keep_dashboard_continuous():
    """When delta_pp is None (insufficient_sample / baseline_unavailable),
    publish a 0.0 value with the corresponding status dimension so
    dashboards stay populated and the alarm filter still excludes it."""
    from stocvest.api.handlers.weight_rotation_monitor import _publish_cloudwatch

    null_delta = DegradationResult(
        status="insufficient_sample",
        current=None,
        baseline=None,
        delta_pp=None,
        threshold_pp=5.0,
    )

    cw_client = MagicMock()
    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.boto3.client",
        return_value=cw_client,
    ):
        _publish_cloudwatch(null_delta, environment="development")

    metric = cw_client.put_metric_data.call_args.kwargs["MetricData"][0]
    assert metric["Value"] == 0.0
    dims = {d["Name"]: d["Value"] for d in metric["Dimensions"]}
    assert dims[CLOUDWATCH_STATUS_DIMENSION] == "insufficient_sample"


def test_publish_swallows_cloudwatch_errors_silently():
    """A boto3 error during publish must NOT propagate — the monitor's
    job is best-effort observability."""
    from botocore.exceptions import BotoCoreError

    from stocvest.api.handlers.weight_rotation_monitor import _publish_cloudwatch

    cw_client = MagicMock()
    cw_client.put_metric_data.side_effect = BotoCoreError()
    with patch(
        "stocvest.api.handlers.weight_rotation_monitor.boto3.client",
        return_value=cw_client,
    ):
        # No exception means the test passes.
        _publish_cloudwatch(_degraded_result(), environment="development")


# ─────────────────────────────────────────────────────────────────────────────
# Module dispatch wiring
# ─────────────────────────────────────────────────────────────────────────────


def test_lambda_dispatch_routes_weight_rotation_monitor_module():
    """Lock-in: STOCVEST_LAMBDA_MODULE=weight_rotation_monitor reaches
    the right handler. This is the env-var contract Terraform sets."""
    import os

    from stocvest.api.lambda_dispatch import lambda_handler

    os.environ["STOCVEST_LAMBDA_MODULE"] = "weight_rotation_monitor"
    try:
        with patch(
            "stocvest.api.handlers.weight_rotation_monitor.weight_rotation_monitor_scheduled_handler",
            return_value={"statusCode": 200, "body": "{}", "headers": {}},
        ) as handler:
            response = lambda_handler({"source": "aws.events"}, None)
        handler.assert_called_once()
        assert response["statusCode"] == 200
    finally:
        del os.environ["STOCVEST_LAMBDA_MODULE"]
