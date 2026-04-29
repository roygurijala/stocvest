"""
Phase 2b: Macro event detector.

Detects macro catalysts from normalized news articles and estimates directional
market impact for use in composite signal scoring.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from stocvest.data.models import NewsArticle
from stocvest.utils.logging import get_logger

logger = get_logger(__name__)


class MacroEventType(str, Enum):
    FOMC = "fomc"
    CPI = "cpi"
    NFP = "nfp"
    GDP = "gdp"
    RETAIL_SALES = "retail_sales"
    PPI = "ppi"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class MacroEvent:
    event_type: MacroEventType
    title: str
    severity: float  # 0.0 - 1.0
    direction: int   # -1 bearish, 0 neutral, +1 bullish
    confidence: float  # 0.0 - 1.0
    rationale: str


class MacroEventDetector:
    """
    Rule-based macro event detector.

    Keeps implementation deterministic and testable. Phase 2e can later combine
    these outputs with AI synthesis.
    """

    _EVENT_PATTERNS: dict[MacroEventType, tuple[str, ...]] = {
        MacroEventType.FOMC: ("fomc", "federal reserve", "powell", "rate decision"),
        MacroEventType.CPI: ("cpi", "consumer price index", "inflation report"),
        MacroEventType.NFP: ("nonfarm payroll", "nfp", "jobs report", "unemployment rate"),
        MacroEventType.GDP: ("gdp", "gross domestic product"),
        MacroEventType.RETAIL_SALES: ("retail sales",),
        MacroEventType.PPI: ("ppi", "producer price index"),
    }

    _POSITIVE_HINTS = ("cooling", "cools", "falls", "below expectations", "dovish", "cut")
    _NEGATIVE_HINTS = ("hotter", "heats up", "above expectations", "hawkish", "hike", "sticky")

    _BASE_SEVERITY: dict[MacroEventType, float] = {
        MacroEventType.FOMC: 0.95,
        MacroEventType.CPI: 0.90,
        MacroEventType.NFP: 0.85,
        MacroEventType.GDP: 0.75,
        MacroEventType.RETAIL_SALES: 0.65,
        MacroEventType.PPI: 0.70,
        MacroEventType.UNKNOWN: 0.50,
    }

    def detect_from_article(self, article: NewsArticle) -> MacroEvent | None:
        text = f"{article.title} {article.description or ''}".lower()

        event_type = self._match_event_type(text)
        if event_type is None:
            return None

        direction = self._infer_direction(text)
        confidence = 0.90 if direction != 0 else 0.75
        severity = self._BASE_SEVERITY[event_type]

        logger.debug(
            "Detected macro event article_id=%s type=%s severity=%.2f direction=%d",
            article.article_id,
            event_type.value,
            severity,
            direction,
        )

        return MacroEvent(
            event_type=event_type,
            title=article.title,
            severity=severity,
            direction=direction,
            confidence=confidence,
            rationale=f"Matched {event_type.value} pattern from article text.",
        )

    def detect_from_articles(self, articles: list[NewsArticle]) -> list[MacroEvent]:
        events: list[MacroEvent] = []
        for article in articles:
            event = self.detect_from_article(article)
            if event is not None:
                events.append(event)
        return events

    @staticmethod
    def aggregate_market_bias(events: list[MacroEvent]) -> float:
        """Weighted directional score in [-1.0, 1.0]."""
        if not events:
            return 0.0

        weighted_sum = sum(event.direction * event.severity for event in events)
        max_possible = sum(event.severity for event in events) or 1.0
        bias = weighted_sum / max_possible
        return max(-1.0, min(1.0, bias))

    def _match_event_type(self, text: str) -> MacroEventType | None:
        for event_type, patterns in self._EVENT_PATTERNS.items():
            if any(pattern in text for pattern in patterns):
                return event_type
        return None

    def _infer_direction(self, text: str) -> int:
        has_positive = any(self._contains_phrase(text, token) for token in self._POSITIVE_HINTS)
        has_negative = any(self._contains_phrase(text, token) for token in self._NEGATIVE_HINTS)

        if has_positive and not has_negative:
            return 1
        if has_negative and not has_positive:
            return -1
        return 0

    @staticmethod
    def _contains_phrase(text: str, phrase: str) -> bool:
        pattern = r"\b" + re.escape(phrase) + r"\b"
        if not re.search(pattern, text):
            return False
        negated_pattern = r"\b(no|not|unlikely|avoid|without)\s+" + re.escape(phrase) + r"\b"
        return not re.search(negated_pattern, text)
