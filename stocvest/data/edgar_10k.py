"""SEC EDGAR 10-K "Item 1A · Risk Factors" excerpt — ADR-004 POS-AI-4 (external, not scored).

Best-effort fetch of a company's most recent annual report (10-K) risk-factor section
straight from the primary source (SEC EDGAR — no API key, only a descriptive User-Agent).

Pipeline (all endpoints documented at sec.gov/…/edgar-application-programming-interfaces):
  1. ticker -> CIK      via the public ``company_tickers.json`` map (daily-cached)
  2. CIK -> latest 10-K via ``data.sec.gov/submissions/CIK##########.json`` (form == 10-K)
  3. primary document   via ``www.sec.gov/Archives/edgar/data/<cik>/<accession>/<doc>``
  4. Item 1A extraction via a tolerant text heuristic, then hard-truncated

This is deliberately conservative and honest: 10-K HTML layout varies wildly, so the
excerpt is a *truncated pointer* to the filing, always shown with the source URL and badged
"External · not scored". Any failure returns ``None`` — the caller degrades gracefully and
NEVER blocks the Position read or mutates pillar math on this content.
"""

from __future__ import annotations

import html as _html
import json
import re
import threading
from dataclasses import dataclass
from datetime import date

import httpx

from stocvest.data.edgar_client import COMPANY_TICKERS_URL, SEC_USER_AGENT
from stocvest.utils.logging import get_logger

log = get_logger(__name__)

SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik10}.json"
ARCHIVES_DOC_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{doc}"

# Domestic 10-K family only: the Item 1A extractor understands the U.S. "Item 1A · Risk
# Factors" layout. Foreign-issuer annual reports (20-F use "Item 3.D", 40-F differs) would
# always fetch then fail extraction, so they are excluded to avoid wasted SEC calls.
_TENK_FORMS = ("10-K", "10-K405", "10-KSB")
_DEFAULT_MAX_CHARS = 4000
# Per-section cap for multi-section RAG retrieval (larger than the 1A excerpt — this text is
# chunked + retrieved, not shown whole).
_SECTION_MAX_CHARS = 12000
_MIN_USEFUL_CHARS = 200
_HTTP_TIMEOUT = 20.0

# Daily-cached ticker -> CIK(10-digit) map (company_tickers.json is ~1 MB).
_cik_map: dict[str, str] = {}
_cik_map_day: date | None = None
_cik_lock = threading.Lock()


@dataclass(frozen=True)
class TenKRiskExcerpt:
    """A truncated, primary-source 10-K Item 1A excerpt — informational, never scored."""

    symbol: str
    excerpt: str
    source_url: str
    filing_date: str  # ISO yyyy-mm-dd (as reported by EDGAR), "" if unknown
    form: str
    truncated: bool

    def to_api_dict(self) -> dict[str, object]:
        return {
            "symbol": self.symbol,
            "excerpt": self.excerpt,
            "source_url": self.source_url,
            "filing_date": self.filing_date,
            "form": self.form,
            "truncated": self.truncated,
            "scored": False,  # explicit: this text never feeds the composite
        }


# --------------------------------------------------------------------------- extraction

_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_WS_RE = re.compile(r"[ \t\r\f\v]+")
_MULTI_NL_RE = re.compile(r"\n{3,}")
# "Item 1A. Risk Factors" (dot/colon/paren optional, flexible whitespace incl. &nbsp;→space).
_ITEM_1A_HEAD_RE = re.compile(r"item\s*1a[\.\):\s]+risk\s+factors", re.IGNORECASE)
_ITEM_1A_BARE_RE = re.compile(r"item\s*1a\b", re.IGNORECASE)
_ITEM_END_RE = re.compile(r"item\s*1b\b|item\s*2\b", re.IGNORECASE)


@dataclass(frozen=True)
class _SectionSpec:
    section_id: str
    label: str
    head_re: re.Pattern[str]
    bare_re: re.Pattern[str]
    end_re: re.Pattern[str]


# POS-AI-10 RAG: the annual-report sections worth retrieving over (in 10-K item order).
# Each has a precise heading, a bare fallback, and the next-item anchor that bounds it.
_SECTION_SPECS: tuple[_SectionSpec, ...] = (
    _SectionSpec(
        "item1",
        "Item 1 · Business",
        re.compile(r"item\s*1[\.\):\s]+business", re.IGNORECASE),
        re.compile(r"item\s*1\b(?!\s*a)", re.IGNORECASE),
        re.compile(r"item\s*1a\b|item\s*1b\b", re.IGNORECASE),
    ),
    _SectionSpec(
        "item1a",
        "Item 1A · Risk Factors",
        _ITEM_1A_HEAD_RE,
        _ITEM_1A_BARE_RE,
        _ITEM_END_RE,
    ),
    _SectionSpec(
        "item7",
        "Item 7 · MD&A",
        re.compile(r"item\s*7[\.\):\s]+management", re.IGNORECASE),
        re.compile(r"item\s*7\b(?!\s*a)", re.IGNORECASE),
        re.compile(r"item\s*7a\b|item\s*8\b", re.IGNORECASE),
    ),
)


