"""Iterate real user profiles for scheduled trial jobs."""

from __future__ import annotations

from typing import Any, Iterator, Protocol

from stocvest.api.services.user_profile_store import (
    DynamoDBUserProfileStore,
    InMemoryUserProfileStore,
    UserProfileStore,
    get_user_profile_store,
    item_to_profile,
)
from stocvest.data.models import UserProfile


def _is_user_profile_key(user_id: str) -> bool:
    uid = (user_id or "").strip()
    if not uid:
        return False
    if uid.startswith("PHONE_LEDGER#"):
        return False
    if "#PHONE_OTP" in uid:
        return False
    return True


def iter_user_profiles(store: UserProfileStore | None = None) -> Iterator[UserProfile]:
    """Yield UserProfile rows, skipping OTP sessions and phone ledger keys."""
    s = store or get_user_profile_store()
    if isinstance(s, InMemoryUserProfileStore):
        for uid, profile in s._profiles.items():
            if _is_user_profile_key(uid):
                yield profile
        return
    if isinstance(s, DynamoDBUserProfileStore):
        last_key: dict[str, Any] | None = None
        while True:
            kwargs: dict[str, Any] = {}
            if last_key:
                kwargs["ExclusiveStartKey"] = last_key
            resp = s.table.scan(**kwargs)
            for item in resp.get("Items") or []:
                if not isinstance(item, dict):
                    continue
                uid = str(item.get(s.user_key) or item.get("userId") or "").strip()
                if not _is_user_profile_key(uid):
                    continue
                yield item_to_profile(uid, item)
            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                break
        return
    raise TypeError(f"Unsupported user profile store: {type(s)!r}")


class CognitoEmailLookup(Protocol):
    def get_email_for_sub(self, user_id: str) -> str | None: ...


def resolve_user_email(profile: UserProfile, *, lookup: CognitoEmailLookup | None = None) -> str | None:
    email = (profile.email or "").strip()
    if email:
        return email
    if lookup is None:
        from stocvest.trial.cognito_email import DefaultCognitoEmailLookup

        lookup = DefaultCognitoEmailLookup()
    return lookup.get_email_for_sub(profile.user_id)
