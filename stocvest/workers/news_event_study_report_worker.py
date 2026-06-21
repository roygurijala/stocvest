"""Scheduled news event-study report → S3 (B71 Phase C, read-only).

EventBridge invokes this weekly. It scans recent ``SignalHistory`` rows, computes
the per-symbol news **sensitivity ratio** + sentiment **predictiveness**
(:mod:`stocvest.signals.news_event_study`), and writes a dated JSON report to the
reports S3 bucket. It is read-only w.r.t. the signal store and does NOT change live
scoring — the numbers are for validating B71 Phase C before any learned up-weight.

Gated by ``STOCVEST_NEWS_EVENT_STUDY_REPORT_ENABLED`` (default OFF) and a configured
``STOCVEST_REPORTS_S3_BUCKET``; no-ops otherwise. Always returns HTTP 200 so a
transient failure does not trigger EventBridge retry storms (mirrors weight_proposer).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.signals.news_event_study import build_sensitivity_report
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_HORIZONS = ("1d", "1h")


def _run() -> dict[str, Any]:
    settings = get_settings()
    if not settings.stocvest_news_event_study_report_enabled:
        _LOG.info("news_event_study_report disabled; skipping")
        return {"statusCode": 200, "skipped": "disabled"}

    bucket = settings.stocvest_reports_s3_bucket.strip()
    if not bucket:
        _LOG.warning("news_event_study_report: STOCVEST_REPORTS_S3_BUCKET not set; skipping")
        return {"statusCode": 200, "skipped": "no_bucket"}

    lookback_days = max(1, int(settings.stocvest_news_event_study_lookback_days))
    min_samples = max(1, int(settings.stocvest_news_event_study_min_samples))
    now = datetime.now(timezone.utc)

    recorder = get_signal_recorder()
    records = recorder.scan_records_in_window(
        from_at=now - timedelta(days=lookback_days),
        to_at=now,
        mode=None,
        max_rows=20000,
    )

    horizons = {h: build_sensitivity_report(records, horizon=h, min_news_samples=min_samples) for h in _HORIZONS}
    payload = {
        "generated_at": now.isoformat(),
        "lookback_days": lookback_days,
        "min_news_samples": min_samples,
        "record_count": len(records),
        "horizons": horizons,
    }

    prefix = settings.stocvest_news_event_study_s3_prefix.strip().strip("/")
    date_seg = now.date().isoformat()
    key = f"{prefix}/{date_seg}/report.json" if prefix else f"{date_seg}/report.json"

    import boto3

    boto3.client("s3").put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(payload, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    _LOG.info(
        "news_event_study_report wrote s3://%s/%s records=%d symbols_1d=%d",
        bucket,
        key,
        len(records),
        horizons["1d"]["symbol_count"],
    )
    return {
        "statusCode": 200,
        "bucket": bucket,
        "key": key,
        "record_count": len(records),
        "symbol_count_1d": horizons["1d"]["symbol_count"],
    }


def handler(event: Any, context: Any) -> dict[str, Any]:
    _ = (event, context)
    try:
        return _run()
    except Exception as exc:  # noqa: BLE001 — always 200 to avoid EventBridge retry storms
        _LOG.exception("news_event_study_report failed: %s", exc)
        return {"statusCode": 200, "error": "report_failed"}
