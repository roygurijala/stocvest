"""AI explanation service: paid vs free, model id, caching."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from stocvest.data.models import NewsArticle, UserProfile
from stocvest.signals.ai_explanations import AIExplanationService, news_articles_from_payload, reset_ai_explanation_caches_for_tests
from stocvest.utils.config import AI_MODEL_FAST


@pytest.fixture(autouse=True)
def _clear_ai_cache() -> None:
    reset_ai_explanation_caches_for_tests()
    yield
    reset_ai_explanation_caches_for_tests()


@pytest.mark.asyncio
async def test_free_user_gets_deterministic_copy(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(*args: object, **kwargs: object) -> str | None:
        raise AssertionError("Claude must not be called for free users")

    monkeypatch.setattr(AIExplanationService, "_claude_text_or_none", boom)
    svc = AIExplanationService()
    u = UserProfile(user_id="u", subscription_plan="free")
    r = await svc.explain_signal_capture(
        symbol="AAPL",
        score=72,
        verdict="bullish",
        top_layers=[{"layer": "technical", "status": "Bullish", "score": 0.8}],
        risk_reward=2.1,
        user_profile=u,
    )
    assert r.source == "deterministic"
    assert r.upgrade_available is True
    assert "72/100" not in r.text
    assert "multi-layer agreement" in r.text
    assert r.cached is False


@pytest.mark.asyncio
async def test_paid_user_gets_ai_explanation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    async def fake_claude(
        self: AIExplanationService,
        *,
        system: str,
        user_prompt: str,
        max_tokens: int,
    ) -> str | None:
        return "First sentence qualifies the setup. Second sentence adds context. Signal data only."

    monkeypatch.setattr(AIExplanationService, "_claude_text_or_none", fake_claude)
    svc = AIExplanationService()
    u = UserProfile(user_id="u", subscription_plan="swing_pro")
    r = await svc.explain_signal_capture(
        symbol="AAPL",
        score=80,
        verdict="bullish",
        top_layers=[{"layer": "news", "status": "Bullish", "score": 0.5}],
        risk_reward=2.4,
        user_profile=u,
    )
    assert r.source == "ai"
    assert r.upgrade_available is False
    assert "First sentence" in r.text


@pytest.mark.asyncio
async def test_ai_uses_fast_model(monkeypatch: pytest.MonkeyPatch) -> None:
    import stocvest.signals.ai_explanations as mod

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(mod, "await_claude_api_slot", AsyncMock())

    bodies: list[dict] = []

    class ClientStub:
        def __init__(self, *a: object, **kw: object) -> None:
            pass

        async def __aenter__(self) -> ClientStub:
            return self

        async def __aexit__(self, *a: object) -> bool:
            return False

        async def post(self, url: str, headers: object = None, json: dict | None = None) -> object:
            bodies.append(json or {})
            class Resp:
                status_code = 200

                def json(self) -> dict:
                    return {"content": [{"text": "One. Two. Signal data only."}]}

            return Resp()

    monkeypatch.setattr(mod.httpx, "AsyncClient", ClientStub)

    svc = AIExplanationService()
    u = UserProfile(user_id="u", subscription_plan="swing_pro")
    r = await svc.explain_signal_capture(
        symbol="MSFT",
        score=65,
        verdict="bearish",
        top_layers=[],
        risk_reward=1.8,
        user_profile=u,
    )
    assert r.source == "ai"
    assert bodies and bodies[0].get("model") == AI_MODEL_FAST


@pytest.mark.asyncio
async def test_explanation_cached_on_second_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    calls = {"n": 0}

    async def counting_claude(
        self: AIExplanationService,
        *,
        system: str,
        user_prompt: str,
        max_tokens: int,
    ) -> str | None:
        calls["n"] += 1
        return f"Call {calls['n']}. Second. Signal data only."

    monkeypatch.setattr(AIExplanationService, "_claude_text_or_none", counting_claude)
    svc = AIExplanationService()
    u = UserProfile(user_id="u", subscription_plan="swing_day_pro")
    kwargs = dict(
        symbol="NVDA",
        score=55,
        verdict="neutral",
        top_layers=[{"layer": "macro", "status": "Neutral", "score": 0.0}],
        risk_reward=2.0,
        user_profile=u,
    )
    first = await svc.explain_signal_capture(**kwargs)
    second = await svc.explain_signal_capture(**kwargs)
    assert calls["n"] == 1
    assert first.cached is False
    assert second.cached is True
    assert first.text == second.text


@pytest.mark.asyncio
async def test_news_synthesis_free_user_deterministic(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(*args: object, **kwargs: object) -> str | None:
        raise AssertionError("no claude")

    monkeypatch.setattr(AIExplanationService, "_claude_text_or_none", boom)
    svc = AIExplanationService()
    u = UserProfile(user_id="u", subscription_plan="free")
    arts = [
        NewsArticle(
            article_id="1",
            published_at=__import__("datetime").datetime.now(tz=__import__("datetime").timezone.utc),
            title="Test headline",
            url="https://example.com",
        )
    ]
    r = await svc.explain_news_synthesis(symbol="AAPL", articles=arts, verdict="bullish", user_profile=u)
    assert r.source == "deterministic"
    assert r.upgrade_available is True
    assert "1 news articles" in r.text


@pytest.mark.asyncio
async def test_news_synthesis_paid_user_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")

    async def fake(
        self: AIExplanationService,
        *,
        system: str,
        user_prompt: str,
        max_tokens: int,
    ) -> str | None:
        return "News summary one. News two. Signal data only."

    monkeypatch.setattr(AIExplanationService, "_claude_text_or_none", fake)
    svc = AIExplanationService()
    u = UserProfile(user_id="u", subscription_plan="swing_pro")
    arts = [
        NewsArticle(
            article_id="1",
            published_at=__import__("datetime").datetime.now(tz=__import__("datetime").timezone.utc),
            title="Headline A",
            url="https://a.com",
        )
    ]
    r = await svc.explain_news_synthesis(symbol="AAPL", articles=arts, verdict="bullish", user_profile=u)
    assert r.source == "ai"
    assert "News summary" in r.text


@pytest.mark.asyncio
async def test_news_synthesis_empty_articles_paid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")

    async def boom(*args: object, **kwargs: object) -> str | None:
        raise AssertionError("no headlines")

    monkeypatch.setattr(AIExplanationService, "_claude_text_or_none", boom)
    svc = AIExplanationService()
    u = UserProfile(user_id="u", subscription_plan="swing_pro")
    r = await svc.explain_news_synthesis(symbol="AAPL", articles=[], verdict="bullish", user_profile=u)
    low = r.text.lower()
    assert any(
        phrase in low
        for phrase in (
            "qualifying news",
            "material news",
            "company-specific catalysts",
            "lookback",
            "filtered feed",
        )
    )
    assert r.source == "deterministic"


def test_news_articles_from_payload_minimal() -> None:
    raw = [{"title": "Hello", "id": "x1", "published_at": "2026-01-15T12:00:00Z", "sentiment_score": 0.5}]
    arts = news_articles_from_payload(raw)
    assert len(arts) == 1
    assert arts[0].title == "Hello"
