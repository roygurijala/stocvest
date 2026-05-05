"""SEC EDGAR current 8-K filings via public Atom feed (no API key; User-Agent required)."""

from __future__ import annotations

import asyncio
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Awaitable, Callable

import httpx

from stocvest.data.models import NewsArticle
from stocvest.utils.logging import get_logger

log = get_logger(__name__)

SEC_USER_AGENT = "STOCVEST/1.0 support@stocvest.app"
EDGAR_8K_ATOM_URL = (
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K"
    "&dateb=&owner=include&count=40&search_text=&output=atom"
)
COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

_ATOM_NS = "http://www.w3.org/2005/Atom"


def _local_name(tag: str) -> str:
    if tag.startswith("{"):
        return tag.split("}", 1)[-1]
    return tag


def _text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return str(el.text).strip()


def _find_first(entry: ET.Element, *names: str) -> ET.Element | None:
    for name in names:
        for child in entry:
            if _local_name(child.tag) == name:
                return child
    return None


def _find_all_text(entry: ET.Element, name: str) -> list[str]:
    return [_text(c) for c in entry if _local_name(c.tag) == name and _text(c)]


def _parse_cik_from_href(href: str) -> str | None:
    if not href:
        return None
    m = re.search(r"CIK[=](\d{1,10})", href, re.I)
    if m:
        return m.group(1).zfill(10)
    m = re.search(r"/data/(\d{1,10})/", href)
    if m:
        return m.group(1).zfill(10)
    m = re.search(r"Archives/edgar/data/(\d{1,10})/", href, re.I)
    if m:
        return m.group(1).zfill(10)
    return None


@dataclass(frozen=True)
class EdgarFiling:
    filing_id: str
    company_name: str
    ticker: str | None
    cik: str
    filed_at: datetime
    filing_url: str
    title: str
    summary: str
    source: str = "sec_edgar"


def edgar_filing_to_news_article(f: EdgarFiling) -> NewsArticle:
    """Map EDGAR row to canonical NewsArticle for SQS / downstream consumers."""
    head = f.title.strip()
    title_out = f"{f.company_name}: {head}" if head else f.company_name
    return NewsArticle(
        article_id=f.filing_id,
        published_at=f.filed_at,
        title=title_out,
        description=f.summary or None,
        image_url=None,
        url=f.filing_url,
        source=f.source,
        tickers=[f.ticker] if f.ticker else [],
        keywords=[],
        company_name=f.company_name,
        categories=["8-K", "regulatory"],
    )


