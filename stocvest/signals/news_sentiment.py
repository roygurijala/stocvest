"""
Phase 2a: News sentiment scoring via Claude API.

This module never logs article prices/accounts/credentials and never hardcodes keys.
It uses environment-backed settings through get_settings().
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from stocvest.data.models import NewsArticle, Newssentiment
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

logger = get_logger(__name__)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-sonnet-4-6"  # Claude Sonnet 4.6 (Anthropic Messages API id)
REQUEST_TIMEOUT_SECONDS = 20.0
DEFAULT_MAX_RETRIES = 2
DEFAULT_MAX_CONCURRENCY = 5

# Composite news windows (aligned with `NewsAnalyzer` `mode` kwarg).
DAY_NEWS_LOOKBACK_HOURS = 8
SWING_NEWS_LOOKBACK_HOURS = 120  # ~5 trading sessions of headlines for swing context


def swing_recency_weight(published_at: datetime, now: datetime) -> float:
    """
    Decay multiplier for swing-mode news aggregation (older articles count less).

    Day/intraday mode does not apply this — only the swing composite news layer.
    """
    age_hours = (now - published_at).total_seconds() / 3600.0
    if age_hours <= 24:
        return 1.0
    if age_hours <= 48:
        return 0.80
    if age_hours <= 72:
        return 0.60
    if age_hours <= 96:
        return 0.40
    return 0.25


@dataclass(frozen=True)
class SentimentResult:
    """Normalized sentiment analysis output."""

    sentiment: Newssentiment
    score: float
    confidence: float
    rationale: str


class NewsSentimentScorer:
    """Claude-backed sentiment scoring service for market news."""

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        timeout_seconds: float = REQUEST_TIMEOUT_SECONDS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        max_concurrency: int = DEFAULT_MAX_CONCURRENCY,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = get_settings()
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._max_concurrency = max_concurrency
        self._http_client = http_client

    async def score_article(self, article: NewsArticle) -> SentimentResult:
        """Score a single news article and return normalized sentiment output."""
        self._validate_credentials()
        payload = self._build_payload(article)

        # Keep logs non-sensitive: no article body, prices, accounts, or credentials.
        logger.debug("Scoring article sentiment for article_id=%s", article.article_id)

        response_json = await self._post_to_claude(payload)
        result = self._parse_result(response_json)

        logger.debug(
            "Sentiment scored for article_id=%s sentiment=%s score=%.3f",
            article.article_id,
            result.sentiment.value,
            result.score,
        )
        return result

    async def score_articles(self, articles: list[NewsArticle]) -> list[NewsArticle]:
        """
        Score multiple articles and return enriched article objects.

        Any per-article API/parse failure is converted into neutral sentiment so
        scanner workflows remain resilient.
        """
        semaphore = asyncio.Semaphore(self._max_concurrency)

        async def _score_one(article: NewsArticle) -> NewsArticle:
            try:
                async with semaphore:
                    result = await self.score_article(article)
                    return article.model_copy(
                        update={
                            "sentiment": result.sentiment,
                            "sentiment_score": result.score,
                        }
                    )
            except (httpx.HTTPError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                logger.warning(
                    "Falling back to neutral sentiment for article_id=%s reason=%s",
                    article.article_id,
                    type(exc).__name__,
                )
                return article.model_copy(
                    update={
                        "sentiment": Newssentiment.NEUTRAL,
                        "sentiment_score": 0.0,
                    }
                )

        return list(await asyncio.gather(*(_score_one(article) for article in articles)))

    def _validate_credentials(self) -> None:
        if not self._settings.anthropic_api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY is required for news sentiment scoring."
            )

    def _build_payload(self, article: NewsArticle) -> dict[str, Any]:
        prompt = (
            "You are a financial-news sentiment classifier.\n"
            "Classify the article for the listed ticker context.\n"
            "Return strict JSON only with keys: sentiment, score, confidence, rationale.\n"
            "sentiment must be one of: bullish, bearish, neutral.\n"
            "score must be a float from -1.0 to 1.0.\n"
            "confidence must be a float from 0.0 to 1.0.\n"
            "rationale must be <= 240 chars.\n\n"
            f"Title: {article.title}\n"
            f"Description: {article.description or ''}\n"
            f"Source: {article.source or ''}\n"
            f"Tickers: {', '.join(article.tickers) if article.tickers else 'N/A'}\n"
        )
        return {
            "model": self._model,
            "max_tokens": 300,
            "temperature": 0,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
        }

    async def _post_to_claude(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "x-api-key": self._settings.anthropic_api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        last_error: Exception | None = None
        last_status: int | None = None
        last_body_snippet = ""

        from stocvest.utils.api_rate_limits import await_claude_api_slot

        for attempt in range(self._max_retries + 1):
            try:
                await await_claude_api_slot()
                response = await self._send_claude_request(headers, payload)
            except httpx.RequestError as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    break
                await asyncio.sleep(0.5 * (2**attempt))
                continue

            if response.status_code in (429, 500, 502, 503, 504) and attempt < self._max_retries:
                last_status = response.status_code
                last_body_snippet = response.text[:200]
                await asyncio.sleep(0.5 * (2**attempt))
                continue

            if response.status_code >= 400:
                raise httpx.HTTPError(
                    f"Claude sentiment request failed status={response.status_code} body={response.text[:200]}"
                )
            return response.json()

        if last_status is not None:
            raise httpx.HTTPError(
                f"Claude sentiment request failed after retries status={last_status} body={last_body_snippet}"
            )
        raise httpx.HTTPError(
            f"Claude sentiment request failed after retries: {type(last_error).__name__}"
        )

    async def _send_claude_request(
        self, headers: dict[str, str], payload: dict[str, Any]
    ) -> httpx.Response:
        if self._http_client is not None:
            return await self._http_client.post(
                ANTHROPIC_API_URL,
                headers=headers,
                json=payload,
                timeout=self._timeout_seconds,
            )

        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            return await client.post(
                ANTHROPIC_API_URL,
                headers=headers,
                json=payload,
            )

    def _parse_result(self, response_json: dict[str, Any]) -> SentimentResult:
        content = response_json.get("content", [])
        if not content:
            raise ValueError("Claude response content missing text payload.")

        text_blocks: list[str] = [
            block.get("text", "") for block in content if isinstance(block, dict) and "text" in block
        ]
        raw_text = "\n".join(part.strip() for part in text_blocks if part and part.strip())
        if not raw_text:
            raise ValueError("Claude response content missing text payload.")

        parsed = self._load_json_from_text(raw_text)

        sentiment_raw = str(parsed["sentiment"]).strip().lower()
        if sentiment_raw not in {s.value for s in Newssentiment}:
            raise ValueError(f"Invalid sentiment: {sentiment_raw}")

        score = float(parsed["score"])
        confidence = float(parsed["confidence"])
        rationale = str(parsed.get("rationale", "")).strip()

        score = max(-1.0, min(1.0, score))
        confidence = max(0.0, min(1.0, confidence))
        if len(rationale) > 240:
            rationale = rationale[:240]

        return SentimentResult(
            sentiment=Newssentiment(sentiment_raw),
            score=score,
            confidence=confidence,
            rationale=rationale,
        )

    @staticmethod
    def _load_json_from_text(text: str) -> dict[str, Any]:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Handle model output that wraps JSON with prose.
            match = re.search(r"\{.*\}", text, flags=re.DOTALL)
            if not match:
                raise
            return json.loads(match.group(0))
