"""
Lightweight intent detectors for the STOCVEST Assistant.

Each detector takes the user's latest message text and returns a boolean.
Keep these as simple keyword/regex rules — Claude handles nuance; these just
decide which assistant behavior mode to activate before Claude is called.
"""

from __future__ import annotations

import re

# ─────────────────────────────────────────────────────────────────────────────
# Trade-planning intent (A4 — deep-link routing)
# ─────────────────────────────────────────────────────────────────────────────

_TRADE_PLAN_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bentry\s+price\b", re.IGNORECASE),
    re.compile(r"\bwhere\s+to\s+(buy|enter|get\s+in)\b", re.IGNORECASE),
    re.compile(r"\bstop\s+loss\b", re.IGNORECASE),
    re.compile(r"\bstop\s+limit\b", re.IGNORECASE),
    re.compile(r"\btake\s+profit\b", re.IGNORECASE),
    re.compile(r"\bprice\s+target\b", re.IGNORECASE),
    re.compile(r"\b(good\s+)?entry\b.*\?", re.IGNORECASE),
    re.compile(r"\bwhere\b.*(enter|entry|buy|get\s+in)\b", re.IGNORECASE),
    re.compile(r"\b(worth\s+)?(trading|buying|buying\s+here)\b.*\?", re.IGNORECASE),
    re.compile(r"\bshould\s+i\s+(buy|trade|enter|get\s+in)\b", re.IGNORECASE),
    re.compile(r"\btrade\s+(plan|setup|this)\b", re.IGNORECASE),
    re.compile(r"\bsetup\s+(for|on)\b", re.IGNORECASE),
    re.compile(r"\bpoint\s+to\s+(buy|enter)\b", re.IGNORECASE),
    re.compile(r"\br[/:](r|reward)\b", re.IGNORECASE),  # "R/R", "R:R"
)


def is_trade_planning_question(text: str) -> bool:
    """Return True when the user message looks like a trade-planning question.

    Matches patterns like:
      - "what's the entry price for MRVL?"
      - "where to buy NVDA?"
      - "should I enter here?"
      - "stop loss for AAPL?"
      - "is this worth trading?"
      - "give me a trade plan"
    """
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _TRADE_PLAN_PATTERNS)


# ─────────────────────────────────────────────────────────────────────────────
# Watchlist action intent (A2)
# ─────────────────────────────────────────────────────────────────────────────

_WATCHLIST_ADD_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\badd\b.{1,30}\bto\b.{1,20}\bwatchlist\b", re.IGNORECASE),
    re.compile(r"\bwatch\b\s+\$?[A-Z]{1,5}\b", re.IGNORECASE),
    re.compile(r"\btrack\b\s+\$?[A-Z]{1,5}\b", re.IGNORECASE),
    re.compile(r"\bput\b.{1,20}\bon.{1,10}watchlist\b", re.IGNORECASE),
    re.compile(r"\badd\b\s+\$?[A-Z]{1,5}\b", re.IGNORECASE),
)

_WATCHLIST_REMOVE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bremove\b.{1,30}\bfrom\b.{1,20}\bwatchlist\b", re.IGNORECASE),
    re.compile(r"\bdelete\b.{1,30}\bfrom\b.{1,20}\bwatchlist\b", re.IGNORECASE),
    re.compile(r"\bunwatch\b\s+\$?[A-Z]{1,5}\b", re.IGNORECASE),
    re.compile(r"\bstop\s+(watching|tracking)\b.{1,20}\$?[A-Z]{1,5}\b", re.IGNORECASE),
)


def is_watchlist_add_intent(text: str) -> bool:
    """Return True when the user wants to add a symbol to their watchlist."""
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _WATCHLIST_ADD_PATTERNS)


def is_watchlist_remove_intent(text: str) -> bool:
    """Return True when the user wants to remove a symbol from their watchlist."""
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _WATCHLIST_REMOVE_PATTERNS)


# ─────────────────────────────────────────────────────────────────────────────
# Discovery intent (A3)
# ─────────────────────────────────────────────────────────────────────────────

_DISCOVERY_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bwhat('?s|\s+is)\s+(moving|up|down|happening)\b", re.IGNORECASE),
    re.compile(r"\bwhat\s+(stocks?\s+)?(have\s+)?(momentum|volume|strength)\b", re.IGNORECASE),
    re.compile(r"\b(top\s+)?(gainers?|losers?|movers?)\b", re.IGNORECASE),
    re.compile(r"\bgap\s+(stocks?|ups?|plays?)\b", re.IGNORECASE),
    re.compile(r"\bany\s+(good\s+)?(setups?|plays?|opportunities)\b", re.IGNORECASE),
    re.compile(r"\bwhat\s+should\s+i\s+(look\s+at|watch|consider)\b", re.IGNORECASE),
    re.compile(r"\b(show|find|give)\s+me\s+(some\s+)?(stocks?|setups?|plays?)\b", re.IGNORECASE),
    re.compile(r"\bwhat('?s|\s+is)\s+(on\s+the\s+scanner|scanning)\b", re.IGNORECASE),
    re.compile(r"\btop\s+setups?\b", re.IGNORECASE),
)


def is_discovery_query(text: str) -> bool:
    """Return True when the user is asking for a discovery/scanning query."""
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _DISCOVERY_PATTERNS)