def html_to_text(raw: str) -> str:
    """Strip a filing's HTML to readable plain text (scripts/styles removed, entities decoded)."""
    if not raw:
        return ""
    no_scripts = _SCRIPT_STYLE_RE.sub(" ", raw)
    # Turn block-ish boundaries into newlines before stripping the rest of the tags.
    with_breaks = re.sub(r"(?i)</(p|div|tr|td|th|li|h[1-6]|table)>", "\n", no_scripts)
    with_breaks = re.sub(r"(?i)<br\s*/?>", "\n", with_breaks)
    text = _TAG_RE.sub(" ", with_breaks)
    text = _html.unescape(text)
    text = text.replace("\xa0", " ")
    text = _WS_RE.sub(" ", text)
    text = _MULTI_NL_RE.sub("\n\n", text)
    return text.strip()


def extract_item_1a(document: str, *, max_chars: int = _DEFAULT_MAX_CHARS) -> tuple[str, bool] | None:
    """Extract the Item 1A "Risk Factors" section from a 10-K document (HTML or text).

    Returns ``(excerpt, truncated)`` or ``None`` when the section cannot be located with
    enough content. Chooses the LAST qualifying heading so a Table-of-Contents entry is
    skipped in favor of the real body section. Purely lexical — no network.
    """
    text = html_to_text(document) if "<" in document else document
    if not text:
        return None

    # Prefer full "Item 1A ... Risk Factors" headings; fall back to a bare "Item 1A".
    heads = list(_ITEM_1A_HEAD_RE.finditer(text)) or list(_ITEM_1A_BARE_RE.finditer(text))
    if not heads:
        return None

    for head in reversed(heads):  # last real body occurrence wins over the TOC
        start = head.end()
        end_match = _ITEM_END_RE.search(text, start)
        end = end_match.start() if end_match else len(text)
        section = text[start:end].strip(" .:\u2014-\n")
        if len(section) >= _MIN_USEFUL_CHARS:
            if max_chars and len(section) > max_chars:
                return section[:max_chars].rstrip() + " …", True
            return section, False
    return None


def _extract_by_spec(text: str, spec: _SectionSpec, *, max_chars: int) -> tuple[str, bool] | None:
    """Generic 'last real heading wins' section extraction (POS-AI-10 multi-section RAG)."""
    heads = list(spec.head_re.finditer(text)) or list(spec.bare_re.finditer(text))
    if not heads:
        return None
    for head in reversed(heads):
        start = head.end()
        end_match = spec.end_re.search(text, start)
        end = end_match.start() if end_match else len(text)
        section = text[start:end].strip(" .:\u2014-\n")
        if len(section) >= _MIN_USEFUL_CHARS:
            if max_chars and len(section) > max_chars:
                return section[:max_chars].rstrip() + " …", True
            return section, False
    return None


def extract_sections(
    document: str, *, max_chars_each: int = _SECTION_MAX_CHARS
) -> list[tuple[str, str, str]]:
    """Extract the RAG sections (Business, Risk Factors, MD&A) from a 10-K.

    Returns a list of ``(section_id, label, text)`` for every section that resolves with
    enough content. Purely lexical — no network. Empty list when none are found.
    """
    text = html_to_text(document) if "<" in document else document
    if not text:
        return []
    out: list[tuple[str, str, str]] = []
    for spec in _SECTION_SPECS:
        got = _extract_by_spec(text, spec, max_chars=max_chars_each)
        if got is not None:
            out.append((spec.section_id, spec.label, got[0]))
    return out


# --------------------------------------------------------------------------- fetch

async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    resp = await client.get(url, headers={"User-Agent": SEC_USER_AGENT})
    resp.raise_for_status()
    return resp.text


async def _resolve_cik(client: httpx.AsyncClient, symbol: str) -> str | None:
    global _cik_map, _cik_map_day
    sym = (symbol or "").strip().upper()
    if not sym:
        return None
    today = date.today()
    with _cik_lock:
        cached = dict(_cik_map) if _cik_map_day == today and _cik_map else None
    if cached is None:
        raw = await _fetch_text(client, COMPANY_TICKERS_URL)
        data = json.loads(raw)
        mapping: dict[str, str] = {}
        if isinstance(data, dict):
            for row in data.values():
                if not isinstance(row, dict):
                    continue
                tick = str(row.get("ticker") or "").strip().upper()
                raw_cik = row.get("cik_str")
                if not tick or raw_cik is None:
                    continue
                try:
                    mapping[tick] = str(int(raw_cik)).zfill(10)
                except (TypeError, ValueError):
                    continue
        with _cik_lock:
            _cik_map = mapping
            _cik_map_day = today
        cached = mapping
    return cached.get(sym)


