"""Fundamentals provider — FMP implementation and mock (no network in unit tests)."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
import respx

from stocvest.data.fundamentals_models import (
    BalanceSheet,
    CashFlowStatement,
    FinancialRatios,
    IncomeStatement,
    KeyMetrics,
)
from stocvest.data.fundamentals_provider import (
    FMPFundamentalsProvider,
    FundamentalsProvider,
    FundamentalsProviderFixtures,
    FundamentalsProviderMock,
    _normalize_peer_symbols,
    fetch_position_fundamentals_snapshot,
    get_fundamentals_provider,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "fmp"
FMP_BASE = "https://financialmodelingprep.com/stable"


def _load_json(name: str):
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


@pytest.mark.unit
class TestPeerNormalization:
    def test_excludes_subject_and_dedupes(self) -> None:
        raw = ["aapl", "MSFT", "msft", "GOOGL", "AAPL"]
        peers = _normalize_peer_symbols(raw, subject="AAPL", limit=10)
        assert peers == ["MSFT", "GOOGL"]

    def test_accepts_dict_rows(self) -> None:
        raw = [{"symbol": "MSFT"}, {"ticker": "GOOGL"}]
        peers = _normalize_peer_symbols(raw, subject="AAPL", limit=10)
        assert peers == ["MSFT", "GOOGL"]

    def test_accepts_peers_list_string(self) -> None:
        raw = [{"symbol": "AAPL", "peersList": "MSFT,GOOGL,META"}]
        peers = _normalize_peer_symbols(raw, subject="AAPL", limit=10)
        assert peers == ["MSFT", "GOOGL", "META"]

    def test_accepts_single_dict_wrapper(self) -> None:
        raw = {"peersList": "MSFT,GOOGL"}
        peers = _normalize_peer_symbols(raw, subject="AAPL", limit=10)
        assert peers == ["MSFT", "GOOGL"]

    def test_respects_limit(self) -> None:
        raw = ["MSFT", "GOOGL", "META", "AMZN"]
        peers = _normalize_peer_symbols(raw, subject="AAPL", limit=2)
        assert peers == ["MSFT", "GOOGL"]


@pytest.mark.unit
class TestFMPFundamentalsProvider:
    @pytest.mark.asyncio
    async def test_empty_symbol_returns_empty(self) -> None:
        provider = FMPFundamentalsProvider()
        with patch("stocvest.data.fundamentals_provider._api_key", return_value="key"):
            assert await provider.get_income_statements("  ") == []

    @pytest.mark.asyncio
    async def test_no_api_key_returns_empty_without_http(self) -> None:
        provider = FMPFundamentalsProvider()
        with patch("stocvest.data.fundamentals_provider._api_key", return_value=""):
            assert await provider.get_ratios("AAPL") == []

    @pytest.mark.asyncio
    @respx.mock
    async def test_fetches_and_parses_income_statements(self) -> None:
        rows = _load_json("aapl_income_quarter.json")
        route = respx.get(f"{FMP_BASE}/income-statement").mock(
            return_value=httpx.Response(200, json=rows)
        )
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=None),
            patch("stocvest.data.fundamentals_provider._cache_set") as cache_set,
        ):
            provider = FMPFundamentalsProvider()
            got = await provider.get_income_statements("AAPL", period="quarter", limit=8)

        assert route.called
        assert len(got) == 4
        assert got[0].symbol == "AAPL"
        assert got[0].as_of_date == date(2025, 3, 31)
        cache_set.assert_called_once()

    @pytest.mark.asyncio
    @respx.mock
    async def test_clamps_limit_in_request(self) -> None:
        route = respx.get(f"{FMP_BASE}/balance-sheet-statement").mock(
            return_value=httpx.Response(200, json=[])
        )
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=None),
            patch("stocvest.data.fundamentals_provider._cache_set"),
        ):
            provider = FMPFundamentalsProvider()
            await provider.get_balance_sheets("AAPL", limit=999)

        assert route.calls[0].request.url.params["limit"] == "40"

    @pytest.mark.asyncio
    @respx.mock
    async def test_cache_hit_skips_http(self) -> None:
        cached_row = CashFlowStatement(
            symbol="AAPL",
            as_of_date=date(2025, 3, 31),
            free_cash_flow=150.0,
        )
        cached_json = json.dumps([cached_row.model_dump(mode="json")])
        route = respx.get(f"{FMP_BASE}/cash-flow-statement").mock(
            return_value=httpx.Response(200, json=[])
        )
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=cached_json),
        ):
            provider = FMPFundamentalsProvider()
            got = await provider.get_cash_flows("AAPL")

        assert len(got) == 1
        assert got[0].free_cash_flow == 150.0
        assert not route.called

    @pytest.mark.asyncio
    async def test_http_error_never_raises(self) -> None:
        class BrokenClient:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return None

            async def get(self, *a, **k):
                raise RuntimeError("network down")

        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=None),
            patch("stocvest.data.fundamentals_provider._cache_set"),
            patch("stocvest.data.fundamentals_provider.httpx.AsyncClient", BrokenClient),
        ):
            provider = FMPFundamentalsProvider()
            assert await provider.get_key_metrics("ZZZ") == []

    @pytest.mark.asyncio
    @respx.mock
    async def test_filters_rows_with_mismatched_symbol(self) -> None:
        rows = [
            {"date": "2025-03-31", "symbol": "MSFT", "revenue": 1},
            {"date": "2025-03-31", "symbol": "AAPL", "revenue": 2},
        ]
        respx.get(f"{FMP_BASE}/income-statement").mock(
            return_value=httpx.Response(200, json=rows)
        )
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=None),
            patch("stocvest.data.fundamentals_provider._cache_set"),
        ):
            provider = FMPFundamentalsProvider()
            got = await provider.get_income_statements("AAPL")

        assert len(got) == 1
        assert got[0].symbol == "AAPL"

    @pytest.mark.asyncio
    @respx.mock
    async def test_dedupes_duplicate_statement_dates(self) -> None:
        rows = [
            {"date": "2025-03-31", "symbol": "AAPL", "revenue": 100},
            {"date": "2025-03-31", "symbol": "AAPL", "revenue": 999},
        ]
        respx.get(f"{FMP_BASE}/income-statement").mock(
            return_value=httpx.Response(200, json=rows)
        )
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=None),
            patch("stocvest.data.fundamentals_provider._cache_set"),
        ):
            provider = FMPFundamentalsProvider()
            got = await provider.get_income_statements("AAPL")

        assert len(got) == 1
        assert got[0].revenue == 100.0

    @pytest.mark.asyncio
    @respx.mock
    async def test_caches_empty_success_response(self) -> None:
        respx.get(f"{FMP_BASE}/ratios").mock(return_value=httpx.Response(200, json=[]))
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=None),
            patch("stocvest.data.fundamentals_provider._cache_set") as cache_set,
        ):
            provider = FMPFundamentalsProvider()
            assert await provider.get_ratios("AAPL") == []

        cache_set.assert_called_once()

    @pytest.mark.asyncio
    @respx.mock
    async def test_normalizes_class_share_symbol_on_wire(self) -> None:
        route = respx.get(f"{FMP_BASE}/income-statement").mock(
            return_value=httpx.Response(200, json=[])
        )
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=None),
            patch("stocvest.data.fundamentals_provider._cache_set"),
        ):
            provider = FMPFundamentalsProvider()
            await provider.get_income_statements("BRK-B")

        assert route.calls[0].request.url.params["symbol"] == "BRK.B"

    @pytest.mark.asyncio
    @respx.mock
    async def test_malformed_json_returns_empty(self) -> None:
        respx.get(f"{FMP_BASE}/ratios").mock(return_value=httpx.Response(200, json={"bad": True}))
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=None),
            patch("stocvest.data.fundamentals_provider._cache_set") as cache_set,
        ):
            provider = FMPFundamentalsProvider()
            assert await provider.get_ratios("AAPL") == []

        cache_set.assert_called_once()

    @pytest.mark.asyncio
    @respx.mock
    async def test_stock_peers_excludes_self(self) -> None:
        respx.get(f"{FMP_BASE}/stock-peers").mock(
            return_value=httpx.Response(200, json=["AAPL", "MSFT", "GOOGL"])
        )
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value=None),
            patch("stocvest.data.fundamentals_provider._cache_set"),
        ):
            provider = FMPFundamentalsProvider()
            peers = await provider.get_sector_peers("AAPL", limit=5)

        assert peers == ["MSFT", "GOOGL"]


@pytest.mark.unit
class TestFundamentalsProviderMock:
    @pytest.mark.asyncio
    async def test_returns_fixture_rows_sorted_and_limited(self) -> None:
        fixtures = FundamentalsProviderFixtures(
            income_statements={
                "AAPL": [
                    IncomeStatement(symbol="AAPL", as_of_date=date(2024, 1, 1), revenue=1.0),
                    IncomeStatement(symbol="AAPL", as_of_date=date(2025, 1, 1), revenue=2.0),
                ]
            },
            sector_peers={"AAPL": ["MSFT", "AAPL", "MSFT"]},
        )
        mock = FundamentalsProviderMock(fixtures)
        rows = await mock.get_income_statements("aapl", limit=1)
        peers = await mock.get_sector_peers("AAPL", limit=5)

        assert len(rows) == 1
        assert rows[0].as_of_date == date(2025, 1, 1)
        assert peers == ["MSFT"]
        assert ("income", "AAPL") in mock.call_log

    @pytest.mark.asyncio
    async def test_snapshot_bundle_uses_mock_and_sets_quality(self) -> None:
        fixtures = FundamentalsProviderFixtures(
            income_statements={
                "AAPL": [IncomeStatement(symbol="AAPL", as_of_date=date(2025, 3, 31), revenue=1.0)] * 4
            },
            balance_sheets={
                "AAPL": [BalanceSheet(symbol="AAPL", as_of_date=date(2025, 3, 31), total_assets=1.0)] * 4
            },
            cash_flows={
                "AAPL": [CashFlowStatement(symbol="AAPL", as_of_date=date(2025, 3, 31))] * 4
            },
            ratios={
                "AAPL": [FinancialRatios(symbol="AAPL", as_of_date=date(2025, 3, 31))] * 4
            },
            key_metrics={
                "AAPL": [KeyMetrics(symbol="AAPL", as_of_date=date(2025, 3, 31))] * 4
            },
            sector_peers={"AAPL": ["MSFT"]},
        )
        mock = FundamentalsProviderMock(fixtures)
        snap = await fetch_position_fundamentals_snapshot("AAPL", mock)

        assert snap.symbol == "AAPL"
        assert snap.configured is True
        assert snap.data_quality == "high"
        assert snap.sector_peers == ["MSFT"]


@pytest.mark.unit
def test_get_fundamentals_provider_returns_protocol() -> None:
    fmp = get_fundamentals_provider()
    mock = get_fundamentals_provider(mock=FundamentalsProviderMock())
    assert isinstance(fmp, FMPFundamentalsProvider)
    assert isinstance(mock, FundamentalsProviderMock)
    assert isinstance(mock, FundamentalsProvider)
