"""Handler dispatch tests for the `setup_read` type on
POST /v1/signals/ai/explanations (:func:`ai_explanations_handler`)."""

from __future__ import annotations

import json

import pytest

from stocvest.api.handlers.signals import ai_explanations_handler
from stocvest.data.models import UserProfile


def _event(*, body: dict | None, sub: str | None = "user-1") -> dict:
    request_context: dict = {"requestContext": {}}
    if sub is not None:
        request_context = {"requestContext": {"authorizer": {"claims": {"sub": sub}}}}
    return {**request_context, "headers": {}, "body": json.dumps(body) if body is not None else ""}


def _patch_profile(monkeypatch: pytest.MonkeyPatch, profile: UserProfile) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.get_user_profile_store",
        lambda: type("S", (), {"get_profile": staticmethod(lambda _uid: profile)})(),
    )


def test_setup_read_requires_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="free"))
    res = ai_explanations_handler(_event(body={"type": "setup_read"}), {})
    assert res["statusCode"] == 400


def test_setup_read_free_user_returns_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="free"))
    res = ai_explanations_handler(
        _event(
            body={
                "type": "setup_read",
                "symbol": "aapl",
                "direction": "long",
                "desk": "swing",
                "layers": [{"layer": "technical", "status": "Bullish"}],
                "fallback_text": "AAPL leans long on the swing desk — deterministic brief.",
            }
        ),
        {},
    )
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["source"] == "deterministic"
    assert body["upgrade_available"] is True
    assert body["text"] == "AAPL leans long on the swing desk — deterministic brief."


def test_setup_read_unknown_type_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="free"))
    res = ai_explanations_handler(_event(body={"type": "nope"}), {})
    assert res["statusCode"] == 400
