"""Resolve trial access state for API responses and enforcement gates."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Literal

from stocvest.data.models import UserProfile
from stocvest.utils.config import get_settings

AccessState = Literal[
    "legacy_free",
    "phone_required",
    "trial_active",
    "trial_expired",
    "paid",
    "beta",
]


@dataclass(frozen=True)
class AccessSnapshot:
    access_state: AccessState
    has_full_access: bool
    has_ai_explanations: bool
    trial_days_remaining: int | None
    phone_verified: bool
    trial_started_at: str | None
    trial_ends_at: str | None
    phone_last4: str | None
    trial_enforcement_enabled: bool


def _parse_iso(raw: str | None) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def trial_days_remaining(profile: UserProfile, *, now: datetime | None = None) -> int | None:
    ends = _parse_iso(profile.trial_ends_at)
    if ends is None:
        return None
    ref = now or datetime.now(timezone.utc)
    if ref >= ends:
        return 0
    return max(0, math.ceil((ends - ref).total_seconds() / 86400.0))


def resolve_access(profile: UserProfile, *, is_admin: bool = False) -> AccessSnapshot:
    settings = get_settings()
    enforcement = bool(settings.trial_enforcement_enabled)
    days = trial_days_remaining(profile) if profile.trial_ends_at else None

    def _snap(
        *,
        access_state: AccessState,
        has_full: bool,
        has_ai: bool,
        days_remaining: int | None = days,
    ) -> AccessSnapshot:
        return AccessSnapshot(
            access_state=access_state,
            has_full_access=has_full,
            has_ai_explanations=has_ai,
            trial_days_remaining=days_remaining,
            phone_verified=profile.phone_verified,
            trial_started_at=profile.trial_started_at,
            trial_ends_at=profile.trial_ends_at,
            phone_last4=profile.phone_last4,
            trial_enforcement_enabled=enforcement,
        )

    if is_admin:
        return _snap(access_state="legacy_free", has_full=True, has_ai=True)

    if profile.is_paid:
        return _snap(access_state="paid", has_full=True, has_ai=True)

    if profile.beta_access_active:
        return _snap(access_state="beta", has_full=True, has_ai=True, days_remaining=None)

    if not enforcement:
        return _snap(
            access_state="legacy_free",
            has_full=profile.has_full_access,
            has_ai=profile.has_ai_explanations,
        )

    if not profile.phone_verified:
        return _snap(access_state="phone_required", has_full=False, has_ai=False, days_remaining=None)

    if profile.trial_active:
        return _snap(access_state="trial_active", has_full=True, has_ai=True)

    return _snap(access_state="trial_expired", has_full=False, has_ai=False, days_remaining=0)
