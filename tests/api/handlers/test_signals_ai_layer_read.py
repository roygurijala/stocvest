"""Handler + service tests for the `layer_read` explanation type
(deep-dive "Explain this layer"): POST /v1/signals/ai/explanations."""

from __future__ import annotations

import json

import pytest

from stocvest.api.handlers.signals import ai_explanations_handler
from stocvest.data.models import UserProfile
from stocvest.signals.ai_explanations import (
    AIExplanationService,
    reset_ai_explanation_caches_for_tests,
)

pytestmark = pytest.mark.unit


def _event(*, body: dict | None, sub: str | None = "user-1") -> dict:
    rc: dict = {"requestContext": {}}
    if sub is not None:
        rc = {"requestContext": {"authorizer": {"claims": {"sub": sub}}}}
    return {**rc, "headers": {}, "body": json.dumps(body) if body is not None else ""}


def _patch_profile(monkeypatch: pytest.MonkeyPatch, profile: UserProfile) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.get_user_profile_store",
        lambda: type("S", (), {"get_profile": staticmethod(lambda _uid: profile)})(),
    )


def _layer() -> dict:
    return {
        "key": "technical",
        "name": "Technical",
        "verdict": "bullish",
        "score": 84,
        "rationale": "At 84/100 the layer clears its ≥60 bullish cutoff, so it reads bullish.",
        "drivers": ["Price above rising SMA50/200", "RSI 61 not overbought", "RVOL 1.4x"],
    }


def test_requires_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="free"))
    res = ai_explanations_handler(_event(body={"type": "layer_read", "layer": _layer()}), {})
    assert res["statusCode"] == 400


def test_requires_layer_key(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="free"))
    res = ai_explanations_handler(
        _event(body={"type": "layer_read", "symbol": "AAPL", "layer": {"name": "Technical"}}), {}
    )
    assert res["statusCode"] == 400


def test_free_user_gets_deterministic_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_ai_explanation_caches_for_tests()
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="free"))
    res = ai_explanations_handler(
        _event(
            body={
                "type": "layer_read",
                "symbol": "aapl",
                "desk": "position",
                "bias": "bullish",
                "fallback_text": "At 84/100 the layer clears its ≥60 bullish cutoff. Signal data only.",
                "layer": _layer(),
            }
        ),
        {},
    )
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["source"] == "deterministic"
    assert body["upgrade_available"] is True
    # Free users always get the client's verbatim fallback text.
    assert body["text"] == "At 84/100 the layer clears its ≥60 bullish cutoff. Signal data only."


def test_unauthenticated_rejected() -> None:
    res = ai_explanations_handler(
        _event(body={"type": "layer_read", "symbol": "AAPL", "layer": _layer()}, sub=None), {}
    )
    assert res["statusCode"] == 401


@pytest.mark.asyncio
async def test_service_free_never_calls_claude(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_ai_explanation_caches_for_tests()
    svc = AIExplanationService()

    async def _boom(**_kw):
        raise AssertionError("Claude must not be called for free users")

    monkeypatch.setattr(svc, "_claude_text_or_none", _boom)
    layer = _layer()
    result = await svc.explain_layer_read(
        symbol="AAPL",
        layer_key=layer["key"],
        layer_name=layer["name"],
        desk="swing",
        bias="bullish",
        verdict=layer["verdict"],
        score=layer["score"],
        rationale=layer["rationale"],
        drivers=layer["drivers"],
        fallback_text="",
        user_profile=UserProfile(user_id="u", subscription_plan="free"),
    )
    assert result.source == "deterministic"
    assert result.upgrade_available is True
    assert result.text.endswith("Signal data only.")


@pytest.mark.asyncio
async def test_service_paid_uses_claude_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_ai_explanation_caches_for_tests()
    svc = AIExplanationService()
    calls = {"n": 0}

    async def _fake_claude(**_kw):
        calls["n"] += 1
        return "The trend layer is firmly constructive, led by the moving-average stack. Signal data only."

    monkeypatch.setattr(svc, "_claude_text_or_none", _fake_claude)
    layer = _layer()
    kwargs = dict(
        symbol="AAPL",
        layer_key=layer["key"],
        layer_name=layer["name"],
        desk="swing",
        bias="bullish",
        verdict=layer["verdict"],
        score=layer["score"],
        rationale=layer["rationale"],
        drivers=layer["drivers"],
        fallback_text="",
        user_profile=UserProfile(user_id="u", subscription_plan="pro", beta_full_access=True),
    )
    first = await svc.explain_layer_read(**kwargs)
    assert first.source == "ai"
    assert first.upgrade_available is False
    second = await svc.explain_layer_read(**kwargs)
    assert second.cached is True
    assert calls["n"] == 1  # second call served from cache


@pytest.mark.asyncio
async def test_service_falls_back_when_claude_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_ai_explanation_caches_for_tests()
    svc = AIExplanationService()

    async def _none(**_kw):
        return None

    monkeypatch.setattr(svc, "_claude_text_or_none", _none)
    layer = _layer()
    result = await svc.explain_layer_read(
        symbol="AAPL",
        layer_key=layer["key"],
        layer_name=layer["name"],
        desk="swing",
        bias="bullish",
        verdict=layer["verdict"],
        score=layer["score"],
        rationale=layer["rationale"],
        drivers=layer["drivers"],
        fallback_text="",
        user_profile=UserProfile(user_id="u", subscription_plan="pro", beta_full_access=True),
    )
    assert result.source == "deterministic"
    assert result.text.endswith("Signal data only.")
    assert "Drivers:" in result.text
