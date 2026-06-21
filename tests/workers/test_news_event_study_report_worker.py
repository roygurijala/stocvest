"""B71 Phase C — scheduled news event-study report worker (read-only → S3)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import stocvest.workers.news_event_study_report_worker as worker
from stocvest.data.models import SignalRecord
from stocvest.data.signal_snapshots import NewsEventCapture, NewsSnapshot

_GEN = datetime(2026, 6, 1, 14, 30, tzinfo=timezone.utc)


def _settings(*, enabled=True, bucket="stocvest-reports", min_samples=2):
    return SimpleNamespace(
        stocvest_news_event_study_report_enabled=enabled,
        stocvest_reports_s3_bucket=bucket,
        stocvest_news_event_study_s3_prefix="news-event-study/",
        stocvest_news_event_study_lookback_days=120,
        stocvest_news_event_study_min_samples=min_samples,
    )


def _rec(symbol: str, idx: int, *, fwd: float, sentiment: float | None, has_news: bool) -> SignalRecord:
    news_json = None
    if has_news:
        news_json = NewsSnapshot(
            article_count=2,
            weighted_sentiment=sentiment,
            top_events=[NewsEventCapture(published_at="2026-06-01T12:00:00Z", sentiment_score=sentiment)],
        ).model_dump_json()
    return SignalRecord(
        signal_id=f"{symbol}-{idx}",
        symbol=symbol,
        direction="bullish",
        signal_strength=50,
        price_at_signal=100.0,
        generated_at=_GEN,
        mode="day",
        resolved_1d=True,
        price_1d_after=100.0 * (1 + fwd),
        news_snapshot_json=news_json,
    )


class _FakeRecorder:
    def __init__(self, records):
        self.records = records
        self.calls = []

    def scan_records_in_window(self, **kwargs):
        self.calls.append(kwargs)
        return self.records


class _FakeS3:
    def __init__(self):
        self.puts = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)
        return {}


@pytest.mark.unit
def test_handler_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(worker, "get_settings", lambda: _settings(enabled=False))
    s3 = _FakeS3()
    monkeypatch.setattr("boto3.client", lambda *a, **k: s3)
    out = worker.handler({}, None)
    assert out["skipped"] == "disabled"
    assert s3.puts == []


@pytest.mark.unit
def test_handler_noop_when_no_bucket(monkeypatch):
    monkeypatch.setattr(worker, "get_settings", lambda: _settings(bucket=""))
    s3 = _FakeS3()
    monkeypatch.setattr("boto3.client", lambda *a, **k: s3)
    out = worker.handler({}, None)
    assert out["skipped"] == "no_bucket"
    assert s3.puts == []


@pytest.mark.unit
def test_handler_writes_report_to_s3(monkeypatch):
    records = [
        _rec("AAA", 1, fwd=0.05, sentiment=0.6, has_news=True),
        _rec("AAA", 2, fwd=0.06, sentiment=0.6, has_news=True),
        _rec("AAA", 3, fwd=0.01, sentiment=None, has_news=False),
    ]
    rec = _FakeRecorder(records)
    s3 = _FakeS3()
    monkeypatch.setattr(worker, "get_settings", lambda: _settings(min_samples=2))
    monkeypatch.setattr(worker, "get_signal_recorder", lambda: rec)
    monkeypatch.setattr("boto3.client", lambda *a, **k: s3)

    out = worker.handler({"job": "news_event_study_report"}, None)

    assert out["statusCode"] == 200
    assert out["bucket"] == "stocvest-reports"
    assert out["record_count"] == 3
    assert out["symbol_count_1d"] == 1
    assert len(s3.puts) == 1
    put = s3.puts[0]
    assert put["Bucket"] == "stocvest-reports"
    assert put["Key"].startswith("news-event-study/") and put["Key"].endswith("/report.json")
    assert put["ContentType"] == "application/json"
    payload = json.loads(put["Body"].decode("utf-8"))
    assert set(payload["horizons"].keys()) == {"1d", "1h"}
    assert "AAA" in payload["horizons"]["1d"]["symbols"]
    # Recorder was queried with a bounded window.
    assert rec.calls and rec.calls[0]["max_rows"] == 20000


@pytest.mark.unit
def test_handler_returns_200_on_failure(monkeypatch):
    def _boom():
        raise RuntimeError("dynamo down")

    monkeypatch.setattr(worker, "get_settings", lambda: _settings())
    monkeypatch.setattr(worker, "get_signal_recorder", _boom)
    out = worker.handler({}, None)
    assert out["statusCode"] == 200
    assert out["error"] == "report_failed"
