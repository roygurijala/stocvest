from __future__ import annotations

from stocvest.api.services.real_composite_engine import _build_catalyst_headlines


def test_scored_articles_attached_to_signal() -> None:
    out = _build_catalyst_headlines([{"title": "A", "insights": [{"sentiment": "positive"}]}])
    assert len(out) == 1


def test_max_8_headlines_returned() -> None:
    rows = [{"title": str(i), "insights": [{"sentiment": "positive"}]} for i in range(10)]
    out = _build_catalyst_headlines(rows)
    assert len(out) == 8


def test_neutral_sentiment_articles_included() -> None:
    out = _build_catalyst_headlines([{"title": "A", "insights": [{"sentiment": "neutral"}]}])
    assert len(out) == 1
    assert out[0]["sentiment_score"] == 0.0


def test_empty_headlines_when_no_articles_meet_threshold() -> None:
    assert _build_catalyst_headlines([]) == []
