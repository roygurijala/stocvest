"""resolve_analyst_target_levels — Benzinga first, Perplexity fallback."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from stocvest.api.services.symbol_perplexity_enrichment import (
    PerplexityAnalystTargetEnrichment,
    resolve_analyst_target_levels,
)
from stocvest.data.benzinga_client import BenzingaRating


def _rating(pt: float | None) -> BenzingaRating:
    return BenzingaRating(
        symbol="ABC",
        action="initiates",
        rating="Buy",
        price_target=pt,
        analyst_firm="Test Bank",
        published_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_resolve_prefers_benzinga_over_perplexity() -> None:
    with patch(
        "stocvest.api.services.symbol_perplexity_enrichment.fetch_analyst_target_enrichment",
        new_callable=AsyncMock,
    ) as mock_fetch:
        levels, source = await resolve_analyst_target_levels(
            symbol="ABC",
            ticker_ref=None,
            ratings=[_rating(14.0)],
        )
    assert levels == [14.0]
    assert source == "benzinga"
    mock_fetch.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_falls_back_to_perplexity_when_benzinga_empty() -> None:
    enrich = PerplexityAnalystTargetEnrichment(symbol="ABC", price_targets=[13.5, 15.0])
    with patch(
        "stocvest.api.services.symbol_perplexity_enrichment.fetch_analyst_target_enrichment",
        new_callable=AsyncMock,
        return_value=enrich,
    ):
        levels, source = await resolve_analyst_target_levels(
            symbol="ABC",
            ticker_ref=None,
            ratings=[_rating(None)],
        )
    assert levels == [13.5, 15.0]
    assert source == "perplexity"


@pytest.mark.asyncio
async def test_resolve_none_when_both_empty() -> None:
    with patch(
        "stocvest.api.services.symbol_perplexity_enrichment.fetch_analyst_target_enrichment",
        new_callable=AsyncMock,
        return_value=None,
    ):
        levels, source = await resolve_analyst_target_levels(
            symbol="ABC",
            ticker_ref=None,
            ratings=[],
        )
    assert levels == []
    assert source == "none"