def _select_latest_10k(submissions: dict) -> tuple[str, str, str, str] | None:
    """Return (accession_no, primary_document, filing_date, form) for the newest annual report."""
    recent = (submissions.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    accessions = recent.get("accessionNumber") or []
    docs = recent.get("primaryDocument") or []
    dates = recent.get("filingDate") or []
    n = min(len(forms), len(accessions), len(docs), len(dates))
    # Arrays are newest-first; take the first matching annual form.
    for i in range(n):
        form = str(forms[i] or "").strip().upper()
        if form in _TENK_FORMS:
            accession = str(accessions[i] or "").strip()
            doc = str(docs[i] or "").strip()
            if accession and doc:
                return accession, doc, str(dates[i] or "").strip(), form
    return None


@dataclass(frozen=True)
class TenKDocument:
    """The newest 10-K primary document + provenance, before section extraction."""

    symbol: str
    document: str
    source_url: str
    filing_date: str
    form: str


@dataclass(frozen=True)
class TenKSections:
    """Multi-section 10-K text for RAG retrieval — informational, never scored."""

    symbol: str
    sections: list[tuple[str, str, str]]  # (section_id, label, text)
    source_url: str
    filing_date: str
    form: str


async def fetch_latest_10k_document(symbol: str) -> TenKDocument | None:
    """Fetch the newest 10-K primary document for ``symbol`` (shared fetch pipeline).

    Best-effort and self-contained: any network/parse failure logs at WARNING and returns
    ``None``. Never raises to the caller.
    """
    sym = (symbol or "").strip().upper()
    if not sym:
        return None
    try:
        async with httpx.AsyncClient(
            timeout=_HTTP_TIMEOUT, headers={"User-Agent": SEC_USER_AGENT}
        ) as client:
            cik10 = await _resolve_cik(client, sym)
            if not cik10:
                return None
            subs_raw = await _fetch_text(client, SUBMISSIONS_URL.format(cik10=cik10))
            submissions = json.loads(subs_raw)
            selected = _select_latest_10k(submissions)
            if selected is None:
                return None
            accession, doc, filing_date, form = selected
            accession_nodash = accession.replace("-", "")
            cik_int = str(int(cik10))
            source_url = ARCHIVES_DOC_URL.format(
                cik=cik_int, accession=accession_nodash, doc=doc
            )
            document = await _fetch_text(client, source_url)
    except Exception as exc:  # noqa: BLE001 — external primary source is best-effort
        log.warning("edgar_10k fetch failed for %s: %s", sym, type(exc).__name__)
        return None
    return TenKDocument(
        symbol=sym,
        document=document,
        source_url=source_url,
        filing_date=filing_date,
        form=form,
    )


async def fetch_10k_item_1a(symbol: str, *, max_chars: int = _DEFAULT_MAX_CHARS) -> TenKRiskExcerpt | None:
    """Fetch the newest 10-K Item 1A risk-factor excerpt for ``symbol``, or ``None``."""
    doc = await fetch_latest_10k_document(symbol)
    if doc is None:
        return None
    extracted = extract_item_1a(doc.document, max_chars=max_chars)
    if extracted is None:
        return None
    excerpt, truncated = extracted
    return TenKRiskExcerpt(
        symbol=doc.symbol,
        excerpt=excerpt,
        source_url=doc.source_url,
        filing_date=doc.filing_date,
        form=doc.form,
        truncated=truncated,
    )


async def fetch_10k_sections(
    symbol: str, *, max_chars_each: int = _SECTION_MAX_CHARS
) -> TenKSections | None:
    """Fetch the newest 10-K and extract the RAG sections (Business, Risk Factors, MD&A)."""
    doc = await fetch_latest_10k_document(symbol)
    if doc is None:
        return None
    sections = extract_sections(doc.document, max_chars_each=max_chars_each)
    if not sections:
        return None
    return TenKSections(
        symbol=doc.symbol,
        sections=sections,
        source_url=doc.source_url,
        filing_date=doc.filing_date,
        form=doc.form,
    )


def reset_edgar_10k_cache_for_tests() -> None:
    """Clear the module-level ticker->CIK cache between tests."""
    global _cik_map, _cik_map_day
    with _cik_lock:
        _cik_map = {}
        _cik_map_day = None
