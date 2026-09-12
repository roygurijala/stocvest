"""Unit tests for the daily post-close portfolio digest worker (offline)."""

from __future__ import annotations

from datetime import date

import pytest

from stocvest.api.services.holdings_store import InMemoryHoldingsStore
from stocvest.api.services.user_profile_store import InMemoryUserProfileStore
from stocvest.data.alert_store import InMemoryAlertStore
from stocvest.data.models import AlertPreferences, UserProfile
from stocvest.models.portfolio_holding import HoldingLot, PortfolioHolding
from stocvest.utils.config import get_settings
from stocvest.workers.portfolio_digest import run_portfolio_digest_tick

pytestmark = pytest.mark.unit


class _Mailer:
    def __init__(self) -> None:
        self.sent: list[tuple[str, dict]] = []

    def send_portfolio_digest_email(self, *, to_email: str, review: dict) -> bool:
        self.sent.append((to_email, review))
        return True


def _holding(symbol: str = "AAPL") -> PortfolioHolding:
    return PortfolioHolding(
        symbol=symbol,
        lots=(HoldingLot(lot_id="l1", quantity=10, cost_basis=100.0, purchase_date=date(2020, 1, 1)),),
    )


def _stub_review(**_kwargs) -> dict:
    return {"holdings": [], "totalMarketValue": 0.0, "unrealizedPlPct": None, "disclaimer": "x"}


@pytest.fixture(autouse=True)
def _enable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORTFOLIO_DIGEST_ENABLED", "true")
    get_settings.cache_clear()
    # Keep email resolution offline (never hit Cognito) — read the profile email directly.
    monkeypatch.setattr(
        "stocvest.workers.portfolio_digest.resolve_user_email",
        lambda profile: (profile.email or "").strip() or None,
    )
    yield
    get_settings.cache_clear()


def _stores(opted_in: bool = True, email: str | None = "u@example.com"):
    hstore = InMemoryHoldingsStore(_by_user={})
    hstore.upsert_holding("u1", _holding())
    astore = InMemoryAlertStore()
    astore.save_preferences(
        "u1", AlertPreferences(user_id="u1", email_enabled=opted_in, on_portfolio_digest=opted_in)
    )
    pstore = InMemoryUserProfileStore()
    pstore.put_profile(UserProfile(user_id="u1", email=email))
    return hstore, astore, pstore


def test_sends_for_opted_in_user() -> None:
    hstore, astore, pstore = _stores()
    mailer = _Mailer()
    result = run_portfolio_digest_tick(
        holdings_store=hstore,
        alert_store=astore,
        profile_store=pstore,
        email_service=mailer,
        review_builder=_stub_review,
    )
    assert result.scanned == 1
    assert result.sent == 1
    assert mailer.sent and mailer.sent[0][0] == "u@example.com"


def test_skips_not_opted_in() -> None:
    hstore, astore, pstore = _stores(opted_in=False)
    mailer = _Mailer()
    result = run_portfolio_digest_tick(
        holdings_store=hstore,
        alert_store=astore,
        profile_store=pstore,
        email_service=mailer,
        review_builder=_stub_review,
    )
    assert result.sent == 0
    assert result.skipped_not_opted_in == 1
    assert not mailer.sent


def test_skips_when_no_email() -> None:
    hstore, astore, pstore = _stores(email=None)
    mailer = _Mailer()
    result = run_portfolio_digest_tick(
        holdings_store=hstore,
        alert_store=astore,
        profile_store=pstore,
        email_service=mailer,
        review_builder=_stub_review,
    )
    assert result.sent == 0
    assert result.skipped_no_email == 1


def test_dispatch_routes_digest_tick(monkeypatch: pytest.MonkeyPatch) -> None:
    """lambda_handler on the portfolio_review module routes the tick to the worker."""
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "portfolio_review")
    monkeypatch.setenv("PORTFOLIO_DIGEST_ENABLED", "false")  # short-circuit → no store/network
    get_settings.cache_clear()

    from stocvest.api.lambda_dispatch import lambda_handler

    resp = lambda_handler({"portfolio_digest_tick": True}, {})
    assert resp["statusCode"] == 200
    assert resp["scanned"] == 0


def test_disabled_flag_short_circuits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORTFOLIO_DIGEST_ENABLED", "false")
    get_settings.cache_clear()
    hstore, astore, pstore = _stores()
    mailer = _Mailer()
    result = run_portfolio_digest_tick(
        holdings_store=hstore,
        alert_store=astore,
        profile_store=pstore,
        email_service=mailer,
        review_builder=_stub_review,
    )
    assert result.scanned == 0
    assert not mailer.sent


def test_personal_advice_mode_off_short_circuits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_PERSONAL_ADVICE_MODE_ENABLED", "false")
    get_settings.cache_clear()
    hstore, astore, pstore = _stores()
    mailer = _Mailer()
    result = run_portfolio_digest_tick(
        holdings_store=hstore,
        alert_store=astore,
        profile_store=pstore,
        email_service=mailer,
        review_builder=_stub_review,
    )
    assert result.scanned == 0
    assert not mailer.sent


def test_idempotent_marks_and_skips_second_run() -> None:
    from datetime import datetime, timezone

    hstore, astore, pstore = _stores()
    mailer = _Mailer()
    now = datetime(2026, 9, 11, 21, 5, tzinfo=timezone.utc)

    first = run_portfolio_digest_tick(
        holdings_store=hstore, alert_store=astore, profile_store=pstore,
        email_service=mailer, review_builder=_stub_review, now=now,
    )
    assert first.sent == 1
    # Marked with today's date so a retry/double-fire is skipped, not re-sent.
    assert pstore.get_profile("u1").last_portfolio_digest_date == "2026-09-11"

    second = run_portfolio_digest_tick(
        holdings_store=hstore, alert_store=astore, profile_store=pstore,
        email_service=mailer, review_builder=_stub_review, now=now,
    )
    assert second.sent == 0
    assert second.skipped_already_sent == 1
    assert len(mailer.sent) == 1  # no duplicate email
