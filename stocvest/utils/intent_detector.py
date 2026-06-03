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
    re.compile(r"\bmomentum\s+stocks?\b", re.IGNORECASE),
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


# ─────────────────────────────────────────────────────────────────────────────
# Market overview intent
# ─────────────────────────────────────────────────────────────────────────────

_MARKET_OVERVIEW_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bhow\s+is\s+the\s+stock\s+market\s+doing\b", re.IGNORECASE),
    re.compile(r"\bhow('?s|\s+is)\s+the\s+market\s+(doing|today)\b", re.IGNORECASE),
    re.compile(r"\bmarket\s+(outlook|status|pulse|regime)\b", re.IGNORECASE),
    re.compile(r"\b(what('?s|\s+is)\s+)?the\s+market\s+(like|doing)\s+(today|this\s+morning)\b", re.IGNORECASE),
    re.compile(r"\bspy\s+and\s+qqq\b", re.IGNORECASE),
)


def is_market_overview_query(text: str) -> bool:
    """Return True when the user asks for broad market status/regime context."""
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _MARKET_OVERVIEW_PATTERNS)


# ─────────────────────────────────────────────────────────────────────────────
# Watchlist intelligence intent ("how is my watchlist doing?" / opportunities)
# ─────────────────────────────────────────────────────────────────────────────

# Status / health questions about the user's own watchlist as a whole. These are
# deliberately scoped to phrasings that reference *my/the* watchlist so a stray
# "watchlist" mention (e.g. "add NVDA to my watchlist") never trips them — the
# add/remove action intents are checked first by the handler regardless.
_WATCHLIST_STATUS_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bhow('?s|\s+is|\s+are)\b.{0,20}\b(my|the)\s+watchlist\b", re.IGNORECASE),
    re.compile(r"\b(my|the)\s+watchlist\b.{0,20}\b(doing|today|look|looking|status|update)\b", re.IGNORECASE),
    re.compile(r"\b(what('?s|\s+is)\s+)?(happening|going\s+on|moving)\b.{0,25}\b(my|the)\s+watchlist\b", re.IGNORECASE),
    re.compile(r"\b(update|summary|recap)\b.{0,20}\b(my|the)\s+watchlist\b", re.IGNORECASE),
    re.compile(r"\banything\s+(moving|happening|new)\b.{0,20}\bwatchlist\b", re.IGNORECASE),
)

# Opportunity / readiness questions ("best opportunities from my watchlist today").
_WATCHLIST_OPPORTUNITY_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b(best|top|good)\s+(opportunit(y|ies)|setups?|plays?|trades?|ideas?)\b.{0,25}\bwatchlist\b", re.IGNORECASE),
    re.compile(r"\bwatchlist\b.{0,25}\b(opportunit(y|ies)|setups?|plays?|ready|actionable)\b", re.IGNORECASE),
    re.compile(r"\bwhat('?s|\s+is)\s+(ready|actionable|close|near\s+ready)\b.{0,25}\bwatchlist\b", re.IGNORECASE),
    re.compile(r"\bwhat\s+should\s+i\s+(trade|buy|look\s+at)\b.{0,25}\b(my|the)\s+watchlist\b", re.IGNORECASE),
    re.compile(r"\b(any|which)\s+(of\s+)?(my\s+)?watchlist\b.{0,20}\b(setups?|plays?|ready|opportunit)", re.IGNORECASE),
    re.compile(r"\b(setups?|plays?|opportunit(y|ies)|ready|actionable)\b.{0,25}\bwatchlist\b", re.IGNORECASE),
)


def is_watchlist_status_query(text: str) -> bool:
    """Return True when the user asks how their watchlist as a whole is doing."""
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _WATCHLIST_STATUS_PATTERNS)


def is_watchlist_opportunity_query(text: str) -> bool:
    """Return True when the user asks for the best/ready opportunities on their watchlist."""
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _WATCHLIST_OPPORTUNITY_PATTERNS)


def is_watchlist_intelligence_query(text: str) -> bool:
    """Return True for any watchlist status OR opportunity question.

    Used by the assistant handler to decide whether to attach watchlist context.
    """
    return is_watchlist_status_query(text) or is_watchlist_opportunity_query(text)


# ─────────────────────────────────────────────────────────────────────────────
# Explicit trading-desk language (mode resolution + light personalization)
# ─────────────────────────────────────────────────────────────────────────────

_DAY_MODE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bday[\s-]?trad(e|es|ing)\b", re.IGNORECASE),
    re.compile(r"\bintraday\b", re.IGNORECASE),
    re.compile(r"\bday\s+(setups?|desk|signals?|momentum)\b", re.IGNORECASE),
    re.compile(r"\bday\s*\(intraday\)", re.IGNORECASE),
)

_SWING_MODE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bswing[\s-]?trad(e|es|ing)\b", re.IGNORECASE),
    re.compile(r"\bswing\s+(setups?|desk|signals?|momentum)\b", re.IGNORECASE),
    re.compile(r"\bmulti[\s-]?day\b", re.IGNORECASE),
    re.compile(r"\bswing\s*\(multi[\s-]?day\)", re.IGNORECASE),
    re.compile(r"\bswing\b", re.IGNORECASE),
)


def detect_explicit_desk(text: str) -> str | None:
    """Return 'day' or 'swing' when the message names a desk explicitly, else None.

    Day patterns are checked first because "day trade" is the more specific
    phrase; a bare "swing" still resolves to swing. Returns None when the text
    carries no explicit desk language so the caller can fall back to preference
    or ask a clarifying question.
    """
    if not text or not text.strip():
        return None
    if any(p.search(text) for p in _DAY_MODE_PATTERNS):
        return "day"
    if any(p.search(text) for p in _SWING_MODE_PATTERNS):
        return "swing"
    return None


def is_mode_sensitive_query(text: str) -> bool:
    """Discovery / opportunity / trade-planning questions whose answer depends on desk."""
    return (
        is_discovery_query(text)
        or is_watchlist_opportunity_query(text)
        or is_trade_planning_question(text)
    )
