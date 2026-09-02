"""Composite desk news sourcing — Polygon-primary, Benzinga-free (ADR-001 Phases 1 & 7)."""

from __future__ import annotations

from stocvest.data.benzinga_client import BenzingaFeedHealth, BenzingaMultiResult

SWING_NEWS_SOURCE_POLYGON_PRIMARY = "polygon_primary"


def swing_news_source_bundle() -> BenzingaMultiResult:
    """Empty structured bundle for NewsAnalyzer compatibility without Benzinga HTTP."""
    return BenzingaMultiResult(
        analyst_feed_configured=False,
        feed_health=BenzingaFeedHealth(
            news="unconfigured",
            wim="unconfigured",
            ratings="unconfigured",
            guidance="unconfigured",
            earnings="unconfigured",
            bundle="ok",
        ),
    )
