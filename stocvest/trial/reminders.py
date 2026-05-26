"""Day-10 and day-14 trial reminder emails (SES)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from stocvest.api.services.user_profile_store import UserProfileStore, get_user_profile_store
from stocvest.data.models import UserProfile
from stocvest.services.email_service import EmailService
from stocvest.trial.access import resolve_access, trial_days_remaining
from stocvest.trial.user_directory import iter_user_profiles, resolve_user_email
from stocvest.utils.config import get_settings
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

ReminderKind = Literal["day10", "day14"]


@dataclass(frozen=True)
class TrialReminderTickResult:
    scanned: int
    day10_sent: int
    day14_sent: int
    skipped_no_email: int
    errors: int


def _should_send_day10(profile: UserProfile, *, days: int | None) -> bool:
    if profile.trial_reminder_day10_sent_at:
        return False
    return days == 4


def _should_send_day14(profile: UserProfile, *, days: int | None) -> bool:
    if profile.trial_reminder_day14_sent_at:
        return False
    return days is not None and days <= 0


def run_trial_reminder_tick(
    *,
    store: UserProfileStore | None = None,
    email_service: EmailService | None = None,
    now: datetime | None = None,
) -> TrialReminderTickResult:
    settings = get_settings()
    if not settings.trial_reminders_enabled:
        _LOG.info("trial_reminder_tick_skipped TRIAL_REMINDERS_ENABLED=false")
        return TrialReminderTickResult(0, 0, 0, 0, 0)

    s = store or get_user_profile_store()
    mailer = email_service or EmailService()
    ref = now or datetime.now(timezone.utc)
    scanned = day10 = day14 = skipped = errors = 0

    for profile in iter_user_profiles(s):
        scanned += 1
        snap = resolve_access(profile, is_admin=False)
        if snap.access_state != "trial_active":
            continue
        if not profile.phone_verified:
            continue

        days = trial_days_remaining(profile, now=ref)
        email = resolve_user_email(profile)
        if not email:
            skipped += 1
            continue

        try:
            if _should_send_day10(profile, days=days):
                ok = mailer.send_trial_reminder_email(
                    to_email=email,
                    kind="day10",
                    days_remaining=days or 4,
                )
                if ok:
                    _mark_sent(s, profile, kind="day10", now=ref)
                    day10 += 1
                else:
                    errors += 1
            elif _should_send_day14(profile, days=days):
                ok = mailer.send_trial_reminder_email(
                    to_email=email,
                    kind="day14",
                    days_remaining=0,
                )
                if ok:
                    _mark_sent(s, profile, kind="day14", now=ref)
                    day14 += 1
                else:
                    errors += 1
        except Exception:
            _LOG.exception("trial_reminder_failed user=%s", user_ref_for_logs(profile.user_id))
            errors += 1

    _LOG.info(
        "trial_reminder_tick scanned=%s day10=%s day14=%s skipped_no_email=%s errors=%s",
        scanned,
        day10,
        day14,
        skipped,
        errors,
    )
    return TrialReminderTickResult(scanned, day10, day14, skipped, errors)


def _mark_sent(store: UserProfileStore, profile: UserProfile, *, kind: ReminderKind, now: datetime) -> None:
    iso = now.isoformat()
    if kind == "day10":
        merged = profile.model_copy(update={"trial_reminder_day10_sent_at": iso})
    else:
        merged = profile.model_copy(update={"trial_reminder_day14_sent_at": iso})
    store.put_profile(merged)
