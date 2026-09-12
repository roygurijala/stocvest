from __future__ import annotations

from datetime import datetime, timezone

import pytest

import stocvest.api.handlers.portfolio_review as handler_mod
from stocvest.api.handlers.portfolio_review import (
    portfolio_review_dispatch_handler,
    portfolio_review_handler,
)
from stocvest.api.services.holdings_store import (
    get_holdings_store,
    reset_holdings_store_for_tests,
)
from stocvest.api.services.portfolio_review import (
    HoldingReview,
    PortfolioReview,
    ReviewAction,
)
from stocvest.models.portfolio_holding import (
    HoldingLot,
    PortfolioHolding,
    PortfolioSettings,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _fresh_store():
    reset_holdings_store_for_tests()
    yield
    reset_holdings_store_for_tests()


def _event(user_sub: str | None, **extra):
    claims = {"sub": user_sub} if user_sub else {}
    event = {"requestContext": {"authorizer": {"claims": claims}}}
    event.update(extra)
    return event


def _seed_holding(user_id: str) -> None:
    store = get_holdings_store()
    store.upsert_holding(
        user_id,
        PortfolioHolding(
            symbol="AAPL",
            lots=(HoldingLot(lot_id="l1", quantity=10, cost_basis=100.0, purchase_date="2024-01-02"),),
        ),
    )
    store.save_settings(user_id, PortfolioSettings(cash_balance=500.0, target_position_pct=25.0))


def _stub_review() -> PortfolioReview:
    return PortfolioReview(
        generated_at=datetime(2026, 9, 11, tzinfo=timezone.utc),
        holdings=[
            HoldingReview(
                symbol="AAPL", quantity=10, average_cost=100.0, current_price=120.0,
                market_value=1200.0, unrealized_pl=200.0, unrealized_pl_pct=20.0,
                weight_pct=70.6, verdict="bullish", confidence=0.7,
                action=ReviewAction.HOLD, rationale=["Long-Term composite reads bullish."],
                overweight=True,
            )
        ],
        total_market_value=1700.0,
        invested_value=1200.0,
        cash_balance=500.0,
        total_cost=1000.0,
        unrealized_pl=200.0,
        unrealized_pl_pct=20.0,
    )


def test_review_requires_auth():
    resp = portfolio_review_handler(_event(None), {})
    assert resp["statusCode"] == 401


def test_review_returns_payload(monkeypatch):
    _seed_holding("u-pr-1")
    captured: dict = {}

    async def _fake_build(*, holdings, settings, user_id, user_email, ai_read_fn=None):
        captured["holdings"] = holdings
        captured["settings"] = settings
        captured["user_id"] = user_id
        return _stub_review()

    monkeypatch.setattr(handler_mod, "build_portfolio_review", _fake_build)

    resp = portfolio_review_handler(_event("u-pr-1"), {})
    assert resp["statusCode"] == 200

    import json

    body = json.loads(resp["body"])
    assert body["holdings"][0]["symbol"] == "AAPL"
    assert body["holdings"][0]["action"] == "hold"
    assert body["totalMarketValue"] == 1700.0
    assert body["disclaimer"]

    # Handler loaded the caller's own holdings + settings from the store.
    assert captured["user_id"] == "u-pr-1"
    assert [h.symbol for h in captured["holdings"]] == ["AAPL"]
    assert captured["settings"].cash_balance == 500.0
    assert captured["settings"].target_position_pct == 25.0


def test_dispatch_routes_get(monkeypatch):
    _seed_holding("u-pr-2")

    async def _fake_build(*, holdings, settings, user_id, user_email, ai_read_fn=None):
        return _stub_review()

    monkeypatch.setattr(handler_mod, "build_portfolio_review", _fake_build)

    event = _event(
        "u-pr-2",
        requestContext={
            "authorizer": {"claims": {"sub": "u-pr-2"}},
            "http": {"method": "GET", "path": "/v1/portfolio-review"},
        },
        rawPath="/v1/portfolio-review",
    )
    resp = portfolio_review_dispatch_handler(event, {})
    assert resp["statusCode"] == 200


class _Profile:
    def __init__(self, ai: bool):
        self.has_ai_explanations = ai


class _FakeStore:
    def __init__(self, profile):
        self._profile = profile

    def get_profile(self, _user_id):
        return self._profile


def test_ai_read_fn_none_for_free_user(monkeypatch):
    monkeypatch.setattr(handler_mod, "get_user_profile_store", lambda: _FakeStore(_Profile(False)))
    assert handler_mod._build_ai_read_fn("u-free") is None


def test_ai_read_fn_none_when_no_profile(monkeypatch):
    monkeypatch.setattr(handler_mod, "get_user_profile_store", lambda: _FakeStore(None))
    assert handler_mod._build_ai_read_fn("u-missing") is None


def test_ai_read_fn_narrates_for_paid_user(monkeypatch):
    import asyncio

    monkeypatch.setattr(handler_mod, "get_user_profile_store", lambda: _FakeStore(_Profile(True)))

    class _Result:
        text = "F1 profitability is strong; watch F4 valuation. Signal data only."

    class _FakeSvc:
        async def explain_position_setup_read(self, **kwargs):
            assert kwargs["symbol"] == "AAPL"
            assert kwargs["verdict"] == "bullish"
            return _Result()

    import stocvest.signals.ai_explanations as ai_mod

    monkeypatch.setattr(ai_mod, "AIExplanationService", _FakeSvc)

    fn = handler_mod._build_ai_read_fn("u-paid")
    assert fn is not None
    body = {
        "signal_summary": "bullish",
        "position_thesis_packet": {
            "bull_case": [{"text": "high ROIC"}],
            "bear_case": [],
            "open_questions": [],
            "pillar_snapshot_hash": "abc123",
            "fundamentals_covered": True,
        },
    }
    text = asyncio.run(fn("AAPL", body))
    assert "Signal data only" in text


def test_dispatch_unknown_route():
    event = _event(
        "u-pr-3",
        requestContext={
            "authorizer": {"claims": {"sub": "u-pr-3"}},
            "http": {"method": "POST", "path": "/v1/portfolio-review/nope"},
        },
        rawPath="/v1/portfolio-review/nope",
    )
    resp = portfolio_review_dispatch_handler(event, {})
    assert resp["statusCode"] == 404
