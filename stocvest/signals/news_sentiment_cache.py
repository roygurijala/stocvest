"""Read-through Claude sentiment cache for the composite news layer (B71 Phase D).

The composite news layer resolves per-article polarity from Polygon ``insights``
and **abstains to 0** when an article carries no ticker-specific insight (notably
Benzinga-only headlines, which arrive with ``insights == []``). Meanwhile the
async ingestion worker already scores articles with Claude — but that result only
lands in a Redis *list* the composite never reads.

This module bridges the two **without** putting a synchronous Claude call on the
hot scoring path:

* The news consumer writes a small, **content-keyed**, TTL'd cache entry
  (:func:`write_article_sentiment`) keyed by article URL (or normalized title) so
  the same headline is addressable from either pipeline.
* The composite engines call :func:`enrich_rows_with_cached_sentiment` once per
  scoring pass (a single batched ``MGET``) to fill the ``sentiment`` string on
  rows that would otherwise abstain — which the existing
  ``article_sentiment_score_for_symbol`` fallback then reads.

Everything here is **fail-open and flag-gated** (``stocvest_news_sentiment_cache_enabled``,
default OFF): any Redis error, disabled cache, or missing key leaves rows
untouched → identical to pre-B71-D behavior.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from typing import Any

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# CloudWatch namespace for the read-through cache observability metrics (EMF-extracted).
_METRIC_NAMESPACE = "Stocvest/NewsSentimentCache"


def _emit_cache_metrics(**values: int) -> None:
    """Emit CloudWatch metrics via the Embedded Metric Format (EMF).

    A single structured stdout line that Lambda auto-extracts into real metrics —
    no ``put_metric_data`` API call, so no added latency or per-request cost on the
    composite hot path. Best-effort: never raises, and is a harmless JSON log line
    outside Lambda.
    """
    if not values:
        return
    try:
        emf = {
            "_aws": {
                "Timestamp": int(time.time() * 1000),
                "CloudWatchMetrics": [
                    {
                        "Namespace": _METRIC_NAMESPACE,
                        "Dimensions": [[]],
                        "Metrics": [{"Name": name, "Unit": "Count"} for name in values],
                    }
                ],
            },
            **{name: int(val) for name, val in values.items()},
        }
        print(json.dumps(emf))  # noqa: T201 — EMF must be a raw stdout JSON line
    except Exception:  # noqa: BLE001 — metrics must never break scoring
        pass

_VALID_LABELS = frozenset({"positive", "negative", "neutral"})
# Claude (NewsSentimentScorer) emits bullish/bearish/neutral; the composite news
# layer reads positive/negative (article_sentiment_score_for_symbol). Normalize to
# the canonical positive/negative/neutral form before caching.
_LABEL_NORMALIZE = {
    "positive": "positive",
    "bullish": "positive",
    "negative": "negative",
    "bearish": "negative",
    "neutral": "neutral",
}
_WS = re.compile(r"\s+")


def _canonical_label(value: str | None) -> str | None:
    return _LABEL_NORMALIZE.get(str(value or "").strip().lower())


def _normalize_source(url: str | None, title: str | None) -> str | None:
    """Stable content identity: prefer URL (strip scheme/query), else normalized title."""
    u = (url or "").strip().lower()
    if u:
        u = re.sub(r"^https?://", "", u)
        u = u.split("?", 1)[0].split("#", 1)[0].rstrip("/")
        if u:
            return f"u:{u}"
    t = _WS.sub(" ", (title or "").strip().lower())
    if t:
        return f"t:{t}"
    return None


def sentiment_cache_key(*, url: str | None, title: str | None) -> str | None:
    """Content-addressed cache key shared by both pipelines (``None`` if no identity)."""
    src = _normalize_source(url, title)
    if src is None:
        return None
    digest = hashlib.sha1(src.encode("utf-8")).hexdigest()  # noqa: S324 — non-crypto cache key
    prefix = get_settings().stocvest_news_sentiment_cache_key_prefix.strip() or "stocvest:news_sent:"
    return f"{prefix}{digest}"


def _row_key(row: dict[str, Any]) -> str | None:
    return sentiment_cache_key(
        url=str(row.get("article_url") or row.get("url") or "") or None,
        title=str(row.get("title") or "") or None,
    )


def _opt_unit(value: float | None) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, min(1.0, round(float(value), 4)))
    except (TypeError, ValueError):
        return None


def write_article_sentiment(
    *,
    url: str | None,
    title: str | None,
    sentiment: str,
    score: float,
    relevance: float | None = None,
    impact: float | None = None,
) -> bool:
    """Persist one article's Claude sentiment (+ optional relevance/impact) for read-through.

    Called from the async news consumer. No-op (returns ``False``) when the cache
    is disabled, Redis is unavailable, the label is invalid, or no content key
    can be derived. ``relevance``/``impact`` (0–1) power the News-layer impact
    weighting; they are stored only when provided so legacy entries stay polarity-only.
    """
    settings = get_settings()
    if not settings.stocvest_news_sentiment_cache_enabled:
        return False
    label = _canonical_label(sentiment)
    if label is None:
        return False
    key = sentiment_cache_key(url=url, title=title)
    if key is None:
        return False
    try:
        from stocvest.utils.redis_client import get_sync_redis

        r = get_sync_redis()
        if r is None:
            return False
        ttl = max(60, int(settings.stocvest_news_sentiment_cache_ttl_seconds))
        body: dict[str, Any] = {"sentiment": label, "score": round(float(score), 4)}
        rel = _opt_unit(relevance)
        imp = _opt_unit(impact)
        if rel is not None:
            body["relevance"] = rel
        if imp is not None:
            body["impact"] = imp
        r.setex(key, ttl, json.dumps(body))
        return True
    except Exception as exc:  # noqa: BLE001 — cache writes must never break ingestion
        _LOG.debug("news sentiment cache write skipped: %s", exc)
        return False


def _needs_enrichment(row: dict[str, Any]) -> bool:
    """Only fill rows that would otherwise abstain — empty insights and no existing label."""
    if not isinstance(row, dict):
        return False
    insights = row.get("insights")
    if isinstance(insights, list) and len(insights) > 0:
        return False
    existing = str(row.get("sentiment") or "").strip().lower()
    return existing not in _VALID_LABELS


def enrich_rows_with_cached_sentiment(rows: list[dict[str, Any]]) -> int:
    """Fill ``row['sentiment']`` from the Claude cache for abstaining rows. Returns count enriched.

    One batched ``MGET`` per call. Fail-open: any error / disabled cache / cache
    miss leaves the rows untouched and returns ``0``.
    """
    settings = get_settings()
    if not settings.stocvest_news_sentiment_cache_enabled or not isinstance(rows, list):
        return 0

    candidates: list[tuple[dict[str, Any], str]] = []
    for row in rows:
        if not _needs_enrichment(row):
            continue
        key = _row_key(row)
        if key:
            candidates.append((row, key))
    if not candidates:
        return 0

    try:
        from stocvest.utils.redis_client import get_sync_redis

        r = get_sync_redis()
        if r is None:
            return 0
        values = r.mget([key for _, key in candidates])
    except Exception as exc:  # noqa: BLE001 — read-through must never break scoring
        _LOG.debug("news sentiment cache read skipped: %s", exc)
        return 0

    enriched = 0
    for (row, _key), raw in zip(candidates, values or []):
        if not raw:
            continue
        try:
            data = json.loads(raw)
            label = str(data.get("sentiment") or "").strip().lower()
        except (ValueError, TypeError, AttributeError):
            continue
        if label in _VALID_LABELS:
            row["sentiment"] = label
            enriched += 1
    # Hit-rate telemetry for dark-launch validation (no article text → privacy-safe).
    _LOG.info(
        "news_sentiment_cache enrich candidates=%d hits=%d",
        len(candidates),
        enriched,
    )
    _emit_cache_metrics(CacheCandidates=len(candidates), CacheHits=enriched)
    return enriched


def enrich_rows_with_cached_impact(rows: list[dict[str, Any]]) -> int:
    """Attach Claude ``claude_relevance`` / ``claude_impact`` onto rows from the cache.

    Unlike :func:`enrich_rows_with_cached_sentiment` (which only fills *abstaining* rows'
    polarity), this looks up **every** row so the News-layer relevance × impact weighting
    can use Claude's per-article estimates when present. One batched ``MGET``. Gated on
    ``stocvest_news_impact_weighting_enabled``; fail-open (any error / miss leaves rows
    untouched). Returns the count of rows enriched with at least one Claude value.
    """
    settings = get_settings()
    if not settings.stocvest_news_impact_weighting_enabled or not isinstance(rows, list):
        return 0

    candidates: list[tuple[dict[str, Any], str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = _row_key(row)
        if key:
            candidates.append((row, key))
    if not candidates:
        return 0

    try:
        from stocvest.utils.redis_client import get_sync_redis

        r = get_sync_redis()
        if r is None:
            return 0
        values = r.mget([key for _, key in candidates])
    except Exception as exc:  # noqa: BLE001 — read-through must never break scoring
        _LOG.debug("news impact cache read skipped: %s", exc)
        return 0

    enriched = 0
    for (row, _key), raw in zip(candidates, values or []):
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            continue
        got = False
        if "relevance" in data:
            try:
                row["claude_relevance"] = max(0.0, min(1.0, float(data["relevance"])))
                got = True
            except (TypeError, ValueError):
                pass
        if "impact" in data:
            try:
                row["claude_impact"] = max(0.0, min(1.0, float(data["impact"])))
                got = True
            except (TypeError, ValueError):
                pass
        if got:
            enriched += 1
    _LOG.info("news_impact_cache enrich candidates=%d hits=%d", len(candidates), enriched)
    return enriched


def _row_to_news_article(row: dict[str, Any]) -> Any | None:
    """Best-effort raw composite row → :class:`NewsArticle` for async scoring (``None`` if unusable)."""
    from stocvest.data.models import NewsArticle

    title = str(row.get("title") or "").strip()
    url = str(row.get("article_url") or row.get("url") or "").strip()
    if not title and not url:
        return None
    published = row.get("published_utc") or row.get("published_at") or datetime.now(timezone.utc)
    art_id = str(row.get("id") or "").strip() or (
        f"composite:{hashlib.sha1((url or title).encode('utf-8')).hexdigest()}"  # noqa: S324
    )
    try:
        return NewsArticle(
            article_id=art_id,
            published_at=published,
            title=title or url,
            url=url,
            source=str(row.get("source") or "") or None,
            description=str(row.get("description") or "").strip() or None,
            tickers=[str(t).strip().upper() for t in (row.get("tickers") or []) if str(t).strip()],
        )
    except Exception:  # noqa: BLE001 — malformed row must never break scoring
        return None


async def prime_missing_news_sentiment(rows: list[dict[str, Any]]) -> int:
    """Enqueue abstaining cache-*miss* articles to the triage queue for async Claude scoring.

    Closes the coverage gap where the composite reads Benzinga REST but the worker only
    ingested the WebSocket/EDGAR feeds: a missed headline gets scored out-of-band and
    becomes a cache *hit* on a later pass. Call **after**
    :func:`enrich_rows_with_cached_sentiment` so only true misses remain.

    Fully gated (``stocvest_news_sentiment_prime_enabled`` + the cache flag) and
    fail-open. Requires Redis (for per-article dedupe) and a triage queue URL; returns
    the number of articles enqueued.
    """
    settings = get_settings()
    if not (settings.stocvest_news_sentiment_prime_enabled and settings.stocvest_news_sentiment_cache_enabled):
        return 0
    if not isinstance(rows, list):
        return 0
    queue_url = settings.stocvest_news_triage_queue_url.strip()
    if not queue_url:
        return 0

    cap = max(1, int(settings.stocvest_news_sentiment_prime_max_per_pass))
    misses: list[tuple[dict[str, Any], str]] = []
    for row in rows:
        if not _needs_enrichment(row):
            continue
        key = _row_key(row)
        if key:
            misses.append((row, key))
        if len(misses) >= cap:
            break
    if not misses:
        return 0

    # Per-article pending markers prevent re-enqueuing the same headline every request
    # while it awaits scoring. Require Redis so we never spam the queue without dedupe.
    try:
        from stocvest.utils.redis_client import get_sync_redis

        r = get_sync_redis()
        if r is None:
            return 0
        ttl = max(60, int(settings.stocvest_news_sentiment_prime_pending_ttl_seconds))
        pipe = r.pipeline()
        for _row, key in misses:
            pipe.set(f"{key}:pending", "1", nx=True, ex=ttl)
        flags = pipe.execute()
    except Exception as exc:  # noqa: BLE001 — dedupe failure must never break scoring
        _LOG.debug("news sentiment prime dedupe skipped: %s", exc)
        return 0

    fresh = [(row, key) for (row, key), ok in zip(misses, flags or []) if ok]
    entries: list[dict[str, str]] = []
    fresh_keys: list[str] = []
    for idx, (row, key) in enumerate(fresh):
        article = _row_to_news_article(row)
        if article is None:
            continue
        entries.append({"Id": str(idx), "MessageBody": article.model_dump_json()})
        fresh_keys.append(key)
    if not entries:
        return 0

    try:
        import boto3

        sqs = boto3.client("sqs", region_name=settings.aws_region)
        await asyncio.to_thread(sqs.send_message_batch, QueueUrl=queue_url, Entries=entries)
    except Exception as exc:  # noqa: BLE001 — enqueue is best-effort; never break scoring
        _LOG.debug("news sentiment prime enqueue skipped: %s", exc)
        # Release pending markers so a later pass can retry instead of waiting out the TTL.
        try:
            r.delete(*[f"{k}:pending" for k in fresh_keys])
        except Exception:  # noqa: BLE001
            pass
        return 0

    _LOG.info("news_sentiment_cache prime enqueued=%d", len(entries))
    _emit_cache_metrics(PrimeEnqueued=len(entries))
    return len(entries)
