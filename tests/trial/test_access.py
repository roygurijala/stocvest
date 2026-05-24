"""Tests for trial access resolution."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.data.models import UserProfile
from stocvest.trial.access import resolve_access, trial_days_remaining


@pytest.fixture(autouse=True)
def _clear_trial_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "false")
    monkeypatch.setenv("PHONE_VERIFICATION_REQUIRED", "false")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()


def test_legacy_free_when_enforcement_off() -> None:
    profile = UserProfile(user_id="u1", subscription_plan="free")
    snap = resolve_access(profile)
    assert snap.access_state == "legacy_free"
    assert snap.has_full_access is False
    assert snap.trial_enforcement_enabled is False


def test_paid_always_full_access() -> None:
    profile = UserProfile(user_id="u1", subscription_plan="swing_pro")
    snap = resolve_access(profile)
    assert snap.access_state == "paid"
    assert snap.has_full_access is True


def test_trial_active_when_enforcement_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "true")
    monkeypatch.setenv("PHONE_VERIFICATION_REQUIRED", "true")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    ends = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
    profile = UserProfile(
        user_id="u1",
        phone_verified=True,
        trial_ends_at=ends,
        trial_started_at=datetime.now(timezone.utc).isoformat(),
    )
    snap = resolve_access(profile)
    assert snap.access_state == "trial_active"
    assert snap.has_full_access is True
    assert snap.trial_days_remaining is not None
    assert snap.trial_days_remaining >= 9


def test_phone_required_before_verify(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "true")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    snap = resolve_access(UserProfile(user_id="u1"))
    assert snap.access_state == "phone_required"
    assert snap.has_full_access is False


def test_trial_expired(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "true")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    ends = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    profile = UserProfile(user_id="u1", phone_verified=True, trial_ends_at=ends)
    snap = resolve_access(profile)
    assert snap.access_state == "trial_expired"
    assert snap.has_full_access is False
    assert snap.trial_days_remaining == 0


def test_trial_days_remaining_none_without_end() -> None:
    assert trial_days_remaining(UserProfile(user_id="u1")) is None
