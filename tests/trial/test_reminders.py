"""Trial reminder tick."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.services.user_profile_store import InMemoryUserProfileStore
from stocvest.data.models import UserProfile
from stocvest.trial.reminders import run_trial_reminder_tick
from stocvest.services.email_service import EmailService


class _FakeEmail(EmailService):
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send_trial_reminder_email(self, *, to_email: str, kind: str, days_remaining: int) -> bool:  # type: ignore[override]
        self.sent.append((kind, to_email))
        return True


@pytest.fixture(autouse=True)
def _flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAL_ENFORCEMENT_ENABLED", "true")
    monkeypatch.setenv("TRIAL_REMINDERS_ENABLED", "true")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()


def test_day10_reminder_sent_once() -> None:
    store = InMemoryUserProfileStore()
    ends = (datetime.now(timezone.utc) + timedelta(days=4)).isoformat()
    store.put_profile(
        UserProfile(
            user_id="u1",
            email="trial@example.com",
            phone_verified=True,
            trial_started_at=datetime.now(timezone.utc).isoformat(),
            trial_ends_at=ends,
        )
    )
    mail = _FakeEmail()
    r1 = run_trial_reminder_tick(store=store, email_service=mail)
    assert r1.day10_sent == 1
    assert mail.sent == [("day10", "trial@example.com")]
    r2 = run_trial_reminder_tick(store=store, email_service=mail)
    assert r2.day10_sent == 0


def test_reminders_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAL_REMINDERS_ENABLED", "false")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    store = InMemoryUserProfileStore()
    store.put_profile(UserProfile(user_id="u1", email="trial@example.com", phone_verified=True))
    mail = _FakeEmail()
    result = run_trial_reminder_tick(store=store, email_service=mail)
    assert result.scanned == 0
    assert mail.sent == []
