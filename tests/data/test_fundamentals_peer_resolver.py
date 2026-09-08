"""Position peer resolver — bounded peer lists for F4."""

from __future__ import annotations

import pytest

from stocvest.data.fundamentals_peer_resolver import resolve_position_peers
from stocvest.data.fundamentals_provider import FundamentalsProviderFixtures, FundamentalsProviderMock


@pytest.mark.unit
class TestResolvePositionPeers:
    @pytest.mark.asyncio
    async def test_empty_symbol_returns_empty(self) -> None:
        assert await resolve_position_peers("  ") == []

    @pytest.mark.asyncio
    async def test_delegates_to_provider(self) -> None:
        fixtures = FundamentalsProviderFixtures(sector_peers={"NVDA": ["AMD", "AVGO", "NVDA"]})
        mock = FundamentalsProviderMock(fixtures)
        peers = await resolve_position_peers("NVDA", mock, limit=10)
        assert peers == ["AMD", "AVGO"]

    @pytest.mark.asyncio
    async def test_never_raises_when_provider_fails(self) -> None:
        class BrokenMock(FundamentalsProviderMock):
            async def get_sector_peers(self, symbol: str, *, limit: int = 15) -> list[str]:
                raise RuntimeError("boom")

        assert await resolve_position_peers("AAPL", BrokenMock()) == []

    @pytest.mark.asyncio
    async def test_sector_etf_param_accepted_but_unused_v1(self) -> None:
        fixtures = FundamentalsProviderFixtures(sector_peers={"AAPL": ["MSFT"]})
        mock = FundamentalsProviderMock(fixtures)
        peers = await resolve_position_peers("AAPL", mock, sector_etf="XLK")
        assert peers == ["MSFT"]
