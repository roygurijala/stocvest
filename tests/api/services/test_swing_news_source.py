"""ADR-001 Phase 1: swing news source bundle (Polygon-primary, no Benzinga HTTP)."""

from __future__ import annotations

import pytest

from stocvest.api.services.swing_news_source import (
    SWING_NEWS_SOURCE_POLYGON_PRIMARY,
    swing_news_source_bundle,
)


@pytest.mark.unit
def test_swing_news_source_bundle_empty_and_unconfigured() -> None:
    bundle = swing_news_source_bundle()
    assert bundle.analyst_feed_configured is False
    assert bundle.news == []
    assert bundle.wim is None
    health = bundle.feed_health.as_dict()
    assert health["news"] == "unconfigured"
    assert health["wim"] == "unconfigured"
    assert health["ratings"] == "unconfigured"
    assert health["guidance"] == "unconfigured"
    assert health["earnings"] == "unconfigured"
    assert health["bundle"] == "ok"


@pytest.mark.unit
def test_swing_news_source_constant() -> None:
    assert SWING_NEWS_SOURCE_POLYGON_PRIMARY == "polygon_primary"
