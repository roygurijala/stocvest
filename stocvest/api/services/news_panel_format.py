"""Format Polygon/Benzinga news rows for the ticker news panel API."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

_NY = ZoneInfo("America/New_York")

NewsPanelSource = Literal["benzinga", "sec_edgar", "polygon"]
NewsSentimentLabel = Literal["bullish", "bearish", "neutral"]

RECENT_NEWS_HOURS = 4


def parse_published_utc(raw: str) -> datetime | None:
    s = (raw or "").strip().replace("Z", "+00:00")
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def compute_news_age_label(now_utc: datetime, published_utc: datetime) -> str:
    now_utc = now_utc.astimezone(timezone.utc)
    published_utc = published_utc.astimezone(timezone.utc)
    delta = now_utc - published_utc
    if delta.total_seconds() < 0:
        delta = timedelta(0)
    if delta.total_seconds() < 3600:
        mins = max(1, int(delta.total_seconds() // 60))
        return f"{mins}m ago"
    if delta.total_seconds() < 86400:
        hours = max(1, int(delta.total_seconds() // 3600))
        return f"{hours}h ago"
    pub_d = published_utc.astimezone(_NY).date()
    now_d = now_utc.astimezone(_NY).date()
    if pub_d == now_d - timedelta(days=1):
        return "Yesterday"

    def monday(d: date) -> date:
        return d - timedelta(days=d.weekday())

    if monday(pub_d) == monday(now_d) and pub_d < now_d:
        return published_utc.astimezone(_NY).strftime("%a")
    dtn = published_utc.astimezone(_NY)
    return f"{dtn.strftime('%b')} {dtn.day}"


def classify_news_source(article: dict[str, Any]) -> tuple[NewsPanelSource, str]:
    title = str(article.get("title") or "").lower()
    desc = str(article.get("description") or "").lower()
    url = str(article.get("article_url") or "").lower()
    publisher = str((article.get("publisher") or {}).get("name") or "").lower()
    raw_src = str(article.get("source") or "").strip().lower()

    if "sec.gov" in url or "sec.gov" in str(article.get("url") or "").lower():
        return "sec_edgar", "SEC EDGAR 8-K"
    if "edgar" in publisher or "sec" in publisher and "commission" in publisher:
        return "sec_edgar", "SEC EDGAR 8-K"
    if "8-k" in title or "8k filing" in title or "form 8-k" in title:
        return "sec_edgar", "SEC EDGAR 8-K"
    if raw_src == "benzinga" or "benzinga" in publisher:
        return "benzinga", "Benzinga"
    return "polygon", "Polygon"


def sentiment_score_and_label(article: dict[str, Any]) -> tuple[float, NewsSentimentLabel]:
    score: float | None = None
    insights = article.get("insights")
    if isinstance(insights, list) and insights:
        first = insights[0]
        if isinstance(first, dict):
            raw_sent = str(first.get("sentiment") or "").strip().lower()
            if raw_sent == "positive":
                score = 0.55
            elif raw_sent == "negative":
                score = -0.55
            elif raw_sent == "neutral":
                score = 0.0
    raw_sent2 = str(article.get("sentiment") or "").strip().lower()
    if score is None:
        if raw_sent2 == "positive":
            score = 0.55
        elif raw_sent2 == "negative":
            score = -0.55
        elif raw_sent2 == "neutral":
            score = 0.0
    if score is None:
        score = 0.0
    # Clamp
    score = max(-1.0, min(1.0, float(score)))
    if score > 0.2:
        label: NewsSentimentLabel = "bullish"
    elif score < -0.2:
        label = "bearish"
    else:
        label = "neutral"
    return score, label


def catalyst_type_for_article(article: dict[str, Any]) -> str | None:
    title_lower = str(article.get("title") or "").lower()
    desc_lower = str(article.get("description") or "").lower()
    from stocvest.api.services.news_relevance import catalyst_category_for_text

    cat = catalyst_category_for_text(title_lower, desc_lower)
    if cat == "general":
        return None
    return str(cat)
