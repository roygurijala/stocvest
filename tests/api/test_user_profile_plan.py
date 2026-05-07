"""UserProfile subscription_plan + has_ai_explanations (paid AI feature gate)."""

from __future__ import annotations

import pytest

from stocvest.data.models import UserProfile


def test_subscription_plan_defaults_to_free() -> None:
    p = UserProfile(user_id="u1")
    assert p.subscription_plan == "free"


def test_is_paid_false_for_free() -> None:
    assert UserProfile(user_id="u", subscription_plan="free").is_paid is False


def test_is_paid_true_for_swing_pro() -> None:
    assert UserProfile(user_id="u", subscription_plan="swing_pro").is_paid is True


def test_has_ai_explanations_false_for_free() -> None:
    assert UserProfile(user_id="u", subscription_plan="free").has_ai_explanations is False


def test_has_ai_explanations_true_for_swing_pro() -> None:
    assert UserProfile(user_id="u", subscription_plan="swing_pro").has_ai_explanations is True


def test_has_ai_explanations_true_for_swing_day_pro() -> None:
    assert UserProfile(user_id="u", subscription_plan="swing_day_pro").has_ai_explanations is True


def test_beta_full_access_enables_full_access_for_free_user() -> None:
    p = UserProfile(user_id="u", subscription_plan="free", beta_full_access=True)
    assert p.is_paid is False
    assert p.beta_access_active is True
    assert p.has_full_access is True
    assert p.has_ai_explanations is True


def test_beta_access_expired_disables_override() -> None:
    p = UserProfile(
        user_id="u",
        subscription_plan="free",
        beta_full_access=True,
        beta_access_until="2000-01-01T00:00:00+00:00",
    )
    assert p.beta_access_active is False
    assert p.has_full_access is False
    assert p.has_ai_explanations is False


def test_invalid_subscription_plan_coerced_to_free() -> None:
    p = UserProfile(user_id="u", subscription_plan="enterprise")
    assert p.subscription_plan == "free"
