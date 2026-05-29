"""High-risk Chinese ADRs — explicit watchlist + reference heuristics."""

from __future__ import annotations

from stocvest.data.ticker_reference import TickerReference

# Maintained list: names with Nasdaq suspension / delisting / repeated reverse-split risk.
CHINESE_ADR_DELISTING_WATCHLIST: frozenset[str] = frozenset(
    {
        "CCM",
        "QH",
        "QHUOY",
        "FFIE",
        "SDA",
        "GRI",
        "MLGO",
        "AUUD",
        "JZ",
        "HUDI",
    }
)

_CHINESE_COUNTRY_CODES = frozenset({"CN", "CHN", "HK", "HKG"})
_MIN_CHINESE_ADR_MARKET_CAP = 500_000_000.0


def chinese_adr_watchlist_block(symbol: str) -> str | None:
    sym = str(symbol or "").strip().upper()
    if sym and sym in CHINESE_ADR_DELISTING_WATCHLIST:
        return "symbol on Chinese ADR delisting watch"
    return None


def chinese_adr_reference_block(reference: TickerReference | None) -> str | None:
    """Block micro-cap Chinese/HK ADRs even when not on the explicit watchlist."""
    if reference is None or not reference.is_adr():
        return None
    country = (reference.country_code or "").upper()
    locale = (reference.locale or "").lower()
    is_china_region = country in _CHINESE_COUNTRY_CODES or locale == "global"
    if not is_china_region:
        return None
    cap = reference.market_cap
    if cap is not None and cap < _MIN_CHINESE_ADR_MARKET_CAP:
        return "Chinese ADR below minimum market cap"
    return None


def chinese_adr_exclusion_reason(symbol: str, reference: TickerReference | None) -> str | None:
    return chinese_adr_watchlist_block(symbol) or chinese_adr_reference_block(reference)
