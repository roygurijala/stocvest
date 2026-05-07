"""Swing vs day news windows and swing-only recency decay in NewsAnalyzer."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from stocvest.config.signal_parameters import NewsParameters, default_signal_parameters
from stocvest.signals.news_analyzer import NewsAnalyzer
from stocvest.signals.news_sentiment import swing_recency_weight


def _article(pub: datetime, *, sentiment: str = "positive", ticker: str = "TEST") -> dict:
    return {
        "title": "Fed outlook",
        "description": "macro",
        "tickers": [ticker],
        "published_utc": pub.astimezone(timezone.utc).isoformat(),
        "insights": [{"sentiment": sentiment}],
        "publisher": {"name": "Reuters"},
    }


def test_swing_recency_weight_today() -> None:
    now = datetime(2026, 5, 6, 18, 0, tzinfo=timezone.utc)
    pub = now - timedelta(hours=12)
    assert swing_recency_weight(pub, now) == 1.0


def test_swing_recency_weight_yesterday() -> None:
    now = datetime(2026, 5, 6, 18, 0, tzinfo=timezone.utc)
    pub = now - timedelta(hours=36)
    assert swing_recency_weight(pub, now) == pytest.approx(0.80)


def test_swing_recency_weight_three_days() -> None:
    now = datetime(2026, 5, 6, 18, 0, tzinfo=timezone.utc)
    pub = now - timedelta(hours=80)
    assert swing_recency_weight(pub, now) == pytest.approx(0.40)


def test_swing_decay_applied_to_score(monkeypatch: pytest.MonkeyPatch) -> None:
    """Older bearish article contributes less in swing mode than a fresh bullish one."""
    import stocvest.signals.news_analyzer as na

    fixed_now = datetime(2026, 5, 6, 12, 0, tzinfo=timezone.utc)
    old = fixed_now - timedelta(days=3, hours=8)  # ~80h → decay 0.40
    recent = fixed_now - timedelta(hours=6)
    articles = [
        _article(recent, sentiment="positive"),
        _article(old, sentiment="negative"),
    ]
    params = NewsParameters(
        recency_1h_weight=1.0,
        recency_4h_weight=1.0,
        recency_8h_weight=1.0,
        recency_old_weight=1.0,
        direct_mention_weight=1.0,
        indirect_mention_weight=1.0,
    )

    class _FrozenDt:
        @staticmethod
        def now(tz=None):
            return fixed_now

        @staticmethod
        def fromisoformat(s: str):
            return datetime.fromisoformat(str(s).replace("Z", "+00:00"))

    monkeypatch.setattr(na, "datetime", _FrozenDt)
    res_swing = NewsAnalyzer().analyze("TEST", articles, params, mode="swing")
    res_day = NewsAnalyzer().analyze("TEST", articles, params, mode="day", lookback_hours=120)
    assert res_swing.status == "available"
    assert res_day.status == "available"
    assert float(res_swing.weighted_sentiment or 0) > float(res_day.weighted_sentiment or 0)


def test_day_news_analyzer_uses_8h_window_by_default() -> None:
    """Day mode default excludes headlines older than ~8h; a wider explicit window can include them."""
    pub = datetime.now(timezone.utc) - timedelta(hours=10)
    art = _article(pub)
    p = default_signal_parameters().news
    res8 = NewsAnalyzer().analyze("TEST", [art], p, lookback_hours=8, mode="day")
    res120 = NewsAnalyzer().analyze("TEST", [art], p, lookback_hours=120, mode="day")
    assert res8.status == "available"
    assert res8.verdict == "neutral"
    assert res120.status == "available"
    res_swing_default = NewsAnalyzer().analyze("TEST", [art], p, mode="swing")
    assert res_swing_default.status == "available"