class EdgarClient:
    """Poll SEC 8-K Atom feed and resolve tickers via company_tickers.json."""

    def __init__(
        self,
        *,
        feed_url: str = EDGAR_8K_ATOM_URL,
        poll_interval_seconds: float = 60.0,
        http_timeout: float = 30.0,
    ) -> None:
        self._feed_url = feed_url
        self._poll_interval_seconds = poll_interval_seconds
        self._http_timeout = http_timeout
        self._seen: set[str] = set()
        self._stop = asyncio.Event()
        self._backoff = 1.0
        self._ticker_map_day: date | None = None
        self._cik_to_ticker: dict[str, str] = {}
        self._lock = asyncio.Lock()

    def request_stop(self) -> None:
        """Request graceful shutdown (safe to call from a sync signal handler)."""
        self._stop.set()

    async def stop(self) -> None:
        self.request_stop()

    async def _fetch_text(self, client: httpx.AsyncClient, url: str) -> str:
        resp = await client.get(url, headers={"User-Agent": SEC_USER_AGENT})
        resp.raise_for_status()
        return resp.text

    def _parse_feed(self, xml_text: str) -> list[EdgarFiling]:
        root = ET.fromstring(xml_text)
        entries: list[ET.Element] = []
        if root.tag == f"{{{_ATOM_NS}}}feed" or _local_name(root.tag) == "feed":
            for child in root:
                if _local_name(child.tag) == "entry":
                    entries.append(child)
        out: list[EdgarFiling] = []
        for entry in entries:
            filing_id = _text(_find_first(entry, "id"))
            if not filing_id:
                continue
            title_el = _find_first(entry, "title")
            title_raw = _text(title_el)
            updated_el = _find_first(entry, "updated")
            updated_raw = _text(updated_el)
            summary_el = _find_first(entry, "summary")
            summary = _text(summary_el)
            company_names = _find_all_text(entry, "company-name")
            company_name = company_names[0] if company_names else ""

            filing_url = ""
            for child in entry:
                if _local_name(child.tag) != "link":
                    continue
                href = child.attrib.get("href", "")
                rel = child.attrib.get("rel", "alternate")
                if rel == "alternate" or not filing_url:
                    filing_url = href
            cik = _parse_cik_from_href(filing_url) or ""
            if not company_name and title_raw:
                company_name = title_raw.split(" - ", 1)[-1].strip()
            filed_at = datetime.now(timezone.utc)
            if updated_raw:
                try:
                    iso = updated_raw.replace("Z", "+00:00")
                    dt = datetime.fromisoformat(iso)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    filed_at = dt.astimezone(timezone.utc)
                except ValueError:
                    pass
            out.append(
                EdgarFiling(
                    filing_id=filing_id,
                    company_name=company_name or "Unknown issuer",
                    ticker=None,
                    cik=cik,
                    filed_at=filed_at,
                    filing_url=filing_url or "",
                    title=title_raw,
                    summary=summary,
                )
            )
        return out

    async def _resolve_ticker(self, cik: str) -> str | None:
        cik_norm = str(cik).strip().zfill(10)
        if not cik_norm or cik_norm == "0000000000":
            return None
        today = date.today()
        async with self._lock:
            if self._ticker_map_day != today or not self._cik_to_ticker:
                async with httpx.AsyncClient(
                    timeout=self._http_timeout,
                    headers={"User-Agent": SEC_USER_AGENT},
                ) as client:
                    raw = await self._fetch_text(client, COMPANY_TICKERS_URL)
                data = json.loads(raw)
                mapping: dict[str, str] = {}
                if isinstance(data, dict):
                    for _k, row in data.items():
                        if not isinstance(row, dict):
                            continue
                        raw_cik = row.get("cik_str")
                        tick = str(row.get("ticker") or "").strip().upper()
                        if raw_cik is None or not tick:
                            continue
                        cik_key = str(int(raw_cik)).zfill(10)
                        mapping[cik_key] = tick
                self._cik_to_ticker = mapping
                self._ticker_map_day = today
            return self._cik_to_ticker.get(cik_norm)

    async def start_polling(self, on_filing: Callable[[EdgarFiling], Awaitable[None] | None]) -> None:
        while not self._stop.is_set():
            try:
                async with httpx.AsyncClient(
                    timeout=self._http_timeout,
                    headers={"User-Agent": SEC_USER_AGENT},
                ) as client:
                    xml_text = await self._fetch_text(client, self._feed_url)
                filings = self._parse_feed(xml_text)
                self._backoff = 1.0
                for f in filings:
                    if f.filing_id in self._seen:
                        continue
                    self._seen.add(f.filing_id)
                    ticker = await self._resolve_ticker(f.cik) if f.cik else None
                    enriched = EdgarFiling(
                        filing_id=f.filing_id,
                        company_name=f.company_name,
                        ticker=ticker,
                        cik=f.cik,
                        filed_at=f.filed_at,
                        filing_url=f.filing_url,
                        title=f.title,
                        summary=f.summary,
                    )
                    log.info(
                        "New SEC 8-K filing id=%s cik=%s ticker=%s",
                        enriched.filing_id,
                        enriched.cik,
                        enriched.ticker or "-",
                    )
                    res = on_filing(enriched)
                    if asyncio.iscoroutine(res):
                        await res
            except Exception as exc:
                log.warning("EDGAR poll failed: %s — backing off %.1fs", exc, self._backoff)
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=self._backoff)
                    break
                except TimeoutError:
                    pass
                self._backoff = min(self._backoff * 2, 60.0)
                continue
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._poll_interval_seconds)
            except TimeoutError:
                pass
