"""Rotating no-news copy stays non-empty and symbol-aware."""

from __future__ import annotations

from stocvest.signals.news_copy import no_qualifying_news_reasoning


def test_no_qualifying_news_reasoning_variants() -> None:
    texts = {no_qualifying_news_reasoning(s) for s in ("AAA", "BBB", "CCC", "ZZZ", "MMM")}
    assert len(texts) >= 2
    for t in texts:
        assert len(t) > 40
        assert "unavailable" not in t.lower()
