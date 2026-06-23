"""SQS-triggered Lambda: Claude sentiment scoring for pre-triaged :class:`NewsArticle` rows."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from stocvest.data.models import NewsArticle
from stocvest.signals.news_sentiment import NewsSentimentScorer
from stocvest.utils.api_rate_limits import await_claude_api_slot
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

log = get_logger(__name__)


def _parse_article_body(body: str) -> NewsArticle | None:
    try:
        data = json.loads(body)
        return NewsArticle.model_validate(data)
    except Exception as exc:
        log.warning("Invalid news message body: %s", exc)
        return None


async def _process_record(record: dict[str, Any]) -> None:
    body = record.get("body")
    if not isinstance(body, str):
        return
    article = _parse_article_body(body)
    if article is None:
        return
    await await_claude_api_slot()
    scorer = NewsSentimentScorer()
    result = await scorer.score_article(article)
    enriched = article.model_copy(
        update={"sentiment": result.sentiment, "sentiment_score": result.score},
    )
    settings = get_settings()
    key = settings.stocvest_news_scored_redis_list_key.strip() or "stocvest:news_scored"
    try:
        from stocvest.utils.redis_client import get_sync_redis

        r = get_sync_redis()
        if r is not None:
            payload = enriched.model_dump_json()
            await asyncio.to_thread(r.rpush, key, payload)
    except Exception as exc:
        log.debug("redis rpush scored news skipped: %s", exc)

    # B71 Phase D: content-keyed read-through cache for the composite news layer
    # (no-op + fail-open unless STOCVEST_NEWS_SENTIMENT_CACHE_ENABLED is set).
    try:
        from stocvest.signals.news_sentiment_cache import write_article_sentiment

        await asyncio.to_thread(
            write_article_sentiment,
            url=enriched.url,
            title=enriched.title,
            sentiment=result.sentiment.value,
            score=float(result.score),
            relevance=float(result.relevance),
            impact=float(result.impact),
        )
    except Exception as exc:
        log.debug("news sentiment cache write skipped: %s", exc)
    log.info(
        "Scored news article_id=%s sentiment=%s",
        enriched.article_id,
        result.sentiment.value,
    )


def sqs_lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    records = event.get("Records") or []
    if not isinstance(records, list):
        return {}
    failures: list[dict[str, str]] = []

    async def _run_all() -> None:
        for rec in records:
            if not isinstance(rec, dict):
                continue
            mid = str(rec.get("messageId") or "")
            try:
                await _process_record(rec)
            except Exception as exc:
                log.exception("news consumer failed messageId=%s: %s", mid, exc)
                if mid:
                    failures.append({"itemIdentifier": mid})

    asyncio.run(_run_all())
    return {"batchItemFailures": failures} if failures else {}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return sqs_lambda_handler(event, context)
