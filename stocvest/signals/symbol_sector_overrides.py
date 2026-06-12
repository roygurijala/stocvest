"""Symbol / ADR sector overrides when Polygon SIC is missing or too coarse."""

from __future__ import annotations

from stocvest.data.ticker_reference import TickerReference

# Explicit ticker → (internal sector bucket, display label)
SYMBOL_SECTOR_OVERRIDES: dict[str, tuple[str, str]] = {
    "GGAL": ("banks", "Argentine Banks"),
    "BMA": ("banks", "Argentine Banks"),
    "SUPV": ("banks", "Argentine Banks"),
    "BBAR": ("banks", "Argentine Banks"),
    "CEPU": ("utilities", "Argentine Utilities"),
    "PAM": ("transport", "Argentina Transport"),
    "YPF": ("energy", "Argentina Energy"),
    "VIST": ("energy", "Argentina Energy"),
    "MELI": ("consumer_discretionary", "LatAm E-Commerce"),
    "NU": ("banks", "LatAm Fintech"),
    "ITUB": ("banks", "Brazil Banks"),
    "BBD": ("banks", "Brazil Banks"),
}

_COUNTRY_SECTOR_HINTS: dict[str, tuple[str, str]] = {
    "AR": ("banks", "Argentina Financials"),
    "BR": ("banks", "Brazil Financials"),
    "MX": ("banks", "Mexico Financials"),
}

_FINANCIAL_NAME_KEYWORDS = (
    "bank",
    "banc",
    "financial",
    "financiero",
    "grupo financiero",
    "banco",
)


def resolve_symbol_sector_override(
    symbol: str,
    ticker_ref: TickerReference | None = None,
) -> tuple[str, str] | None:
    """
    Return ``(sector_bucket, display_name)`` when we can map better than SPY default.
    """
    sym = str(symbol or "").strip().upper()
    if not sym:
        return None

    explicit = SYMBOL_SECTOR_OVERRIDES.get(sym)
    if explicit:
        return explicit

    if ticker_ref is None:
        return None

    country = str(ticker_ref.country_code or "").strip().upper()
    name = str(ticker_ref.name or "").strip().lower()
    if ticker_ref.is_adr() and country in _COUNTRY_SECTOR_HINTS:
        if any(kw in name for kw in _FINANCIAL_NAME_KEYWORDS):
            return _COUNTRY_SECTOR_HINTS[country]

    return None
