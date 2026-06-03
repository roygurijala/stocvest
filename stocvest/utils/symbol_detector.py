"""
Ticker symbol detection from natural language assistant queries.

Extracts US equity ticker symbols from free-text user messages so the assistant
can pre-fetch live market context before calling Claude. Handles:
  - Explicit dollar-sign tickers:  "$MRVL", "$AAPL"
  - Bare uppercase tickers:        "MRVL", "NVDA is up today"
  - Company-name hints:            deferred to caller via TickerNameResolver

Design notes:
* The blocklist is intentionally conservative. False negatives (missing a ticker)
  are less harmful than false positives (treating "I" or "AI" as a ticker and
  firing unnecessary Polygon fetches).
* Only the LAST detected ticker in the message is returned. Users typically ask
  about one stock per turn; returning the last one biases toward the subject of
  the sentence rather than a ticker mentioned in passing context.
* Symbols are capped at 5 characters (NYSE/NASDAQ max for equities).
"""

from __future__ import annotations

import re

# Words that look like tickers but are not. Covers common English words,
# financial abbreviations, and STOCVEST-internal terms that appear in
# user queries.
_BLOCKLIST: frozenset[str] = frozenset(
    {
        # Articles / pronouns / conjunctions
        "A", "I", "AM", "AN", "AS", "AT", "BE", "BY", "DO", "GO", "HE",
        "IF", "IN", "IS", "IT", "ME", "MY", "NO", "OF", "OK", "ON", "OR",
        "SO", "TO", "UP", "US", "WE", "HI",
        # Common short words
        "CAN", "GET", "GOT", "HAS", "HAD", "DID", "FOR", "THE", "BUT",
        "NOT", "AND", "ANY", "ARE", "ALL", "ADD", "ASK", "BIG", "BUY",
        "DAY", "END", "FAR", "FEW", "GAS", "HIM", "HIS", "HOW", "ITS",
        "LET", "LOW", "MAY", "NEW", "NOW", "OIL", "OLD", "ONE", "OUT",
        "OWN", "PUT", "RUN", "SAY", "SEE", "SET", "SHE", "SIT", "SIX",
        "TEN", "TOP", "TRY", "TWO", "USE", "VIA", "WAR", "WAY", "WHO",
        "WHY", "WIN", "YES", "YET", "YOU",
        # Finance abbreviations that are NOT tickers
        "AI", "API", "APR", "APY", "ATH", "ATM", "ATR", "AUM",
        "BB", "BPS", "BTC", "CB",
        "CD", "CEO", "CFO", "COO", "CPO", "CTO", "CPI",
        "DCF", "DD", "DIV", "DJ", "DMA", "DXY",
        "E", "ECB", "EMA", "EPS", "ETF", "ETH", "EV",
        "FD", "FED", "FF", "FOMC", "FSR", "FX",
        "G", "G7", "G20", "GDP", "GTC",
        "HFT", "HOD", "HOW",
        "ICO", "IMF", "IPO", "IRA", "IRR", "ISM",
        "IV", "IVP",
        "KPI",
        "LOD", "LOI",
        "M", "M1", "M2", "MA", "MBS", "MM",
        "NAV", "NFP", "NLP",
        "OP", "OTC", "OTM",
        "P", "PB", "PC", "PE", "PEG", "PM", "PNL",
        "QE", "QoQ", "QQ",
        "R", "RBA", "ROA", "ROE", "ROI", "RSI", "RV",
        "S", "SEC", "SMA", "SOX", "SP",
        "T", "TA", "TF", "TV",
        "UK", "USD", "UI", "UX",
        "V", "VIX", "VOL", "VP",
        "WIM", "WoW",
        "X",
        "YoY", "YTD",
        # STOCVEST internal terms
        "MRVL",  # keep — intentionally NOT blocked; valid ticker
        "ORB", "VWAP", "ATR", "PDT",
        # Country / region codes
        "EU", "ECB", "FRB",
    }
    # Re-add valid tickers accidentally placed in the blocklist above:
    - {"MRVL"}
)

# Matches $TICKER or standalone UPPERCASE words of 1–5 letters.
_DOLLAR_PATTERN = re.compile(r"\$([A-Z]{1,5})\b")
_BARE_PATTERN = re.compile(r"\b([A-Z]{2,5})\b")


def detect_symbol(text: str) -> str | None:
    """Return the most-likely ticker from *text*, or None if none found.

    Priority order:
    1. Dollar-sign tickers ($MRVL) — explicit intent signal, highest confidence.
    2. Bare uppercase words (MRVL) after blocklist filtering.

    Returns the LAST match so "I asked about AAPL but now I want to know about
    NVDA" correctly yields NVDA.
    """
    if not text or not text.strip():
        return None

    # Phase 1 — dollar-sign tickers (case-insensitive: $mrvl → MRVL).
    dollar_hits = _DOLLAR_PATTERN.findall(text.upper())
    if dollar_hits:
        return dollar_hits[-1]

    # Phase 2 — bare uppercase words already uppercase in the ORIGINAL text.
    # Do NOT uppercase the whole input — that turns "market" into "MARKET"
    # and "today" into "TODAY", causing false-positive ticker matches.
    bare_hits = [m for m in _BARE_PATTERN.findall(text) if m not in _BLOCKLIST]
    if bare_hits:
        return bare_hits[-1]

    return None


def detect_symbol_from_messages(messages: list[dict]) -> str | None:
    """Scan the most-recent user turn (up to last 3 turns) for a ticker symbol.

    Checks the last user message first; falls back to scanning the prior two
    turns so a follow-up question like "why did it gap up?" can resolve the
    symbol from the preceding context.
    """
    if not isinstance(messages, list):
        return None

    user_texts = [
        str(m.get("content") or "")
        for m in reversed(messages)
        if isinstance(m, dict) and m.get("role") == "user"
    ][:3]

    for text in user_texts:
        sym = detect_symbol(text)
        if sym:
            return sym

    return None
