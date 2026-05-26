"""User profile iteration skips OTP/ledger keys."""

from __future__ import annotations

from stocvest.api.services.user_profile_store import InMemoryUserProfileStore
from stocvest.data.models import UserProfile
from stocvest.trial.user_directory import iter_user_profiles


def test_iter_skips_auxiliary_keys() -> None:
    store = InMemoryUserProfileStore()
    store.put_profile(UserProfile(user_id="real-user"))
    store.put_profile(UserProfile(user_id="PHONE_LEDGER#abc"))
    store.put_profile(UserProfile(user_id="sub#PHONE_OTP"))
    ids = {p.user_id for p in iter_user_profiles(store)}
    assert ids == {"real-user"}
