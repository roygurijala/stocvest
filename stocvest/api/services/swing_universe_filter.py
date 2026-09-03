"""Swing desk / alert universe exclusions — leveraged and inverse products.

Single-name and index inverse/leveraged ETFs are poor swing holds (decay, gaps,
path dependency). Composite scoring may still run for research; this module
blocks **surface + execution-actionable** paths for swing mode only.
"""

from __future__ import annotations

# Curated inverse / leveraged symbols (expand as needed; prefer explicit IDs over suffix heuristics).
SWING_EXCLUDED_SYMBOLS: frozenset[str] = frozenset(
    {
        # Single-stock inverse (examples from alert post-mortem)
        "NVDQ",
        "NVDS",
        "TSLQ",
        "TSLZ",
        "MSTZ",
        "MSTU",
        # Index / sector leveraged & inverse
        "SQQQ",
        "TQQQ",
        "SPXS",
        "SPXL",
        "SDS",
        "SSO",
        "QID",
        "QLD",
        "SOXS",
        "SOXL",
        "LABU",
        "LABD",
        "FAS",
        "FAZ",
        "TNA",
        "TZA",
        "UPRO",
        "SPXU",
        "UDOW",
        "SDOW",
        "NUGT",
        "DUST",
        "JNUG",
        "JDST",
        "UVXY",
        "SVXY",
        "VXX",
    }
)


def is_swing_excluded_symbol(symbol: str | None) -> bool:
    """True when swing desk / alerts should not treat the symbol as holdable."""
    sym = str(symbol or "").strip().upper()
    if not sym:
        return False
    return sym in SWING_EXCLUDED_SYMBOLS


def swing_exclusion_reason(symbol: str | None) -> str | None:
    if is_swing_excluded_symbol(symbol):
        return "leveraged_inverse_excluded"
    return None
