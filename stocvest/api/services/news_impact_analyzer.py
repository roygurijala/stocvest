from __future__ import annotations

from typing import Any

from stocvest.data.polygon_client import LIQUID_NEWS_TICKERS

TICKER_ALIASES = {
    "GOOG": "GOOGL",
    "BRK.A": "BRK.B",
}

# Approximate "top liquid names" allowlist for chip relevance.
KNOWN_LIQUID_SYMBOLS = {
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "NFLX", "AVGO",
    "JPM", "BAC", "WFC", "GS", "MS", "C", "V", "MA", "PYPL", "SQ",
    "SPY", "QQQ", "DIA", "IWM", "TLT", "XLF", "XLK", "XLE", "XLI", "XLY", "XLV",
    "BRK.B", "UNH", "JNJ", "LLY", "PFE", "MRK", "ABBV", "TMO", "ABT",
    "XOM", "CVX", "COP", "SLB", "EOG", "OXY",
    "WMT", "COST", "HD", "LOW", "NKE", "MCD", "SBUX", "TGT",
    "DIS", "CMCSA", "TMUS", "VZ", "T", "CHTR",
    "CAT", "DE", "BA", "GE", "HON", "UPS", "FDX",
    "ORCL", "CRM", "ADBE", "INTC", "QCOM", "MU", "CSCO", "IBM", "NOW", "PANW",
    "SHOP", "UBER", "ABNB", "SNOW", "PLTR",
    "KO", "PEP", "PG", "CL", "KMB", "MDLZ",
    "GS", "BLK", "BX", "KKR",
    "RIVN", "LCID", "NIO", "F", "GM",
    "MSTR", "COIN", "RIOT", "MARA",
    "TSM", "ASML", "NVO", "BABA", "PDD", "JD",
}


def _sentiment_from_article(article: dict[str, Any]) -> str:
    insights = article.get("insights")
    if isinstance(insights, list) and insights:
        first = insights[0]
        if isinstance(first, dict):
            sent = str(first.get("sentiment") or "").strip().lower()
            if sent in {"positive", "negative", "neutral"}:
                return sent
    sent2 = str(article.get("sentiment") or "").strip().lower()
    if sent2 in {"positive", "negative", "neutral"}:
        return sent2
    return "neutral"


def _title_override_impact(title: str, default: str) -> str:
    bearish_words = ["downgrade", "miss", "below", "disappoints", "cuts"]
    bullish_words = ["upgrade", "beat", "above", "raises", "record", "strong"]
    if any(word in title for word in bearish_words):
        return "bearish"
    if any(word in title for word in bullish_words):
        return "bullish"
    return default


def _macro_impact(symbol: str, title: str) -> str:
    title_lower = title.lower()
    if "cut" in title_lower or "lower" in title_lower:
        if symbol in {"SPY", "QQQ", "TLT"}:
            return "bullish"
    elif "hike" in title_lower or "raise" in title_lower:
        if symbol in {"SPY", "QQQ", "TLT"}:
            return "bearish"
    return "neutral"


def analyze_news_impact(
    article: dict[str, Any],
    watchlist_symbols: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Build affected stock chips for dashboard market intelligence cards."""
    affected: list[dict[str, Any]] = []
    tickers_raw = article.get("tickers")
    watchlist_set = {s.strip().upper() for s in (watchlist_symbols or []) if s.strip()}
    eligible_liquid = {s.upper() for s in LIQUID_NEWS_TICKERS} | KNOWN_LIQUID_SYMBOLS
    seen_symbols: set[str] = set()
    tickers = []
    for raw_ticker in tickers_raw or []:
        ticker = str(raw_ticker).strip().upper()
        if not ticker:
            continue
        canonical = TICKER_ALIASES.get(ticker, ticker)
        if canonical in seen_symbols:
            continue
        seen_symbols.add(canonical)
        tickers.append(canonical)
    title = str(article.get("title") or "").lower()

    sentiment = _sentiment_from_article(article)
    base_impact = "neutral"
    if sentiment == "positive":
        base_impact = "bullish"
    elif sentiment == "negative":
        base_impact = "bearish"

    def _eligible(symbol: str) -> bool:
        return symbol in eligible_liquid or symbol in watchlist_set

    for i, ticker in enumerate(tickers):
        if not _eligible(ticker):
            continue
        impact = _title_override_impact(title, base_impact)
        watch = ticker in watchlist_set
        affected.append(
            {
                "symbol": ticker,
                "impact": impact,
                "reason": "Direct" if i == 0 else "Mentioned",
                "is_direct": True,
                "is_watchlist": watch,
            }
        )

    if any(word in title for word in ["fed", "federal reserve", "rate", "inflation", "cpi", "gdp", "jobs"]):
        existing = {a["symbol"] for a in affected}
        for sym in ["SPY", "QQQ", "TLT"]:
            if sym not in existing and _eligible(sym):
                affected.append(
                    {
                        "symbol": sym,
                        "impact": _macro_impact(sym, title),
                        "reason": "Macro",
                        "is_direct": False,
                        "is_watchlist": False,
                    }
                )

    if any(sym in tickers for sym in ["AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA"]):
        existing = {a["symbol"] for a in affected}
        if "QQQ" not in existing and _eligible("QQQ"):
            fallback_impact = affected[0]["impact"] if affected else "neutral"
            affected.append(
                {
                    "symbol": "QQQ",
                    "impact": fallback_impact,
                    "reason": "Sector",
                    "is_direct": False,
                    "is_watchlist": False,
                }
            )

    if watchlist_set:
        existing = {a["symbol"] for a in affected}
        for sym in watchlist_set:
            canonical = TICKER_ALIASES.get(sym, sym)
            if not _eligible(canonical):
                continue
            if canonical in tickers and canonical not in existing:
                fallback_impact = affected[0]["impact"] if affected else "neutral"
                affected.append(
                    {
                        "symbol": canonical,
                        "impact": fallback_impact,
                        "reason": "Watchlist",
                        "is_direct": True,
                        "is_watchlist": True,
                    }
                )

    affected.sort(key=lambda x: (not x["is_watchlist"], not x["is_direct"]))
    return affected[:5]


def generate_impact_summary(
    article: dict[str, Any],
    affected_stocks: list[dict[str, Any]],
) -> str | None:
    """Return short template explanation of likely market impact."""
    title = str(article.get("title") or "").lower()
    direct = [a["symbol"] for a in affected_stocks if a.get("is_direct")][:2]
    if not direct:
        return None

    sentiment = _sentiment_from_article(article)
    is_positive = sentiment == "positive"
    is_negative = sentiment == "negative"
    has_earnings = any(k in title for k in ["beat", "miss", "eps", "revenue"])
    has_analyst = any(k in title for k in ["upgrade", "downgrade", "price target", "raises", "cuts"])
    has_macro = any(k in title for k in ["fed", "rate", "inflation", "jobs"])

    if has_macro:
        return "Macro catalyst — broad market impact on SPY/QQQ/TLT."

    if has_earnings:
        if is_positive:
            return "Earnings beat — direct catalyst, watch sector lift."
        if is_negative:
            return "Earnings miss — expect sector pressure."

    if has_analyst:
        if is_positive:
            return f"Analyst upgrade — momentum signal for {direct[0]}."
        if is_negative:
            return "Analyst downgrade — sentiment headwind."

    return f"Catalyst for {', '.join(direct)}; monitor for sector follow-through."