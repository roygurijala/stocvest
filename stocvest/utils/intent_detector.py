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


# ─────────────────────────────────────────────────────────────────────────────
# Web-search intent — "out-of-envelope" questions STOCVEST's structured
# Polygon/Benzinga symbol data can't answer (macro, policy, sector/thematic,
# "what's the latest on …"). Only consulted as a FALLBACK by the handler, after
# symbol / discovery / market-overview / watchlist intents have been ruled out,
# so overlap with those phrasings is harmless.
# ─────────────────────────────────────────────────────────────────────────────

_WEB_SEARCH_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\blatest\b", re.IGNORECASE),
    re.compile(r"\brecent(ly)?\b", re.IGNORECASE),
    re.compile(r"\bnews\s+(on|about|for|regarding|around)\b", re.IGNORECASE),
    re.compile(
        r"\bwhat('?s| is| are| has| have)\b.{0,40}\b(happening|going\s+on|the\s+latest|new\s+(with|on|in|about))\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bwhat('?s| is)\s+going\s+on\s+(with|in|at)\b", re.IGNORECASE),
    # Macro / policy / rates / geopolitical topics.
    re.compile(
        r"\b(fed|federal\s+reserve|fomc|interest\s+rate|rate\s+(cut|hike)s?|inflation|cpi|ppi|"
        r"jobs\s+report|payrolls?|unemployment|gdp|recession|tariffs?|trade\s+war|election|"
        r"geopolitic\w*|opec|oil\s+price|treasury\s+yield|bond\s+yield)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(macro|economy|economic)\b.{0,25}\b(outlook|news|update|today|this\s+week|latest|environment|backdrop)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bwhat\s+do\s+you\s+know\s+about\b", re.IGNORECASE),
    re.compile(r"\btell\s+me\s+about\b", re.IGNORECASE),
    re.compile(
        r"\bsector\b.{0,30}\b(doing|performing|news|latest|this\s+week|rotation|outlook)\b",
        re.IGNORECASE,
    ),
)


def is_web_search_query(text: str) -> bool:
    """Return True when the question likely needs a fresh web lookup beyond
    STOCVEST's structured symbol data (macro / policy / sector / thematic / "latest").

    The handler only consults this AFTER symbol, discovery, market-overview, and
    watchlist intents are ruled out, so this is the catch-all breadth path."""
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _WEB_SEARCH_PATTERNS)


# ─────────────────────────────────────────────────────────────────────────────
# Multi-symbol comparison intent ("compare NVDA vs AMD", "which is stronger?")
# ─────────────────────────────────────────────────────────────────────────────
# Precision comes from the handler ANDing this with "≥2 distinct tickers
# detected", so broad cues like "or" are safe — a one-symbol question never trips
# the comparison path.

_COMPARISON_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bcompare\b", re.IGNORECASE),
    re.compile(r"\bcomparison\b", re.IGNORECASE),
    re.compile(r"\bvs\.?\b", re.IGNORECASE),
    re.compile(r"\bversus\b", re.IGNORECASE),
    re.compile(r"\bbetween\b", re.IGNORECASE),
    re.compile(r"\bwhich\s+(is|one|stock|of|has|looks)\b", re.IGNORECASE),
    re.compile(r"\b(stronger|weaker|better|worse)\b", re.IGNORECASE),
    re.compile(r"\bor\b", re.IGNORECASE),
)


def is_comparison_query(text: str) -> bool:
    """Return True when the message reads like a head-to-head comparison.

    The handler additionally requires ≥2 distinct tickers before activating the
    multi-symbol path, so this can be permissive without false positives on
    single-symbol questions."""
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _COMPARISON_PATTERNS)


