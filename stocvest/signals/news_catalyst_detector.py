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
    direction: str  # "up", "down", "neutral" — legacy, aligned with sentiment_label
    catalyst_score: float
    sentiment_score: float
    source: str | None
    sentiment_label: str = "mixed"  # bullish | bearish | mixed
    narrative_score: int = 55  # 0–100 display score


class NewsCatalystDetector:
    """
    Detect and rank day-trading catalysts from scored news.

    Uses deterministic heuristics so behavior is transparent and testable.
    """

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
        "what could happen if",
        "here's what that means",
        "ceo pay",
        "worker wages",
        "put $",
        "$10,000 into",
        "soared along with",
        "slumped this week",
    )

    _CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("insider", ("insider", "sold shares", "purchased shares", "10b5-1", "10-b5-1", "form 4")),
        (
            "analyst",
            (
                "price target",
                "upgrade",
                "downgrade",
                "overweight",
                "underweight",
                "outperform",
                "neutral rating",
                "buy rating",
                "sell rating",
            ),
        ),
        (
            "fda",
            (
                "fda",
                "pdufa",
                "nda",
                "clinical trial",
                "phase 2",
                "phase 3",
                "breakthrough designation",
                "fast track",
            ),
        ),
        ("merger", ("merger", "acquisition", "buyout", "takeover", "deal", "acquired")),
        ("earnings", ("earnings", "eps", "guidance", "revenue", "quarterly", "q1 ", "q2 ", "q3 ", "q4 ")),
        ("macro", ("fomc", "federal reserve", "cpi", "inflation", "jobs report", "nonfarm", "nfp")),
    )

    _FDA_EXTRA: tuple[str, ...] = ("approved", "rejected")

    _BULLISH: tuple[str, ...] = (
        "beat",
        "exceeded",
        "surpassed",
        "raised guidance",
        "raises guidance",
        "record revenue",
        "strong demand",
        "approved",
        "upgrade",
        "outperform",
        "breakthrough",
    )

    _BEARISH: tuple[str, ...] = (
        "missed",
        "fell short",
        "lowered guidance",
        "disappointing",
        " loss",
        "rejected",
        "downgrade",
        "underperform",
        "warning",
        "lawsuit settled",
    )

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

    def candidate_for_symbol(self, article: NewsArticle, symbol: str) -> NewsCatalystCandidate | None:
        """Score one article for a specific ticker (symbol must appear in article.tickers)."""
        sym = symbol.strip().upper()
        if not sym or not article.tickers:
            return None
        if sym not in {t.strip().upper() for t in article.tickers}:
            return None
        return self._to_candidate_for_symbol(article, sym)

    @classmethod
    def _headline_is_noise(cls, title: str) -> bool:
        h = title.lower()
        return any(sub in h for sub in cls._HEADLINE_NOISE_SUBSTRINGS)

    def _classify_category(self, text: str) -> str:
        for cat, keywords in self._CATEGORY_RULES:
            if cat == "fda":
                if any(k in text for k in keywords) or any(k in text for k in self._FDA_EXTRA):
                    return cat
            elif cat == "earnings":
                if any(k in text for k in keywords):
                    return cat
            else:
                if any(k in text for k in keywords):
                    return cat
        return "macro"

    def _narrative_score(self, text: str) -> int:
        bull = sum(1 for k in self._BULLISH if k in text)
        bear = sum(1 for k in self._BEARISH if k in text)
        raw = 50 + 8 * bull - 8 * bear
        return max(22, min(88, raw))

    @staticmethod
    def _label_from_narrative(score: int) -> str:
        if score >= 65:
            return "bullish"
        if score <= 45:
            return "bearish"
        return "mixed"

    def _catalyst_strength(
        self,
        narrative_score: int,
        category: str,
        source_bonus: float,
    ) -> float:
        cat_boost = {
            "insider": 0.14,
            "fda": 0.12,
            "merger": 0.12,
            "earnings": 0.10,
            "analyst": 0.08,
            "macro": 0.06,
        }.get(category, 0.05)
        base = 0.18 + 0.55 * (narrative_score / 100.0) + cat_boost + source_bonus
        return min(1.0, base)

    def _to_candidate(self, article: NewsArticle) -> NewsCatalystCandidate | None:
        if not article.tickers:
            return None
        sym = article.tickers[0].strip().upper()
        return self._to_candidate_for_symbol(article, sym)

    def _to_candidate_for_symbol(self, article: NewsArticle, symbol: str) -> NewsCatalystCandidate | None:
        if self._headline_is_noise(article.title):
            return None

        text = f"{article.title} {article.description or ''} {' '.join(article.keywords)}".lower()
        category = self._classify_category(text)
        narrative_score = self._narrative_score(text)
        sentiment_label = self._label_from_narrative(narrative_score)

        source_bonus = 0.0
        if article.source:
            source_lower = article.source.lower()
            for source_key, bonus in self._SOURCE_BONUS.items():
                if source_key in source_lower:
                    source_bonus = max(source_bonus, bonus)

        catalyst_score = self._catalyst_strength(narrative_score, category, source_bonus)
        if catalyst_score <= 0:
            return None

        sentiment_score = float(article.sentiment_score or 0.0)
        if sentiment_label == "bullish":
            direction = "up"
        elif sentiment_label == "bearish":
            direction = "down"
        else:
            direction = "neutral"
        if article.sentiment == Newssentiment.BULLISH and sentiment_label == "mixed":
            direction = "up"
        elif article.sentiment == Newssentiment.BEARISH and sentiment_label == "mixed":
            direction = "down"

        return NewsCatalystCandidate(
            article_id=article.article_id,
            symbol=symbol.strip().upper(),
            title=article.title,
            catalyst_type=category,
            direction=direction,
            catalyst_score=round(catalyst_score, 4),
            sentiment_score=round(sentiment_score, 4),
            source=article.source,
            sentiment_label=sentiment_label,
            narrative_score=narrative_score,
        )
