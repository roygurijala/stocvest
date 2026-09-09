"""SEC XBRL company-facts — ADR-004 POS-AI-10 (external primary source, INFORMATIONAL / not scored).

Best-effort fetch of a company's headline annual financials straight from the SEC's
structured XBRL ``companyfacts`` API (no API key, only a descriptive User-Agent):

    https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json

We surface a small, fixed set of well-known US-GAAP concepts (revenue, net income, total
assets/liabilities, shareholders' equity, diluted EPS) at their **latest reported fiscal
year** (form 10-K, period ``FY``). This is deliberately a *display* of primary-source
figures — we do NOT (yet) auto-reconcile them against FMP-derived pillar inputs, because a
robust cross-check needs careful US-GAAP tag disambiguation. Nothing here is scored, nothing
feeds the pillar math, and any failure returns ``None`` so the caller degrades gracefully.

CIK resolution reuses ``edgar_10k``'s daily-cached ticker→CIK map (so both SEC features share
one ``company_tickers.json`` fetch).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import httpx

from stocvest.data.edgar_10k import _resolve_cik  # shared daily ticker->CIK cache
from stocvest.data.edgar_client import SEC_USER_AGENT
from stocvest.utils.logging import get_logger

log = get_logger(__name__)

COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik10}.json"
# Human-browsable primary-source citation: the company's 10-K filing list on EDGAR.
EDGAR_FILINGS_URL = (
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik10}"
    "&type=10-K&dateb=&owner=include&count=40"
)

# Annual forms whose XBRL facts we treat as the fiscal-year figure.
_ANNUAL_FORMS = ("10-K", "10-K405", "10-KSB")
_HTTP_TIMEOUT = 20.0


@dataclass(frozen=True)
class _Concept:
    key: str
    label: str
    unit: str
    # Candidate US-GAAP tags, most-preferred first (companies tag revenue differently).
    tags: tuple[str, ...]


# Fixed, conservative concept set — headline income-statement + balance-sheet lines only.
_CONCEPTS: tuple[_Concept, ...] = (
    _Concept(
        "revenue",
        "Revenue",
        "USD",
        (
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "Revenues",
            "SalesRevenueNet",
        ),
    ),
    _Concept("net_income", "Net income", "USD", ("NetIncomeLoss",)),
    _Concept("total_assets", "Total assets", "USD", ("Assets",)),
    _Concept("total_liabilities", "Total liabilities", "USD", ("Liabilities",)),
    _Concept(
        "stockholders_equity",
        "Shareholders' equity",
        "USD",
        (
            "StockholdersEquity",
            "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
        ),
    ),
    _Concept("diluted_eps", "Diluted EPS", "USD/shares", ("EarningsPerShareDiluted",)),
)


@dataclass(frozen=True)
class XbrlFact:
    """One headline annual figure as reported to the SEC (informational, never scored)."""

    key: str
    label: str
    value: float
    unit: str
    fiscal_year: int | None
    period_end: str  # ISO yyyy-mm-dd
    form: str
    filed: str  # ISO yyyy-mm-dd

    def to_api_dict(self) -> dict[str, object]:
        return {
            "key": self.key,
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
            "fiscal_year": self.fiscal_year,
            "period_end": self.period_end,
            "form": self.form,
            "filed": self.filed,
        }


@dataclass(frozen=True)
class CompanyFacts:
    """A small bundle of latest-fiscal-year SEC XBRL facts for a symbol."""

    symbol: str
    entity_name: str
    facts: list[XbrlFact] = field(default_factory=list)
    source_url: str = ""

    @property
    def has_data(self) -> bool:
        return bool(self.facts)

    def to_api_dict(self) -> dict[str, object]:
        return {
            "symbol": self.symbol,
            "entity_name": self.entity_name,
            "facts": [f.to_api_dict() for f in self.facts],
            "source_url": self.source_url,
            "scored": False,  # explicit: primary-source display, never feeds the composite
        }


# --------------------------------------------------------------------------- extraction


def _coerce_float(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n and n not in (float("inf"), float("-inf")) else None


def _select_latest_annual(entries: object, unit: str) -> XbrlFact | None:
    """Pick the newest annual (form 10-K, fp=FY) entry from a unit array, or ``None``."""
    if not isinstance(entries, list):
        return None
    best: dict | None = None
    best_key: tuple[str, str] = ("", "")
    for row in entries:
        if not isinstance(row, dict):
            continue
        form = str(row.get("form") or "").strip().upper()
        fp = str(row.get("fp") or "").strip().upper()
        end = str(row.get("end") or "").strip()
        if form not in _ANNUAL_FORMS or fp != "FY" or not end:
            continue
        if _coerce_float(row.get("val")) is None:
            continue
        # Newest by period end, tie-broken by filing date (ISO strings sort correctly).
        sort_key = (end, str(row.get("filed") or ""))
        if best is None or sort_key > best_key:
            best = row
            best_key = sort_key
    if best is None:
        return None
    value = _coerce_float(best.get("val"))
    if value is None:
        return None
    fy_raw = best.get("fy")
    try:
        fiscal_year = int(fy_raw) if fy_raw is not None else None
    except (TypeError, ValueError):
        fiscal_year = None
    return XbrlFact(
        key="",  # filled by caller (concept key)
        label="",  # filled by caller
        value=value,
        unit=unit,
        fiscal_year=fiscal_year,
        period_end=str(best.get("end") or ""),
        form=str(best.get("form") or "").strip().upper(),
        filed=str(best.get("filed") or ""),
    )


def extract_company_facts(data: object) -> tuple[str, list[XbrlFact]]:
    """Parse a companyfacts payload into (entity_name, [latest annual facts]). Pure — no network."""
    if not isinstance(data, dict):
        return "", []
    entity_name = str(data.get("entityName") or "").strip()
    us_gaap = ((data.get("facts") or {}) if isinstance(data.get("facts"), dict) else {}).get(
        "us-gaap"
    )
    if not isinstance(us_gaap, dict):
        return entity_name, []

    out: list[XbrlFact] = []
    for concept in _CONCEPTS:
        picked: XbrlFact | None = None
        for tag in concept.tags:
            node = us_gaap.get(tag)
            if not isinstance(node, dict):
                continue
            units = node.get("units")
            if not isinstance(units, dict):
                continue
            entries = units.get(concept.unit)
            fact = _select_latest_annual(entries, concept.unit)
            if fact is not None:
                picked = fact
                break  # first candidate tag with usable annual data wins
        if picked is not None:
            out.append(
                XbrlFact(
                    key=concept.key,
                    label=concept.label,
                    value=picked.value,
                    unit=picked.unit,
                    fiscal_year=picked.fiscal_year,
                    period_end=picked.period_end,
                    form=picked.form,
                    filed=picked.filed,
                )
            )
    return entity_name, out


# --------------------------------------------------------------------------- fetch


async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    resp = await client.get(url, headers={"User-Agent": SEC_USER_AGENT})
    resp.raise_for_status()
    return resp.text


async def fetch_company_facts(symbol: str) -> CompanyFacts | None:
    """Fetch the latest-fiscal-year headline SEC XBRL facts for ``symbol``, or ``None``.

    Best-effort and fully self-contained: any network/parse failure logs at WARNING and
    returns ``None`` so the caller can degrade. Never raises to the caller.
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
            raw = await _fetch_text(client, COMPANYFACTS_URL.format(cik10=cik10))
            data = json.loads(raw)
    except Exception as exc:  # noqa: BLE001 — external primary source is best-effort
        log.warning("sec_xbrl fetch failed for %s: %s", sym, type(exc).__name__)
        return None

    entity_name, facts = extract_company_facts(data)
    if not facts:
        return None
    return CompanyFacts(
        symbol=sym,
        entity_name=entity_name,
        facts=facts,
        source_url=EDGAR_FILINGS_URL.format(cik10=cik10),
    )
