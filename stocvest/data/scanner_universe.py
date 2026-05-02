"""
Liquid US equity universe used when Polygon full-market snapshot is unavailable (403 / tier).

Roughly 90 highly liquid names and ETFs — not investment advice; scanner input only.
"""

from __future__ import annotations

# fmt: off
LIQUID_SYMBOLS_FALLBACK: tuple[str, ...] = (
    "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK", "XLV", "XLI", "XLY", "XLP", "XLU", "XLRE", "XLB",
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA", "AMD", "INTC", "AVGO", "QCOM", "TXN",
    "NFLX", "CRM", "ORCL", "CSCO", "ADBE", "NOW", "INTU", "AMAT", "LRCX", "MU",
    "JPM", "BAC", "GS", "MS", "C", "WFC", "BLK", "SCHW", "V", "MA", "PYPL",
    "UNH", "JNJ", "PFE", "LLY", "MRK", "ABBV", "TMO", "ABT", "BMY",
    "XOM", "CVX", "COP", "SLB", "EOG", "MPC",
    "WMT", "HD", "COST", "TGT", "LOW", "NKE", "SBUX", "MCD",
    "DIS", "CMCSA",
    "BA", "CAT", "GE", "HON", "UPS", "RTX", "LMT",
    "KO", "PEP", "PM", "MO",
    "T", "VZ",
    "NEE", "DUK",
    "BRK.B", "BRK.A",
)
# fmt: on
