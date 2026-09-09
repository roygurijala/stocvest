"""Position universe hygiene (ADR-004 POS-D11) — gem gate G8.

A candidate is *investable* for the Position desk only if it is a plain long-horizon
equity: **not** a leveraged/inverse ETF, **not** a SPAC / blank-check shell, and (when the
data is available) above configurable micro-cap / illiquidity floors.

Design:
* Leveraged/inverse exclusion reuses the GEO-2 / swing blocklist
  (:data:`stocvest.api.services.swing_universe_filter.SWING_EXCLUDED_SYMBOLS`) plus a small
  position-specific extension and conservative company-name markers (only when a name is
  supplied — symbol-only heuristics are deliberately avoided per the swing module's stance).
* SPAC / blank-check shells are detected from the company name markers.
* Micro-cap / illiquidity floors are applied **only** when ``market_cap`` /
  ``avg_dollar_volume`` are provided; when absent (the curated v1 large-cap universe scores
  without reference financials) the gate degrades gracefully to a pass, like gem gate G6.

Pure module: thresholds are read from ``get_settings()`` but every check is exposed as a
dependency-injectable function so the logic is unit-testable without env or network.
"""

from __future__ import annotations

from stocvest.api.services.swing_universe_filter import SWING_EXCLUDED_SYMBOLS
from stocvest.utils.config import get_settings

# Position-specific additions to the shared GEO-2 leveraged/inverse blocklist. Kept explicit
# (curated tickers) rather than suffix heuristics to avoid false positives on real equities.
POSITION_EXTRA_EXCLUDED_SYMBOLS: frozenset[str] = frozenset(
    {
        # Commodity / volatility / single-stock leverage families not in the swing set.
        "UVIX",
        "SVIX",
        "BOIL",
        "KOLD",
        "UCO",
        "SCO",
        "AGQ",
        "ZSL",
        "TMF",
        "TMV",
        "TQQQ",
        "YINN",
        "YANG",
        "FNGU",
        "FNGD",
        "BITX",
        "CONL",
        "TSLL",
        "NVDL",
        "AAPU",
        "MSFU",
    }
)

POSITION_EXCLUDED_SYMBOLS: frozenset[str] = SWING_EXCLUDED_SYMBOLS | POSITION_EXTRA_EXCLUDED_SYMBOLS

# Company-name markers (uppercased, substring match) for leveraged/inverse products.
_LEVERAGED_NAME_MARKERS: tuple[str, ...] = (
    "LEVERAGED",
    "INVERSE",
    "ULTRAPRO",
    "ULTRASHORT",
    "ULTRA SHORT",
    "2X ",
    "3X ",
    "-1X",
    "1.5X",
    "DAILY BULL",
    "DAILY BEAR",
    "BULL 2X",
    "BULL 3X",
    "BEAR 2X",
    "BEAR 3X",
)

# Company-name markers for SPAC / blank-check shells (pre-deal — no operating business).
_SPAC_NAME_MARKERS: tuple[str, ...] = (
    "ACQUISITION CORP",
    "ACQUISITION COMPANY",
    "ACQUISITION HOLDINGS",
    "BLANK CHECK",
    "SPAC",
)

# Exclusion reason codes (stable identifiers for gate blobs / telemetry).
REASON_LEVERAGED_INVERSE = "leveraged_inverse_excluded"
REASON_SPAC_SHELL = "spac_shell_excluded"
REASON_MICRO_CAP = "below_min_market_cap"
REASON_ILLIQUID = "below_min_avg_dollar_volume"


def _name_has_marker(company_name: str | None, markers: tuple[str, ...]) -> bool:
    if not company_name:
        return False
    upper = str(company_name).strip().upper()
    if not upper:
        return False
    return any(marker in upper for marker in markers)


def is_leveraged_or_inverse(symbol: str | None, company_name: str | None = None) -> bool:
    sym = str(symbol or "").strip().upper()
    if sym and sym in POSITION_EXCLUDED_SYMBOLS:
        return True
    return _name_has_marker(company_name, _LEVERAGED_NAME_MARKERS)


def is_spac_shell(company_name: str | None) -> bool:
    return _name_has_marker(company_name, _SPAC_NAME_MARKERS)


def position_universe_exclusion_reason(
    symbol: str | None,
    *,
    company_name: str | None = None,
    market_cap: float | None = None,
    avg_dollar_volume: float | None = None,
    min_market_cap_usd: float | None = None,
    min_avg_dollar_volume_usd: float | None = None,
) -> str | None:
    """Return a stable exclusion reason, or ``None`` when the symbol is investable.

    Leveraged/inverse and SPAC-shell checks always apply. Micro-cap / illiquidity floors
    apply only when the corresponding metric is provided (graceful pass when absent).
    Thresholds default to ``get_settings()`` but can be overridden for tests.
    """
    if is_leveraged_or_inverse(symbol, company_name):
        return REASON_LEVERAGED_INVERSE
    if is_spac_shell(company_name):
        return REASON_SPAC_SHELL

    if min_market_cap_usd is None or min_avg_dollar_volume_usd is None:
        settings = get_settings()
        if min_market_cap_usd is None:
            min_market_cap_usd = float(settings.stocvest_position_min_market_cap_usd)
        if min_avg_dollar_volume_usd is None:
            min_avg_dollar_volume_usd = float(settings.stocvest_position_min_avg_dollar_volume_usd)

    if (
        market_cap is not None
        and min_market_cap_usd > 0
        and float(market_cap) < min_market_cap_usd
    ):
        return REASON_MICRO_CAP
    if (
        avg_dollar_volume is not None
        and min_avg_dollar_volume_usd > 0
        and float(avg_dollar_volume) < min_avg_dollar_volume_usd
    ):
        return REASON_ILLIQUID
    return None


def passes_position_universe_filter(
    symbol: str | None,
    *,
    company_name: str | None = None,
    market_cap: float | None = None,
    avg_dollar_volume: float | None = None,
    min_market_cap_usd: float | None = None,
    min_avg_dollar_volume_usd: float | None = None,
) -> bool:
    """True when the symbol is an investable plain equity (gem gate G8)."""
    return (
        position_universe_exclusion_reason(
            symbol,
            company_name=company_name,
            market_cap=market_cap,
            avg_dollar_volume=avg_dollar_volume,
            min_market_cap_usd=min_market_cap_usd,
            min_avg_dollar_volume_usd=min_avg_dollar_volume_usd,
        )
        is None
    )
