"""B71 Phase B — article-level news-event capture into NewsSnapshot.top_events.

The composite engines pass their ``catalyst_headlines`` list (top article-level
events: published_at + per-ticker sentiment + source + catalyst type) into the
snapshot builder so a later event study can reconstruct post-news price impact.
"""

from __future__ import annotations

import json

import pytest

from stocvest.api.services.signal_snapshot_builders import build_real_composite_snapshot_payload
from stocvest.signals.news_analyzer import NewsLayerResult


def _news_layer() -> NewsLayerResult:
    return NewsLayerResult(
        status="available",
        score=70,
        verdict="bullish",
        article_count=3,
        weighted_sentiment=0.4,
        catalyst_headline="Big upgrade",
        catalyst_type="analyst",
    )


def _events() -> list[dict]:
    return [
        {
            "text": "Analyst upgrades to Buy",
            "source": "benzinga",
            "published_at": "2026-06-21T12:00:00+00:00",
            "sentiment_score": 0.8,
            "sentiment": "positive",
            "catalyst_type": "analyst",
            "url": "https://example.com/a",
        },
        {
            "text": "Sector weakness weighs",
            "source": "polygon",
            "published_at": "2026-06-21T11:00:00+00:00",
            "sentiment_score": -0.5,
            "sentiment": "negative",
            "catalyst_type": "news",
            "url": "https://example.com/b",
        },
    ]


def _build(news_events) -> dict:
    blobs = build_real_composite_snapshot_payload(
        technical=None,
        news=_news_layer(),
        macro=None,
        sector=None,
        internals=None,
        layer_scores={"news": 0.4},
        confirming_labels=[],
        conflicting_labels=[],
        news_events=news_events,
    )
    return json.loads(blobs["news_snapshot_json"])


@pytest.mark.unit
def test_news_events_are_captured_with_timestamp_and_sentiment():
    news = _build(_events())
    events = news["top_events"]
    assert len(events) == 2
    first = events[0]
    assert first["published_at"] == "2026-06-21T12:00:00+00:00"
    assert first["sentiment_score"] == pytest.approx(0.8)
    assert first["sentiment"] == "positive"
    assert first["source"] == "benzinga"
    assert first["catalyst_type"] == "analyst"
    # aggregate fields still populated alongside the new capture
    assert news["article_count"] == 3
    assert news["catalyst_headline"] == "Big upgrade"


@pytest.mark.unit
def test_no_events_yields_empty_capture_not_error():
    assert _build(None)["top_events"] == []
    assert _build([])["top_events"] == []


@pytest.mark.unit
def test_capture_is_bounded_and_titles_truncated():
    long_title = "x" * 400
    rows = [
        {
            "text": long_title,
            "source": "polygon",
            "published_at": f"2026-06-21T1{i}:00:00+00:00",
            "sentiment_score": 0.1 * i,
        }
        for i in range(20)
    ]
    events = _build(rows)["top_events"]
    assert len(events) == 8  # capped
    assert len(events[0]["title"]) <= 120


@pytest.mark.unit
def test_malformed_rows_are_skipped():
    rows = ["not a dict", None, {"text": "ok", "sentiment_score": 0.2}]
    events = _build(rows)["top_events"]
    assert len(events) == 1
    assert events[0]["title"] == "ok"
