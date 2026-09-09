"""Unit tests for the EDGAR 10-K Item 1A excerpt fetcher (ADR-004 POS-AI-4, no network)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from stocvest.data import edgar_10k as e10k
from stocvest.data.edgar_10k import (
    extract_item_1a,
    fetch_10k_item_1a,
    html_to_text,
    reset_edgar_10k_cache_for_tests,
    _select_latest_10k,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    reset_edgar_10k_cache_for_tests()
    yield
    reset_edgar_10k_cache_for_tests()


# --------------------------------------------------------------------------- extraction

_RISK_BODY = (
    "Our business faces numerous risks. Supply chain concentration in a small number of "
    "vendors could materially and adversely affect our results if any vendor fails to "
    "deliver. Foreign currency fluctuations may reduce reported revenue. Cybersecurity "
    "incidents could disrupt operations and harm our reputation over an extended period."
)


def _tenk_html() -> str:
    return f"""
    <html><body>
      <table><tr><td>Item 1A.</td><td>Risk Factors</td><td>15</td></tr></table>
      <h2>Item&nbsp;1A. Risk Factors</h2>
      <p>{_RISK_BODY}</p>
      <h2>Item 1B. Unresolved Staff Comments</h2>
      <p>None.</p>
      <h2>Item 2. Properties</h2>
    </body></html>
    """


def test_html_to_text_strips_tags_and_entities() -> None:
    txt = html_to_text("<p>A&amp;B&nbsp;C</p><script>ignore()</script>")
    assert "A&B C" in txt
    assert "ignore" not in txt


def test_extract_item_1a_skips_toc_and_stops_at_item_1b() -> None:
    out = extract_item_1a(_tenk_html())
    assert out is not None
    excerpt, truncated = out
    assert truncated is False
    assert "Supply chain concentration" in excerpt
    assert "Unresolved Staff Comments" not in excerpt  # stopped at Item 1B
    assert "Risk Factors" not in excerpt  # heading itself consumed


def test_extract_item_1a_truncates_long_section() -> None:
    long_body = "Risk. " * 2000
    html = f"<h2>Item 1A. Risk Factors</h2><p>{long_body}</p><h2>Item 1B. Other</h2>"
    out = extract_item_1a(html, max_chars=500)
    assert out is not None
    excerpt, truncated = out
    assert truncated is True
    assert excerpt.endswith("…")
    assert len(excerpt) <= 502


def test_extract_item_1a_returns_none_when_absent() -> None:
    assert extract_item_1a("<p>Item 1. Business. Nothing else here.</p>") is None


def test_extract_item_1a_returns_none_when_too_short() -> None:
    html = "<h2>Item 1A. Risk Factors</h2><p>Short.</p><h2>Item 1B.</h2>"
    assert extract_item_1a(html) is None


def test_select_latest_10k_picks_first_annual_form() -> None:
    submissions = {
        "filings": {
            "recent": {
                "form": ["8-K", "10-Q", "10-K", "10-K"],
                "accessionNumber": ["a-0", "a-1", "0000320193-23-000106", "a-3"],
                "primaryDocument": ["d0.htm", "d1.htm", "aapl-10k.htm", "d3.htm"],
                "filingDate": ["2026-01-01", "2025-11-01", "2025-10-30", "2024-10-30"],
            }
        }
    }
    selected = _select_latest_10k(submissions)
    assert selected == ("0000320193-23-000106", "aapl-10k.htm", "2025-10-30", "10-K")


def test_select_latest_10k_none_when_no_annual_form() -> None:
    submissions = {"filings": {"recent": {"form": ["8-K"], "accessionNumber": ["a"], "primaryDocument": ["d"], "filingDate": ["2026-01-01"]}}}
    assert _select_latest_10k(submissions) is None


# --------------------------------------------------------------------------- fetch (mocked)

_TICKERS = json.dumps({"0": {"cik_str": 320193, "ticker": "aapl", "title": "APPLE INC"}})


def _submissions() -> str:
    return json.dumps(
        {
            "filings": {
                "recent": {
                    "form": ["10-K"],
                    "accessionNumber": ["0000320193-23-000106"],
                    "primaryDocument": ["aapl-10k.htm"],
                    "filingDate": ["2025-10-30"],
                }
            }
        }
    )


@pytest.mark.asyncio
@respx.mock
async def test_fetch_10k_item_1a_happy_path() -> None:
    respx.get(e10k.COMPANY_TICKERS_URL).mock(return_value=httpx.Response(200, text=_TICKERS))
    respx.get(e10k.SUBMISSIONS_URL.format(cik10="0000320193")).mock(
        return_value=httpx.Response(200, text=_submissions())
    )
    doc_url = e10k.ARCHIVES_DOC_URL.format(
        cik="320193", accession="000032019323000106", doc="aapl-10k.htm"
    )
    respx.get(doc_url).mock(return_value=httpx.Response(200, text=_tenk_html()))

    out = await fetch_10k_item_1a("AAPL")
    assert out is not None
    assert out.symbol == "AAPL"
    assert out.form == "10-K"
    assert out.filing_date == "2025-10-30"
    assert out.source_url == doc_url
    assert out.truncated is False
    assert "Supply chain concentration" in out.excerpt
    d = out.to_api_dict()
    assert d["scored"] is False


@pytest.mark.asyncio
@respx.mock
async def test_fetch_10k_item_1a_unknown_ticker_returns_none() -> None:
    respx.get(e10k.COMPANY_TICKERS_URL).mock(return_value=httpx.Response(200, text=_TICKERS))
    assert await fetch_10k_item_1a("ZZZZ") is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_10k_item_1a_swallows_network_error() -> None:
    respx.get(e10k.COMPANY_TICKERS_URL).mock(side_effect=httpx.ConnectError("boom"))
    assert await fetch_10k_item_1a("AAPL") is None


@pytest.mark.asyncio
@respx.mock
async def test_fetch_10k_item_1a_none_when_no_annual_filing() -> None:
    respx.get(e10k.COMPANY_TICKERS_URL).mock(return_value=httpx.Response(200, text=_TICKERS))
    no_10k = json.dumps({"filings": {"recent": {"form": ["8-K"], "accessionNumber": ["a"], "primaryDocument": ["d.htm"], "filingDate": ["2026-01-01"]}}})
    respx.get(e10k.SUBMISSIONS_URL.format(cik10="0000320193")).mock(
        return_value=httpx.Response(200, text=no_10k)
    )
    assert await fetch_10k_item_1a("AAPL") is None
