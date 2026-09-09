"""Handler + service tests for the `position_setup_read` explanation type
(POS-AI-2): POST /v1/signals/ai/explanations."""

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


def _packet() -> dict:
    return {
        "bull_case": [{"text": "Profitability & quality (F1): strong at 82/100.", "source": "F1", "confidence": "high"}],
        "bear_case": [{"text": "Weakest pillar: Valuation (F4) at 48/100 — the first thing to watch.", "source": "F4", "confidence": "medium"}],
        "open_questions": [{"text": "Is the entry price attractive for a long hold?", "source": "F4", "confidence": "medium"}],
        "pillar_snapshot_hash": "abc123def456",
    }


def test_requires_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="free"))
    res = ai_explanations_handler(_event(body={"type": "position_setup_read"}), {})
    assert res["statusCode"] == 400


def test_free_user_gets_deterministic_from_packet(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_ai_explanation_caches_for_tests()
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="free"))
    res = ai_explanations_handler(
        _event(body={"type": "position_setup_read", "symbol": "aapl", "verdict": "bullish", "packet": _packet()}),
        {},
    )
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["source"] == "deterministic"
    assert body["upgrade_available"] is True
    assert body["text"].startswith("On the Position desk")
    assert "Bull:" in body["text"] and "Watch:" in body["text"]
    assert body["text"].endswith("Signal data only.")


def test_unauthenticated_rejected() -> None:
    res = ai_explanations_handler(_event(body={"type": "position_setup_read", "symbol": "AAPL"}, sub=None), {})
    assert res["statusCode"] == 401


@pytest.mark.asyncio
async def test_service_free_never_calls_claude(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_ai_explanation_caches_for_tests()
    svc = AIExplanationService()

    async def _boom(**_kw):
        raise AssertionError("Claude must not be called for free users")

    monkeypatch.setattr(svc, "_claude_text_or_none", _boom)
    p = _packet()
    result = await svc.explain_position_setup_read(
        symbol="MSFT",
        verdict="bullish",
        bull_case=p["bull_case"],
        bear_case=p["bear_case"],
        open_questions=p["open_questions"],
        pillar_snapshot_hash=p["pillar_snapshot_hash"],
        user_profile=UserProfile(user_id="u", subscription_plan="free"),
    )
    assert result.source == "deterministic"
    assert result.upgrade_available is True
    assert "MSFT" in result.text


@pytest.mark.asyncio
async def test_service_paid_uses_claude_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_ai_explanation_caches_for_tests()
    svc = AIExplanationService()
    calls = {"n": 0}

    async def _fake_claude(**_kw):
        calls["n"] += 1
        return "MSFT is a durable compounder on the Position desk; watch valuation (F4). Signal data only."

    monkeypatch.setattr(svc, "_claude_text_or_none", _fake_claude)
    p = _packet()
    kwargs = dict(
        symbol="MSFT",
        verdict="bullish",
        bull_case=p["bull_case"],
        bear_case=p["bear_case"],
        open_questions=p["open_questions"],
        pillar_snapshot_hash=p["pillar_snapshot_hash"],
        user_profile=UserProfile(user_id="u", subscription_plan="pro", beta_full_access=True),
    )
    first = await svc.explain_position_setup_read(**kwargs)
    assert first.source == "ai"
    assert first.upgrade_available is False
    second = await svc.explain_position_setup_read(**kwargs)
    assert second.cached is True
    assert calls["n"] == 1  # served from cache the second time


@pytest.mark.asyncio
async def test_service_falls_back_when_claude_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_ai_explanation_caches_for_tests()
    svc = AIExplanationService()

    async def _none(**_kw):
        return None

    monkeypatch.setattr(svc, "_claude_text_or_none", _none)
    p = _packet()
    result = await svc.explain_position_setup_read(
        symbol="MSFT",
        verdict="bullish",
        bull_case=p["bull_case"],
        bear_case=p["bear_case"],
        open_questions=p["open_questions"],
        pillar_snapshot_hash=p["pillar_snapshot_hash"],
        user_profile=UserProfile(user_id="u", subscription_plan="pro", beta_full_access=True),
    )
    assert result.source == "deterministic"
    assert result.text.endswith("Signal data only.")
