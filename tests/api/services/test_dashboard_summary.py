"""Dashboard first-paint aggregate — GICS sector coverage."""

from __future__ import annotations

import pytest

from stocvest.api.services.dashboard_summary import (
    DASHBOARD_DAILY_SYMBOLS,
    DASHBOARD_SECTOR_ETFS,
)
from stocvest.api.services.market_brief import _SECTOR_LABELS

GICS_SECTOR_ETFS = (
    "XLK",
    "XLC",
    "XLE",
    "XLF",
    "XLY",
    "XLP",
    "XLV",
    "XLI",
    "XLB",
    "XLU",
    "XLRE",
)


@pytest.mark.unit
def test_dashboard_daily_symbols_include_all_gics_sectors() -> None:
    assert len(DASHBOARD_SECTOR_ETFS) == 11
    for etf in GICS_SECTOR_ETFS:
        assert etf in DASHBOARD_DAILY_SYMBOLS
        assert etf in _SECTOR_LABELS
