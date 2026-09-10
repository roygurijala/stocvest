"""Handler tests for POST /v1/signals/position/research (ADR-004 POS-AI-4)."""

from __future__ import annotations

import json

import pytest

from stocvest.api.handlers import signals as h
from stocvest.api.handlers.signals import position_research_handler
from stocvest.api.services.position_research import (
    PositionResearchBundle,
    RecentDevelopments,
)
from stocvest.data.edgar_10k import TenKRiskExcerpt
from stocvest.data.models import UserProfile

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


def test_unauthenticated_rejected() -> None:
    res = position_research_handler(_event(body={"symbol": "AAPL"}, sub=None), {})
    assert res["statusCode"] == 401


def test_requires_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="swing_day_pro"))
    res = position_research_handler(_event(body={}), {})
    assert res["statusCode"] == 400


def test_ok_bundle_serialized(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="swing_day_pro"))

    async def _fake_bundle(*, symbol: str, user_profile, company_name=None):
        assert symbol == "AAPL"
        assert company_name == "Apple Inc"
        return PositionResearchBundle(
            symbol="AAPL",
            status="ok",
            recent_developments=RecentDevelopments(
                summary="Record services revenue.", key_points=["Buyback up"], sources=[]
            ),
            risk_factors=TenKRiskExcerpt(
                symbol="AAPL",
                excerpt="Supply chain risk.",
                source_url="https://www.sec.gov/x",
                filing_date="2025-10-30",
                form="10-K",
                truncated=False,
            ),
        )

    monkeypatch.setattr(h, "build_position_research_bundle", _fake_bundle)
    res = position_research_handler(
        _event(body={"symbol": "aapl", "company_name": "Apple Inc"}), {}
    )
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["status"] == "ok"
    assert body["risk_factors"]["scored"] is False
    assert body["recent_developments"]["scored"] is False
    assert "not part of the STOCVEST signal" in body["disclaimer"]


def test_disabled_status_passthrough(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_profile(monkeypatch, UserProfile(user_id="u", subscription_plan="swing_day_pro"))

    async def _fake_bundle(*, symbol: str, user_profile, company_name=None):
        return PositionResearchBundle(symbol=symbol, status="disabled")

    monkeypatch.setattr(h, "build_position_research_bundle", _fake_bundle)
    res = position_research_handler(_event(body={"symbol": "AAPL"}), {})
    assert res["statusCode"] == 200
    assert json.loads(res["body"])["status"] == "disabled"
