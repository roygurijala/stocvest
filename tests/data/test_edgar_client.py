"""Unit tests for SEC EDGAR Atom client (no network)."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest
import respx

from stocvest.data.edgar_client import (
    EdgarClient,
    EdgarFiling,
    _parse_cik_from_href,
    edgar_filing_to_news_article,
)
from stocvest.data import edgar_client as ec

SAMPLE_ATOM = """<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Latest Filings - Mon, 05 May 2026 14:00:00 EDT</title>
  <entry>
    <title>8-K - EXAMPLE CORP</title>
    <link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/example-8k.htm"/>
    <summary type="html">Material agreement</summary>
    <updated>2026-05-05T18:30:00-04:00</updated>
    <category label="form type" scheme="https://www.sec.gov/" term="8-K"/>
    <id>urn:tag:sec.gov,2008:accession-number=0001045810-26-000001</id>
    <company-name>EXAMPLE CORP</company-name>
  </entry>
</feed>
"""


class TestParseCik:
    def test_archives_path(self) -> None:
        assert _parse_cik_from_href(
            "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/x.htm"
        ) == "0001045810"

    def test_cik_equals_query(self) -> None:
        assert _parse_cik_from_href("https://www.sec.gov/cgi-bin/viewer?action=view&CIK=320193") == "0000320193"


class TestParseFeed:
    def test_parse_atom_entry(self) -> None:
        c = EdgarClient()
        rows = c._parse_feed(SAMPLE_ATOM)
        assert len(rows) == 1
        r = rows[0]
        assert "accession-number=0001045810-26-000001" in r.filing_id
        assert r.company_name == "EXAMPLE CORP"
        assert r.cik == "0001045810"
        assert r.title == "8-K - EXAMPLE CORP"
        assert r.summary == "Material agreement"
        assert r.filed_at.tzinfo is not None
        assert r.filed_at.year == 2026


class TestEdgarToNewsArticle:
    def test_mapping(self) -> None:
        f = EdgarFiling(
            filing_id="urn:x",
            company_name="ACME",
            ticker="ACM",
            cik="0001045810",
            filed_at=datetime(2026, 5, 5, 12, 0, tzinfo=timezone.utc),
            filing_url="https://www.sec.gov/x.htm",
            title="8-K",
            summary="Hello",
        )
        art = edgar_filing_to_news_article(f)
        assert art.article_id == "urn:x"
        assert art.title == "ACME: 8-K"
        assert art.description == "Hello"
        assert art.url == "https://www.sec.gov/x.htm"
        assert art.source == "sec_edgar"
        assert art.tickers == ["ACM"]
        assert art.categories == ["8-K", "regulatory"]
        assert art.company_name == "ACME"


@pytest.mark.asyncio
@respx.mock
async def test_resolve_ticker_fetches_once_per_day_cache() -> None:
    tickers_payload = '{"0":{"cik_str":1045810,"ticker":"exmp","title":"EXAMPLE"}}'
    route = respx.get(ec.COMPANY_TICKERS_URL).mock(return_value=httpx.Response(200, text=tickers_payload))
    c = EdgarClient()
    assert await c._resolve_ticker("1045810") == "EXMP"
    assert await c._resolve_ticker("1045810") == "EXMP"
    assert route.call_count == 1
