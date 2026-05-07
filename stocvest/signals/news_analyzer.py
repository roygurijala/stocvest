"""Layer 2 — weighted sentiment from Polygon news rows (dicts)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from stocvest.api.services.news_quality_filter import is_quality_article
from stocvest.config.signal_parameters import NewsParameters
from stocvest.signals.news_sentiment import (
    DAY_NEWS_LOOKBACK_HOURS,
    SWING_NEWS_LOOKBACK_HOURS,
    swing_recency_weight,
)


@dataclass
class NewsLayerResult:
    status: str
    score: int | None
    verdict: str
    article_count: int = 0
    weighted_sentiment: float | None = None
    catalyst_type: str | None = None
    catalyst_headline: str | None = None
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)


_CATALYST_PATTERNS: dict[str, tuple[str, ...]] = {
    "earnings": ("earnings", "eps", "revenue", "beat", "miss", "guidance"),
    "analyst": ("upgrade", "downgrade", "price target", "raises", "cuts"),
    "fda": ("fda", "approval", "approved", "rejected", "clinical"),
    "merger": ("merger", "acquisition", "deal", "takeover", "buyout"),
    "macro": ("fed", "federal reserve", "rate", "inflation", "cpi", "gdp", "jobs"),
}


def _article_sentiment(article: dict[str, Any]) -> float:
    insights = article.get("insights")
    if isinstance(insights, list) and insights:
        first = insights[0]
        if isinstance(first, dict):
            s = str(first.get("sentiment") or "").lower()
            if s in ("positive", "bullish"):
                return 1.0
            if s in ("negative", "bearish"):
                return -1.0
    return 0.0


def _detect_catalyst(title: str, desc: str) -> tuple[str | None, str | None]:
    blob = f"{title} {desc}".lower()
    for kind, keys in _CATALYST_PATTERNS.items():
        if any(k in blob for k in keys):
            return kind, title[:120] if title else None
    return None, None


class NewsAnalyzer:
    def analyze(
        self,
        symbol: str,
        articles: list[dict[str, Any]],
        params: NewsParameters,
        *,
        lookback_hours: int | None = None,
        mode: Literal["day", "swing"] = "day",
    ) -> NewsLayerResult:
        sym = symbol.upper().strip()
        now = datetime.now(timezone.utc)
        if lookback_hours is not None:
            lb_h = float(lookback_hours)
        elif mode == "swing":
            lb_h = float(SWING_NEWS_LOOKBACK_HOURS)
        else:
            lb_h = float(params.lookback_hours if params.lookback_hours else DAY_NEWS_LOOKBACK_HOURS)
        cutoff = now - timedelta(hours=lb_h)
        raw_rows = [a for a in articles if isinstance(a, dict)]
        time_filtered: list[dict[str, Any]] = []
        for a in raw_rows:
            pub_raw = a.get("published_utc")
            try:
                pub = datetime.fromisoformat(str(pub_raw).replace("Z", "+00:00"))
                if pub.tzinfo is None:
                    pub = pub.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                time_filtered.append(a)
                continue
            if pub.astimezone(timezone.utc) >= cutoff:
                time_filtered.append(a)
        rows = time_filtered[: params.max_articles]
        quality = [a for a in rows if is_quality_article(a)]
        if not quality:
            return NewsLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                article_count=0,
                reasoning="No qualifying news articles in lookback.",
                chips=[],
            )

        weights: list[float] = []
        sentiments: list[float] = []
        catalyst_type: str | None = None
        catalyst_headline: str | None = None

        for art in quality:
            title = str(art.get("title") or "")
            desc = str(art.get("description") or "")
            ct, ch_head = _detect_catalyst(title, desc)
            if ct and catalyst_type is None:
                catalyst_type = ct
                catalyst_headline = ch_head

            sent = _article_sentiment(art)
            pub_raw = art.get("published_utc")
            try:
                pub = datetime.fromisoformat(str(pub_raw).replace("Z", "+00:00"))
                if pub.tzinfo is None:
                    pub = pub.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                pub = now
            age_sec = max(0.0, (now - pub.astimezone(timezone.utc)).total_seconds())
            age_h = age_sec / 3600.0
            if age_h < 1:
                w_time = params.recency_1h_weight
            elif age_h < 4:
                w_time = params.recency_4h_weight
            elif age_h < 8:
                w_time = params.recency_8h_weight
            else:
                w_time = params.recency_old_weight

            tickers = art.get("tickers")
            tset = {str(t).strip().upper() for t in tickers} if isinstance(tickers, list) else set()
            rel = params.direct_mention_weight if sym in tset else params.indirect_mention_weight
            combined = w_time * rel
            if mode == "swing":
                combined *= swing_recency_weight(pub.astimezone(timezone.utc), now)
            weights.append(combined)
            sentiments.append(sent)

        wsum = sum(weights)
        if wsum <= 0:
            return NewsLayerResult(
                status="unavailable",
                score=None,
                verdict="neutral",
                article_count=len(quality),
                reasoning="Article weights collapsed to zero.",
                chips=[],
            )

        weighted_avg = sum(s * w for s, w in zip(sentiments, weights)) / wsum
        score = int(round((weighted_avg + 1) / 2 * 100))

        if score >= params.bullish_threshold:
            verdict = "bullish"
        elif score <= params.bearish_threshold:
            verdict = "bearish"
        else:
            verdict = "neutral"

        chips = [f"{len(quality)} articles", f"sent_avg {weighted_avg:+.2f}"]
        if catalyst_type:
            chips.append(f"Catalyst: {catalyst_type}")

        return NewsLayerResult(
            status="available",
            score=score,
            verdict=verdict,
            article_count=len(quality),
            weighted_sentiment=weighted_avg,
            catalyst_type=catalyst_type,
            catalyst_headline=catalyst_headline,
            reasoning=(
                f"News score {score}/100 from {len(quality)} quality articles "
                f"(weighted sentiment {weighted_avg:+.2f})."
            ),
            chips=chips,
        )
