"""POS-AI-13 (display-only) — position analyst panel builder.

Verifies the panel degrades gracefully with no key and formats real ratings
when configured. This surface is display-only and never touches the composite
score.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.api.services import position_analyst_panel as pap
from stocvest.data.benzinga_client import BenzingaRating
from stocvest.utils.config import get_settings


@pytest.mark.asyncio
@pytest.mark.unit
async def test_position_analyst_panel_unconfigured_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BENZINGA_ANALYST_KEY", raising=False)
    get_settings.cache_clear()
    try:
        panel = await pap.build_position_analyst_panel("AAPL", current_price=100.0)
    finally:
        get_settings.cache_clear()
    assert panel["feed_state"] == "unconfigured"
    assert panel["ratings"] == []
    assert panel["symbol"] == "AAPL"


@pytest.mark.asyncio
@pytest.mark.unit
async def test_position_analyst_panel_formats_ratings_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BENZINGA_ANALYST_KEY", "test-key")
    get_settings.cache_clear()

    rating = BenzingaRating(
        symbol="AAPL",
        action="Upgrades",
        rating="Buy",
        price_target=250.0,
        analyst_firm="Morgan Stanley",
        published_at=datetime.now(timezone.utc),
    )

    class _FakeBenzinga:
        async def get_analyst_ratings(self, symbol: str, days: int = 30) -> list[BenzingaRating]:
            return [rating]

    monkeypatch.setattr(pap, "BenzingaClient", lambda: _FakeBenzinga())
    try:
        panel = await pap.build_position_analyst_panel("AAPL", current_price=200.0)
    finally:
        get_settings.cache_clear()

    assert panel["feed_state"] == "available"
    assert panel["total_found"] == 1
    assert panel["ratings"][0]["firm"] == "Morgan Stanley"
    # +25% upside from 200 -> 250 PT.
    assert panel["ratings"][0]["upside_pct"] == 25.0


@pytest.mark.asyncio
@pytest.mark.unit
async def test_position_analyst_panel_never_raises_on_fetch_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BENZINGA_ANALYST_KEY", "test-key")
    get_settings.cache_clear()

    class _BoomBenzinga:
        async def get_analyst_ratings(self, symbol: str, days: int = 30) -> list[BenzingaRating]:
            raise RuntimeError("network down")

    monkeypatch.setattr(pap, "BenzingaClient", lambda: _BoomBenzinga())
    try:
        panel = await pap.build_position_analyst_panel("AAPL")
    finally:
        get_settings.cache_clear()

    # Configured but fetch failed -> empty, not unconfigured, and no exception.
    assert panel["feed_state"] == "empty"
    assert panel["ratings"] == []