# ─────────────────────────────────────────────────────────────────────────────
# Price-chart relevance — should a symbol's price mini-chart accompany the answer?
# ─────────────────────────────────────────────────────────────────────────────
# A price/levels mini-chart only adds value when the question is actually about
# price behavior, performance, technical levels, or a trade setup. Attaching it to
# every turn (forecast text, a verdict question, a definition, a news ask) is just
# noise, so the handler gates the chart on this detector.
# Price / performance / movement / technical questions. A price mini-chart is
# inherently useful for these regardless of what else is in the context.
_PRICE_CHART_PATTERNS: tuple[re.Pattern[str], ...] = (
    # "how is / how's / how did X doing / trading / performing / today"
    re.compile(r"\bhow('?s|\s+is|\s+are|\s+did|\s+has|\s+have)\b.{0,40}\b(doing|trading|trade|perform\w*|today|do|done|fare\w*)\b", re.IGNORECASE),
    # Price / quote / chart language.
    re.compile(r"\bprice\b", re.IGNORECASE),
    re.compile(r"\bquote\b", re.IGNORECASE),
    re.compile(r"\bchart\b", re.IGNORECASE),
    re.compile(r"\bcandles?\b", re.IGNORECASE),
    re.compile(r"\b(trading|trend|trends|trending|intraday)\b", re.IGNORECASE),
    re.compile(r"\bperform(ance|ing|ed|s)?\b", re.IGNORECASE),
    # Movement language.
    re.compile(r"\b(moving|move|moved|movement|momentum)\b", re.IGNORECASE),
    re.compile(r"\b(gap|gapped|gapping|rally|rallied|rallying|sell[\s-]?off|selloff|drop|dropped|dropping|dip|dipped|surge|surged|jump|jumped|plunge|plunged|spike|spiked|breakout|break\s+out|pullback|tank\w*)\b", re.IGNORECASE),
    re.compile(r"\b(up|down|higher|lower|red|green)\s+(today|so\s+far|pre[\s-]?market|after[\s-]?hours|this\s+morning|right\s+now)\b", re.IGNORECASE),
    re.compile(r"\bwhy\s+(is|are|did|was|were|s)\b.{0,40}\b(up|down|moving|moved|falling|fell|rising|rose|dropping|dropped|gaining|tanking|surging|selling|red|green)\b", re.IGNORECASE),
    re.compile(r"\bwhat('?s| is| has)\s+happen(ing|ed)\b", re.IGNORECASE),
    # Technical reference levels.
    re.compile(r"\b(support|resistance|vwap|moving\s+average|\d{2,3}[\s-]?day(\s+(avg|average|ma))?)\b", re.IGNORECASE),
    # "pull up / look up / show me" a chart-worthy lookup.
    re.compile(r"\b(pull\s+up|look\s+up|show\s+me)\b", re.IGNORECASE),
)

# Forecast / outlook / analyst-target framing. The chart for these is only worth
# showing when there is an actual analyst target RANGE to draw (current vs
# forecasted high/low) — otherwise it's a redundant price chart, so the handler
# gates the forecast chart on target availability.
_FORECAST_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bforecast\b", re.IGNORECASE),
    re.compile(r"\boutlook\b", re.IGNORECASE),
    re.compile(r"\bprospects\b", re.IGNORECASE),
    re.compile(r"\b(analyst|analysts)\b", re.IGNORECASE),
    re.compile(r"\bconsensus\b", re.IGNORECASE),
    re.compile(r"\bestimate(s|d)?\b", re.IGNORECASE),
    re.compile(r"\btarget(s)?\b", re.IGNORECASE),
    re.compile(r"\b(fair\s+value|valuation)\b", re.IGNORECASE),
    re.compile(r"\b(upside|downside)\b", re.IGNORECASE),
)


def is_price_chart_query(text: str) -> bool:
    """Return True for price / performance / movement / technical / trade-setup
    questions, where a price mini-chart is inherently useful."""
    if not text or not text.strip():
        return False
    if any(p.search(text) for p in _PRICE_CHART_PATTERNS):
        return True
    # Trade-planning questions lean on support/resistance/target levels.
    return is_trade_planning_question(text)


def is_forecast_query(text: str) -> bool:
    """Return True for forecast / outlook / analyst-target questions. The chart
    for these only adds value when analyst targets exist to plot (gated by the
    handler), so this is kept distinct from :func:`is_price_chart_query`."""
    if not text or not text.strip():
        return False
    return any(p.search(text) for p in _FORECAST_PATTERNS)


def is_chart_relevant_query(text: str) -> bool:
    """Return True when a price/levels mini-chart is potentially relevant.

    Union of price-action and forecast questions. Deliberately EXCLUDES verdict
    ("what does STOCVEST think"), news-only, and conceptual questions. NOTE: for
    forecast questions the handler additionally requires analyst targets before
    actually attaching a chart, so a forecast with no targets shows no graph.
    """
    return is_price_chart_query(text) or is_forecast_query(text)
