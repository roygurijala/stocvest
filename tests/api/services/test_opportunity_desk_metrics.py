"""Opportunity Desk CloudWatch metrics (D13 Phase 6)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from stocvest.api.services.opportunity_desk.metrics import (
    METRIC_NAMESPACE,
    publish_opportunity_desk_batch_metrics,
)


def test_publish_opportunity_desk_batch_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MagicMock()
    monkeypatch.setattr(
        "stocvest.api.services.opportunity_desk.metrics.boto3.client",
        lambda _name: client,
    )
    publish_opportunity_desk_batch_metrics(
        tier="full",
        duration_ms=12_500.0,
        survivor_count=120,
        composite_failures=2,
        scanned_snapshot_count=4500,
    )
    client.put_metric_data.assert_called_once()
    call = client.put_metric_data.call_args.kwargs
    assert call["Namespace"] == METRIC_NAMESPACE
    names = {m["MetricName"] for m in call["MetricData"]}
    assert names == {
        "BatchDuration",
        "SurvivorCount",
        "CompositeFailures",
        "ScannedSnapshotCount",
    }
    duration = next(m for m in call["MetricData"] if m["MetricName"] == "BatchDuration")
    assert duration["Value"] == 12_500.0
    assert duration["Unit"] == "Milliseconds"
