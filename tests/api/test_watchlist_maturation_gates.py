"""Unit tests for ``watchlist_maturation_gates``."""

from __future__ import annotations

from stocvest.api.services.watchlist_maturation_gates import maturation_summary_include_readiness_label
from stocvest.data.models import UserProfile


def test_gate_paid_swing_day_pro() -> None:
    p = UserProfile(user_id="u", subscription_plan="swing_day_pro")
    assert maturation_summary_include_readiness_label(p) is True


def test_gate_paid_swing_pro() -> None:
    p = UserProfile(user_id="u", subscription_plan="swing_pro")
    assert maturation_summary_include_readiness_label(p) is True


def test_gate_free() -> None:
    p = UserProfile(user_id="u", subscription_plan="free")
    assert maturation_summary_include_readiness_label(p) is False


def test_gate_beta_access_active_overrides_free() -> None:
    p = UserProfile(
        user_id="u",
        subscription_plan="free",
        beta_full_access=True,
        beta_access_until=None,
    )
    assert maturation_summary_include_readiness_label(p) is True
