from __future__ import annotations

from typing import Any


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
    tickers = [str(t).strip().upper() for t in tickers_raw or [] if str(t).strip()]
    title = str(article.get("title") or "").lower()

    sentiment = _sentiment_from_article(article)
    base_impact = "neutral"
    if sentiment == "positive":
        base_impact = "bullish"
    elif sentiment == "negative":
        base_impact = "bearish"

    for i, ticker in enumerate(tickers[:5]):
        impact = _title_override_impact(title, base_impact)
        watch = ticker in {s.upper() for s in (watchlist_symbols or [])}
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
            if sym not in existing:
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
        if "QQQ" not in existing:
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

    if watchlist_symbols:
        existing = {a["symbol"] for a in affected}
        wl = [s.strip().upper() for s in watchlist_symbols if s.strip()]
        for sym in wl:
            if sym in tickers and sym not in existing:
                fallback_impact = affected[0]["impact"] if affected else "neutral"
                affected.append(
                    {
                        "symbol": sym,
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
    _ = article.get("title")
    direct = [a["symbol"] for a in affected_stocks if a.get("is_direct")][:2]
    if not direct:
        return None

    sentiment = _sentiment_from_article(article)
    if sentiment == "positive":
        return f"Positive catalyst for {', '.join(direct)}; watch for sympathy across related names."
    if sentiment == "negative":
        return f"Negative catalyst for {', '.join(direct)}; watch for sector spillover pressure."
    return None