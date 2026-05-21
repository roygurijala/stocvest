"""Plan-based watchlist symbol caps."""

from __future__ import annotations

from stocvest.api.services.watchlist_plan_limits import (
    WATCHLIST_SYMBOL_CAP_FREE,
    WATCHLIST_SYMBOL_CAP_SWING_DAY_PRO,
    WATCHLIST_SYMBOL_CAP_SWING_PRO,
    watchlist_symbol_cap_for_profile,
    watchlist_symbol_limit_message,
)
from stocvest.data.models import UserProfile


def test_free_cap() -> None:
    p = UserProfile(user_id="u1", subscription_plan="free")
    assert watchlist_symbol_cap_for_profile(p) == WATCHLIST_SYMBOL_CAP_FREE == 5


def test_swing_pro_cap() -> None:
    p = UserProfile(user_id="u1", subscription_plan="swing_pro")
    assert watchlist_symbol_cap_for_profile(p) == WATCHLIST_SYMBOL_CAP_SWING_PRO == 50


def test_swing_day_pro_cap() -> None:
    p = UserProfile(user_id="u1", subscription_plan="swing_day_pro")
    assert watchlist_symbol_cap_for_profile(p) == WATCHLIST_SYMBOL_CAP_SWING_DAY_PRO == 100


def test_beta_full_access_uses_top_tier() -> None:
    p = UserProfile(
        user_id="u1",
        subscription_plan="free",
        beta_full_access=True,
        beta_access_until="2099-01-01T00:00:00+00:00",
    )
    assert p.beta_access_active is True
    assert watchlist_symbol_cap_for_profile(p) == 100


def test_limit_message_includes_cap() -> None:
    assert "5" in watchlist_symbol_limit_message(5)
