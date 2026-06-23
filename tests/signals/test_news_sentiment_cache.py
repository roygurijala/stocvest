"""B71 Phase D — read-through Claude sentiment cache (content key, fail-open, flag-gated)."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

import stocvest.signals.news_sentiment_cache as nsc
import stocvest.utils.redis_client as redis_client


def _settings(
    enabled: bool = True,
    *,
    prime_enabled: bool = False,
    queue_url: str = "https://sqs.local/triage",
    impact_enabled: bool = False,
):
    return SimpleNamespace(
        stocvest_news_sentiment_cache_enabled=enabled,
        stocvest_news_sentiment_cache_key_prefix="stocvest:news_sent:",
        stocvest_news_sentiment_cache_ttl_seconds=518400,
        stocvest_news_sentiment_prime_enabled=prime_enabled,
        stocvest_news_sentiment_prime_pending_ttl_seconds=21600,
        stocvest_news_sentiment_prime_max_per_pass=10,
        stocvest_news_triage_queue_url=queue_url,
        stocvest_news_impact_weighting_enabled=impact_enabled,
        aws_region="us-east-1",
    )


class _FakePipeline:
    def __init__(self, parent: "_FakeRedis") -> None:
        self._parent = parent
        self._ops: list[tuple[str, str]] = []

    def set(self, key, value, nx=False, ex=None):  # noqa: ANN001, ARG002
        self._ops.append((key, value))
        return self

    def execute(self):
        results = []
        for key, value in self._ops:
            if key in self._parent.store:
                results.append(False)
            else:
                self._parent.store[key] = value
                results.append(True)
        self._ops = []
        return results


class _FakeRedis:
    def __init__(self, store: dict[str, str] | None = None) -> None:
        self.store = dict(store or {})
        self.setex_calls: list[tuple[str, int, str]] = []
        self.deleted: list[str] = []

    def setex(self, key, ttl, value):  # noqa: ANN001
        self.setex_calls.append((key, ttl, value))
        self.store[key] = value

    def mget(self, keys):  # noqa: ANN001
        return [self.store.get(k) for k in keys]

    def pipeline(self):
        return _FakePipeline(self)

    def delete(self, *keys):  # noqa: ANN001
        for k in keys:
            self.deleted.append(k)
            self.store.pop(k, None)


class _FakeSqs:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.batches: list[list[dict[str, str]]] = []

    def send_message_batch(self, *, QueueUrl, Entries):  # noqa: ANN001, N803
        if self.fail:
            raise RuntimeError("sqs boom")
        self.batches.append(Entries)
        return {"Successful": [{"Id": e["Id"]} for e in Entries]}


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(nsc, "get_settings", lambda: _settings(True))


# ── content key ───────────────────────────────────────────────────────────────


@pytest.mark.unit
def test_key_prefers_url_and_is_scheme_query_insensitive(enabled):
    k1 = nsc.sentiment_cache_key(url="https://x.com/a/Story?utm=1", title="Some Title")
    k2 = nsc.sentiment_cache_key(url="http://x.com/a/story/", title="Different Title")
    assert k1 is not None and k1 == k2  # scheme/query/slash/case normalized; title ignored when URL present
    assert k1.startswith("stocvest:news_sent:")


@pytest.mark.unit
def test_key_falls_back_to_title_then_none(enabled):
    assert nsc.sentiment_cache_key(url=None, title="  Hello   World ") == nsc.sentiment_cache_key(
        url="", title="hello world"
    )
    assert nsc.sentiment_cache_key(url=None, title=None) is None


# ── write ─────────────────────────────────────────────────────────────────────


@pytest.mark.unit
def test_write_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(nsc, "get_settings", lambda: _settings(False))
    fake = _FakeRedis()
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    assert nsc.write_article_sentiment(url="https://x.com/a", title="t", sentiment="positive", score=0.8) is False
    assert fake.setex_calls == []


@pytest.mark.unit
def test_write_persists_with_ttl(enabled, monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    # Claude emits "bearish"; cache normalizes to canonical "negative".
    assert nsc.write_article_sentiment(url="https://x.com/a", title="t", sentiment="bearish", score=-0.6) is True
    assert len(fake.setex_calls) == 1
    key, ttl, payload = fake.setex_calls[0]
    assert key == nsc.sentiment_cache_key(url="https://x.com/a", title="t")
    assert ttl == 518400
    assert json.loads(payload) == {"sentiment": "negative", "score": -0.6}


@pytest.mark.unit
def test_write_normalizes_bullish_to_positive(enabled, monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    assert nsc.write_article_sentiment(url="https://x.com/z", title="z", sentiment="bullish", score=0.5) is True
    _, _, payload = fake.setex_calls[0]
    assert json.loads(payload)["sentiment"] == "positive"


@pytest.mark.unit
def test_write_rejects_invalid_label(enabled, monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    assert nsc.write_article_sentiment(url="https://x.com/a", title="t", sentiment="spicy", score=0.1) is False


# ── read-through enrich ─────────────────────────────────────────────────────────


@pytest.mark.unit
def test_enrich_fills_abstaining_row_on_cache_hit(enabled, monkeypatch):
    key = nsc.sentiment_cache_key(url="https://x.com/bz", title="Benzinga only")
    fake = _FakeRedis({key: json.dumps({"sentiment": "positive", "score": 0.7})})
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    rows = [{"title": "Benzinga only", "article_url": "https://x.com/bz", "insights": []}]
    n = nsc.enrich_rows_with_cached_sentiment(rows)
    assert n == 1
    assert rows[0]["sentiment"] == "positive"


@pytest.mark.unit
def test_enrich_skips_rows_with_insights_or_existing_sentiment(enabled, monkeypatch):
    key_b = nsc.sentiment_cache_key(url="https://x.com/b", title="b")
    fake = _FakeRedis({key_b: json.dumps({"sentiment": "negative", "score": -0.4})})
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    rows = [
        {"title": "a", "article_url": "https://x.com/a", "insights": [{"ticker": "AAA", "sentiment": "positive"}]},
        {"title": "c", "article_url": "https://x.com/c", "insights": [], "sentiment": "neutral"},
    ]
    n = nsc.enrich_rows_with_cached_sentiment(rows)
    assert n == 0
    assert rows[0].get("sentiment") is None  # had insights, untouched
    assert rows[1]["sentiment"] == "neutral"  # existing label preserved


@pytest.mark.unit
def test_enrich_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(nsc, "get_settings", lambda: _settings(False))
    fake = _FakeRedis({"whatever": json.dumps({"sentiment": "positive", "score": 1.0})})
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    rows = [{"title": "x", "article_url": "https://x.com/x", "insights": []}]
    assert nsc.enrich_rows_with_cached_sentiment(rows) == 0
    assert rows[0].get("sentiment") is None


@pytest.mark.unit
def test_enrich_fail_open_when_redis_unavailable(enabled, monkeypatch):
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: None)
    rows = [{"title": "x", "article_url": "https://x.com/x", "insights": []}]
    assert nsc.enrich_rows_with_cached_sentiment(rows) == 0
    assert rows[0].get("sentiment") is None


@pytest.mark.unit
def test_enrich_cache_miss_leaves_rows_untouched(enabled, monkeypatch):
    fake = _FakeRedis()  # empty store → MGET returns [None]
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    rows = [{"title": "x", "article_url": "https://x.com/x", "insights": []}]
    assert nsc.enrich_rows_with_cached_sentiment(rows) == 0
    assert rows[0].get("sentiment") is None


# ── relevance/impact persistence + read-through ─────────────────────────────────


@pytest.mark.unit
def test_write_persists_relevance_and_impact_when_provided(enabled, monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    assert nsc.write_article_sentiment(
        url="https://x.com/a", title="t", sentiment="bullish", score=0.5, relevance=0.9, impact=0.4
    ) is True
    _, _, payload = fake.setex_calls[0]
    body = json.loads(payload)
    assert body["relevance"] == 0.9 and body["impact"] == 0.4


@pytest.mark.unit
def test_impact_enrich_noop_when_flag_disabled(monkeypatch):
    # cache on, impact flag OFF → no Claude relevance/impact attached.
    monkeypatch.setattr(nsc, "get_settings", lambda: _settings(True, impact_enabled=False))
    key = nsc.sentiment_cache_key(url="https://x.com/a", title="a")
    fake = _FakeRedis({key: json.dumps({"sentiment": "positive", "score": 0.6, "relevance": 0.9, "impact": 0.3})})
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    rows = [{"title": "a", "article_url": "https://x.com/a"}]
    assert nsc.enrich_rows_with_cached_impact(rows) == 0
    assert "claude_relevance" not in rows[0]


@pytest.mark.unit
def test_impact_enrich_attaches_claude_values(monkeypatch):
    monkeypatch.setattr(nsc, "get_settings", lambda: _settings(True, impact_enabled=True))
    key = nsc.sentiment_cache_key(url="https://x.com/a", title="a")
    fake = _FakeRedis({key: json.dumps({"sentiment": "positive", "score": 0.6, "relevance": 0.9, "impact": 0.3})})
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    rows = [{"title": "a", "article_url": "https://x.com/a"}]
    assert nsc.enrich_rows_with_cached_impact(rows) == 1
    assert rows[0]["claude_relevance"] == 0.9
    assert rows[0]["claude_impact"] == 0.3


@pytest.mark.unit
def test_impact_enrich_ignores_polarity_only_entries(monkeypatch):
    # A legacy entry without relevance/impact must not attach Claude factors.
    monkeypatch.setattr(nsc, "get_settings", lambda: _settings(True, impact_enabled=True))
    key = nsc.sentiment_cache_key(url="https://x.com/a", title="a")
    fake = _FakeRedis({key: json.dumps({"sentiment": "positive", "score": 0.6})})
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    rows = [{"title": "a", "article_url": "https://x.com/a"}]
    assert nsc.enrich_rows_with_cached_impact(rows) == 0
    assert "claude_relevance" not in rows[0]


# ── self-prime (enqueue cache misses for async scoring) ─────────────────────────


def _prime_settings(monkeypatch, *, prime_enabled=True, cache_enabled=True, queue_url="https://sqs.local/triage"):
    monkeypatch.setattr(
        nsc,
        "get_settings",
        lambda: _settings(cache_enabled, prime_enabled=prime_enabled, queue_url=queue_url),
    )


@pytest.mark.unit
async def test_prime_noop_when_prime_disabled(monkeypatch):
    _prime_settings(monkeypatch, prime_enabled=False)
    fake = _FakeRedis()
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    rows = [{"title": "a", "article_url": "https://x.com/a", "insights": []}]
    assert await nsc.prime_missing_news_sentiment(rows) == 0


@pytest.mark.unit
async def test_prime_noop_when_cache_disabled(monkeypatch):
    _prime_settings(monkeypatch, prime_enabled=True, cache_enabled=False)
    rows = [{"title": "a", "article_url": "https://x.com/a", "insights": []}]
    assert await nsc.prime_missing_news_sentiment(rows) == 0


@pytest.mark.unit
async def test_prime_noop_when_no_queue_url(monkeypatch):
    _prime_settings(monkeypatch, queue_url="")
    rows = [{"title": "a", "article_url": "https://x.com/a", "insights": []}]
    assert await nsc.prime_missing_news_sentiment(rows) == 0


@pytest.mark.unit
async def test_prime_enqueues_misses_and_sets_pending(monkeypatch):
    _prime_settings(monkeypatch)
    fake = _FakeRedis()
    sqs = _FakeSqs()
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    monkeypatch.setattr("boto3.client", lambda *a, **k: sqs)
    rows = [
        {"id": "1", "title": "Benzinga A", "article_url": "https://x.com/a", "insights": []},
        {"id": "2", "title": "Benzinga B", "article_url": "https://x.com/b", "insights": []},
        {"title": "Has insight", "article_url": "https://x.com/c", "insights": [{"ticker": "AAA"}]},
    ]
    n = await nsc.prime_missing_news_sentiment(rows)
    assert n == 2
    assert len(sqs.batches) == 1 and len(sqs.batches[0]) == 2
    # Pending markers recorded for the two enqueued misses (not the insight row).
    assert sum(1 for k in fake.store if k.endswith(":pending")) == 2


@pytest.mark.unit
async def test_prime_dedupes_already_pending(monkeypatch):
    _prime_settings(monkeypatch)
    key = nsc.sentiment_cache_key(url="https://x.com/a", title="Benzinga A")
    fake = _FakeRedis({f"{key}:pending": "1"})  # already in-flight
    sqs = _FakeSqs()
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    monkeypatch.setattr("boto3.client", lambda *a, **k: sqs)
    rows = [{"id": "1", "title": "Benzinga A", "article_url": "https://x.com/a", "insights": []}]
    assert await nsc.prime_missing_news_sentiment(rows) == 0
    assert sqs.batches == []


@pytest.mark.unit
async def test_prime_fail_open_when_redis_unavailable(monkeypatch):
    _prime_settings(monkeypatch)
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: None)
    rows = [{"id": "1", "title": "a", "article_url": "https://x.com/a", "insights": []}]
    assert await nsc.prime_missing_news_sentiment(rows) == 0


# ── CloudWatch EMF metrics ──────────────────────────────────────────────────────


def _emf_lines(captured: str) -> list[dict]:
    out = []
    for line in captured.splitlines():
        line = line.strip()
        if line.startswith("{") and "_aws" in line:
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


@pytest.mark.unit
def test_emit_cache_metrics_emf_structure(capsys):
    nsc._emit_cache_metrics(CacheCandidates=3, CacheHits=1)
    emfs = _emf_lines(capsys.readouterr().out)
    assert len(emfs) == 1
    emf = emfs[0]
    block = emf["_aws"]["CloudWatchMetrics"][0]
    assert block["Namespace"] == "Stocvest/NewsSentimentCache"
    names = {m["Name"] for m in block["Metrics"]}
    assert names == {"CacheCandidates", "CacheHits"}
    assert emf["CacheCandidates"] == 3 and emf["CacheHits"] == 1


@pytest.mark.unit
def test_emit_cache_metrics_noop_when_empty(capsys):
    nsc._emit_cache_metrics()
    assert _emf_lines(capsys.readouterr().out) == []


@pytest.mark.unit
def test_enrich_emits_emf_metric(enabled, monkeypatch, capsys):
    key = nsc.sentiment_cache_key(url="https://x.com/bz", title="Benzinga only")
    fake = _FakeRedis({key: json.dumps({"sentiment": "positive", "score": 0.7})})
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    rows = [{"title": "Benzinga only", "article_url": "https://x.com/bz", "insights": []}]
    nsc.enrich_rows_with_cached_sentiment(rows)
    emfs = _emf_lines(capsys.readouterr().out)
    assert any(e.get("CacheHits") == 1 and e.get("CacheCandidates") == 1 for e in emfs)


@pytest.mark.unit
async def test_prime_releases_pending_on_sqs_failure(monkeypatch):
    _prime_settings(monkeypatch)
    fake = _FakeRedis()
    sqs = _FakeSqs(fail=True)
    monkeypatch.setattr(redis_client, "get_sync_redis", lambda: fake)
    monkeypatch.setattr("boto3.client", lambda *a, **k: sqs)
    rows = [{"id": "1", "title": "a", "article_url": "https://x.com/a", "insights": []}]
    assert await nsc.prime_missing_news_sentiment(rows) == 0
    # Marker released so a later pass can retry instead of waiting out the TTL.
    assert any(k.endswith(":pending") for k in fake.deleted)
    assert not any(k.endswith(":pending") for k in fake.store)
