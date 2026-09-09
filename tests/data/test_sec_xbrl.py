"""Unit tests for the SEC XBRL companyfacts fetcher (ADR-004 POS-AI-10, no network)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from stocvest.data import edgar_10k as e10k
from stocvest.data import sec_xbrl as xb
from stocvest.data.edgar_10k import reset_edgar_10k_cache_for_tests
from stocvest.data.sec_xbrl import extract_company_facts, fetch_company_facts

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    reset_edgar_10k_cache_for_tests()
    yield
    reset_edgar_10k_cache_for_tests()


def _usd(val: float, *, end: str, fy: int, fp: str = "FY", form: str = "10-K", filed: str = "") -> dict:
    return {"end": end, "val": val, "fy": fy, "fp": fp, "form": form, "filed": filed or f"{fy}-11-01"}


def _companyfacts() -> dict:
    return {
        "cik": 320193,
        "entityName": "Apple Inc.",
        "facts": {
            "us-gaap": {
                "Revenues": {
                    "units": {
                        "USD": [
                            _usd(300, end="2023-09-30", fy=2023),
                            # newest FY should win over an older one
                            _usd(383, end="2024-09-28", fy=2024, filed="2024-11-01"),
                            # a quarterly entry must be ignored (fp != FY)
                            _usd(90, end="2024-06-30", fy=2024, fp="Q3", form="10-Q"),
                        ]
                    }
                },
                "NetIncomeLoss": {"units": {"USD": [_usd(97, end="2024-09-28", fy=2024)]}},
                "Assets": {"units": {"USD": [_usd(352, end="2024-09-28", fy=2024)]}},
                "Liabilities": {"units": {"USD": [_usd(308, end="2024-09-28", fy=2024)]}},
                "StockholdersEquity": {"units": {"USD": [_usd(56, end="2024-09-28", fy=2024)]}},
                "EarningsPerShareDiluted": {
                    "units": {"USD/shares": [_usd(6.13, end="2024-09-28", fy=2024)]}
                },
            }
        },
    }


# --------------------------------------------------------------------------- extraction


def test_extract_picks_latest_annual_and_ignores_quarters() -> None:
    entity, facts = extract_company_facts(_companyfacts())
    assert entity == "Apple Inc."
    by_key = {f.key: f for f in facts}
    assert set(by_key) == {
        "revenue",
        "net_income",
        "total_assets",
        "total_liabilities",
        "stockholders_equity",
        "diluted_eps",
    }
    rev = by_key["revenue"]
    assert rev.value == 383  # newest FY, not the older 300 or the Q3 90
    assert rev.fiscal_year == 2024
    assert rev.period_end == "2024-09-28"
    assert rev.unit == "USD"
    assert by_key["diluted_eps"].unit == "USD/shares"


def test_extract_prefers_first_candidate_tag_with_data() -> None:
    data = {
        "entityName": "X",
        "facts": {
            "us-gaap": {
                # preferred tag present → used; fallback ignored
                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                    "units": {"USD": [_usd(500, end="2024-12-31", fy=2024)]}
                },
                "Revenues": {"units": {"USD": [_usd(999, end="2024-12-31", fy=2024)]}},
            }
        },
    }
    _entity, facts = extract_company_facts(data)
    rev = next(f for f in facts if f.key == "revenue")
    assert rev.value == 500


def test_extract_falls_back_to_next_tag_when_preferred_absent() -> None:
    data = {
        "facts": {"us-gaap": {"Revenues": {"units": {"USD": [_usd(777, end="2024-12-31", fy=2024)]}}}}
    }
    _entity, facts = extract_company_facts(data)
    assert next(f for f in facts if f.key == "revenue").value == 777


def test_extract_skips_concepts_without_annual_data() -> None:
    data = {
        "facts": {
            "us-gaap": {
                # only a quarterly entry → concept dropped entirely
                "NetIncomeLoss": {"units": {"USD": [_usd(1, end="2024-06-30", fy=2024, fp="Q2", form="10-Q")]}}
            }
        }
    }
    _entity, facts = extract_company_facts(data)
    assert facts == []


def test_extract_handles_malformed_payloads() -> None:
    assert extract_company_facts(None) == ("", [])
    assert extract_company_facts({"facts": {"us-gaap": "nope"}}) == ("", [])
    assert extract_company_facts({"facts": {}}) == ("", [])


# --------------------------------------------------------------------------- fetch (mocked)

_TICKERS = json.dumps({"0": {"cik_str": 320193, "ticker": "aapl", "title": "APPLE INC"}})


@pytest.mark.asyncio
@respx.mock
async def test_fetch_company_facts_happy_path() -> None:
    respx.get(e10k.COMPANY_TICKERS_URL).mock(return_value=httpx.Response(200, text=_TICKERS))
    respx.get(xb.COMPANYFACTS_URL.format(cik10="0000320193")).mock(
        return_value=httpx.Response(200, text=json.dumps(_companyfacts()))
    )
    out = await fetch_company_facts("aapl")
    assert out is not None
    assert out.symbol == "AAPL"
    assert out.entity_name == "Apple Inc."
    assert out.has_data is True
    assert "CIK=0000320193" in out.source_url
    d = out.to_api_dict()
    assert d["scored"] is False
    assert len(d["facts"]) == 6


@pytest.mark.asyncio
@respx.mock
async def test_fetch_company_facts_unknown_ticker_returns_none() -> None:
    respx.get(e10k.COMPANY_TICKERS_URL).mock(return_value=httpx.Response(200, text=_TICKERS))
    assert await fetch_company_facts("ZZZZ") is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_company_facts_swallows_network_error() -> None:
    respx.get(e10k.COMPANY_TICKERS_URL).mock(side_effect=httpx.ConnectError("boom"))
    assert await fetch_company_facts("AAPL") is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_company_facts_none_when_no_usable_facts() -> None:
    respx.get(e10k.COMPANY_TICKERS_URL).mock(return_value=httpx.Response(200, text=_TICKERS))
    respx.get(xb.COMPANYFACTS_URL.format(cik10="0000320193")).mock(
        return_value=httpx.Response(200, text=json.dumps({"entityName": "Apple", "facts": {"us-gaap": {}}}))
    )
    assert await fetch_company_facts("AAPL") is None


async def test_fetch_company_facts_empty_symbol_returns_none() -> None:
    assert await fetch_company_facts("") is None
