"""
Phase 2.5b: News catalyst detector.

Ranks market news items by likely intraday catalyst strength.
"""

from __future__ import annotations

from dataclasses import dataclass

from stocvest.data.models import NewsArticle, Newssentiment


@dataclass(frozen=True)
class NewsCatalystCandidate:
    article_id: str
    symbol: str
    title: str
    catalyst_type: str
    direction: str  # "up", "down", "neutral"
    catalyst_score: float
    sentiment_score: float
    source: str | None


class NewsCatalystDetector:
    """
    Detect and rank day-trading catalysts from scored news.

    Uses deterministic heuristics so behavior is transparent and testable.
    """

    # Law-firm alerts, retrospective fluff, PR churn — exclude on headline only (case-insensitive).
    _HEADLINE_NOISE_SUBSTRINGS: tuple[str, ...] = (
        "rosen",
        "national trial lawyers",
        "investor counsel",
        "class action",
        "deadline:",
        "investigation:",
        "securities fraud",
        "if you'd invested",
        "here's how much",
        "this week",
    )

    _KEYWORD_WEIGHTS: dict[str, tuple[str, float]] = {
        "price target": ("analyst", 0.40),
        "earnings": ("earnings", 0.45),
        "guidance": ("guidance", 0.40),
        "outlook": ("guidance", 0.35),
        "revenue": ("earnings", 0.30),
        "beat": ("earnings", 0.42),
        "miss": ("earnings", 0.40),
        "merger": ("m&a", 0.50),
        "acquisition": ("m&a", 0.50),
        "analyst": ("analyst", 0.32),
        "fda": ("regulatory", 0.55),
        "approval": ("regulatory", 0.45),
        "investigation": ("legal", 0.50),
        "lawsuit": ("legal", 0.45),
        "downgrade": ("analyst", 0.35),
        "upgrade": ("analyst", 0.35),
        "contract": ("business", 0.30),
        "guides": ("guidance", 0.35),
    }

    _SOURCE_BONUS: dict[str, float] = {
        "reuters": 0.08,
        "bloomberg": 0.08,
        "associated press": 0.06,
        "wsj": 0.06,
    }

    def __init__(self, *, min_score: float = 0.35) -> None:
        self._min_score = min_score

    def detect(self, articles: list[NewsArticle], *, limit: int = 8) -> list[NewsCatalystCandidate]:
        candidates: list[NewsCatalystCandidate] = []
        for article in articles:
            candidate = self._to_candidate(article)
            if candidate is None:
                continue
            if candidate.catalyst_score < self._min_score:
                continue
            candidates.append(candidate)

        candidates.sort(key=lambda item: item.catalyst_score, reverse=True)
        return candidates[: max(0, limit)]

    @classmethod
    def _headline_is_noise(cls, title: str) -> bool:
        h = title.lower()
        return any(sub in h for sub in cls._HEADLINE_NOISE_SUBSTRINGS)

    def _to_candidate(self, article: NewsArticle) -> NewsCatalystCandidate | None:
        if not article.tickers:
            return None
        if self._headline_is_noise(article.title):
            return None

        text = f"{article.title} {article.description or ''} {' '.join(article.keywords)}".lower()
        best_type = "general"
        best_keyword_weight = 0.0

        for keyword, (cat_type, weight) in self._KEYWORD_WEIGHTS.items():
            if keyword in text and weight > best_keyword_weight:
                best_type = cat_type
                best_keyword_weight = weight

        sentiment_score = float(article.sentiment_score or 0.0)
        sentiment_mag = min(1.0, abs(sentiment_score))

        source_bonus = 0.0
        if article.source:
            source_lower = article.source.lower()
            for source_key, bonus in self._SOURCE_BONUS.items():
                if source_key in source_lower:
                    source_bonus = max(source_bonus, bonus)

        catalyst_score = min(1.0, 0.15 + (0.55 * sentiment_mag) + best_keyword_weight + source_bonus)
        if catalyst_score <= 0:
            return None

        if article.sentiment == Newssentiment.BULLISH or sentiment_score > 0.05:
            direction = "up"
        elif article.sentiment == Newssentiment.BEARISH or sentiment_score < -0.05:
            direction = "down"
        else:
            direction = "neutral"

        return NewsCatalystCandidate(
            article_id=article.article_id,
            symbol=article.tickers[0],
            title=article.title,
            catalyst_type=best_type,
            direction=direction,
            catalyst_score=round(catalyst_score, 4),
            sentiment_score=round(sentiment_score, 4),
            source=article.source,
        )
