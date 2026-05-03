"""
Phase 2.5b: News catalyst detector.

Ranks market news items by likely intraday catalyst strength.
"""

from __future__ import annotations

import re
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

    _LISTICLE_PATTERNS: tuple[str, ...] = (
        r"\b\d+ (stocks|ways|reasons)\b",
        r"\b(top|best) \d+ stocks\b",
        r"\bwhy (you should|investors should)\b",
        r"\bshould you buy\b",
        r"\bis it time to\b",
        r"\bhere's why .{0,30} (could|might|may)\b",
    )

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
        "what could happen if",
        "here's what that means",
        "ceo pay",
        "worker wages",
        "put $",
        "$10,000 into",
        "soared along with",
        "slumped this week",
        "growth stocks to invest",
        "to invest $",
        "the great rotation",
        "back to crypto",
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
            "merger",
            (
                "merger",
                "acquisition",
                "buyout",
                "takeover",
                "deal",
                "acquired",
                "m&a",
                "eyes ebay",
                "chases valuation",
            ),
        ),
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
        "eyes takeover",
        "eyes acquisition",
        "chases valuation",
        "to acquire",
        "agrees to buy",
        "takeover bid",
        "merger deal",
        "buyout offer",
    )

    _MERGER_TARGET_HINTS: tuple[str, ...] = ("acquisition target", "takeover target")

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

    def candidate_for_symbol(
        self,
        article: NewsArticle,
        symbol: str,
        company_name: str | None = None,
    ) -> NewsCatalystCandidate | None:
        """
        Score one article for a specific ticker.

        Prefer Polygon ``tickers`` match; optional ``company_name`` fallback when the
        headline names the company but tickers are missing or incomplete.
        """
        sym = symbol.strip().upper()
        if not sym:
            return None
        tick_set = {t.strip().upper() for t in article.tickers} if article.tickers else set()
        ticker_hit = sym in tick_set
        company_hit = False
        if not ticker_hit and company_name:
            company_hit = self._matches_by_company_name(article.title, company_name)
        if not ticker_hit and not company_hit:
            return None
        narrative_scale = 0.8 if company_hit and not ticker_hit else 1.0
        return self._to_candidate_for_symbol(article, sym, narrative_scale=narrative_scale)

    @classmethod
    def article_relevant_for_gap(
        cls,
        article: NewsArticle,
        symbol: str,
        company_name: str | None,
    ) -> bool:
        """True if the article is tied to ``symbol`` via tickers or company-name headline match."""
        sym = symbol.strip().upper()
        if not sym:
            return False
        if article.tickers and sym in {t.strip().upper() for t in article.tickers}:
            return True
        if company_name:
            return cls._matches_by_company_name(article.title, company_name)
        return False

    @staticmethod
    def _matches_by_company_name(headline: str, company_name: str) -> bool:
        if not company_name or len(company_name.strip()) <= 4:
            return False
        headline_lower = headline.lower()
        full = company_name.strip().lower()
        if len(full) > 4 and full in headline_lower:
            return True
        for part in re.split(r"[\s,]+", company_name.strip()):
            p = part.strip().lower()
            if len(p) <= 4:
                continue
            for suf in ("inc.", "inc", "corp.", "corp", "corporation", "plc", "llc", "ltd.", "ltd"):
                if p.endswith(suf) and len(p) > len(suf):
                    p = p[: -len(suf)].strip()
                    break
            if len(p) > 4 and p in headline_lower:
                return True
        return False

    @classmethod
    def _is_generic_advice_article(cls, headline_lower: str) -> bool:
        return any(re.search(p, headline_lower) for p in cls._LISTICLE_PATTERNS)

    @classmethod
    def _headline_is_noise(cls, title: str) -> bool:
        h = title.lower()
        if cls._is_generic_advice_article(h):
            return True
        return any(sub in h for sub in cls._HEADLINE_NOISE_SUBSTRINGS)

    def _matches_fda_category(self, text: str) -> bool:
        """FDA only when regulatory / drug context — not before merger (e.g. 'takeover' headlines)."""
        if "fda" in text or "pdufa" in text:
            return True
        if re.search(r"\bnda\b", text):
            return True
        trial_markers = (
            "clinical trial",
            "phase 2",
            "phase 3",
            "breakthrough designation",
            "fast track",
        )
        if any(k in text for k in trial_markers):
            return True
        if any(k in text for k in self._FDA_EXTRA) and any(
            k in text for k in ("fda", "drug", "therapy", "treatment", "pdufa", "clinical")
        ):
            return True
        return False

    def _classify_category(self, text: str) -> str:
        for cat, keywords in self._CATEGORY_RULES:
            if cat == "earnings":
                if any(k in text for k in keywords):
                    return cat
            elif any(k in text for k in keywords):
                return cat
        if self._matches_fda_category(text):
            return "fda"
        return "macro"

    def _narrative_score(self, text: str) -> int:
        bull = sum(1 for k in self._BULLISH if k in text)
        bear = sum(1 for k in self._BEARISH if k in text)
        # "Eyes … takeover" / "eyes … acquisition" (ticker often between words)
        if re.search(r"\beyes\b.+\btakeover\b", text):
            bull += 2
        if re.search(r"\beyes\b.+\bacquisition\b", text):
            bull += 2
        raw = 50 + 8 * bull - 8 * bear
        if any(p in text for p in self._MERGER_TARGET_HINTS):
            raw -= 10
            # Target-of-deal language: dampen but stay out of bearish band
            raw = max(46, min(64, raw))
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

    def _to_candidate_for_symbol(
        self,
        article: NewsArticle,
        symbol: str,
        *,
        narrative_scale: float = 1.0,
    ) -> NewsCatalystCandidate | None:
        if self._headline_is_noise(article.title):
            return None

        text = f"{article.title} {article.description or ''} {' '.join(article.keywords)}".lower()
        category = self._classify_category(text)
        narrative_score = self._narrative_score(text)
        if narrative_scale != 1.0:
            narrative_score = int(max(22, min(88, round(narrative_score * narrative_scale))))
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
