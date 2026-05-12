"""Unit tests for :mod:`stocvest.api.services.admin_user_directory`.

The directory service is a thin composition layer over Cognito + DDB.
These tests use a fake Cognito client to pin:

* Search emits the right ``ListUsers`` filter expression.
* Search caps at ``MAX_SEARCH_LIMIT`` regardless of caller input.
* ``get_user_detail`` joins Cognito + ``UserProfile`` + groups into one
  payload with ``is_admin`` correctly derived from group membership.
* Missing pool id (dev/test env) returns empty / ``None`` instead of
  raising — the admin hub UI must keep rendering.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from stocvest.api.services.admin_user_directory import (
    ADMIN_COGNITO_GROUP,
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT,
    AdminUserDetail,
    get_user_detail,
    list_groups_for_user,
    search_users,
)
from stocvest.api.services.user_profile_store import (
    InMemoryUserProfileStore,
    reset_user_profile_store_for_tests,
)
from stocvest.data.models import TradingMode, UserProfile


@dataclass
class _FakeCognito:
    """Records call kwargs + returns canned payloads."""

    list_users_payload: dict[str, Any]
    list_groups_payload: dict[str, Any] | None = None
    list_users_calls: list[dict[str, Any]] | None = None
    list_groups_calls: list[dict[str, Any]] | None = None

    def __post_init__(self) -> None:
        self.list_users_calls = []
        self.list_groups_calls = []

    def list_users(self, **kwargs: Any) -> dict[str, Any]:
        assert self.list_users_calls is not None
        self.list_users_calls.append(dict(kwargs))
        return self.list_users_payload

    def admin_list_groups_for_user(self, **kwargs: Any) -> dict[str, Any]:
        assert self.list_groups_calls is not None
        self.list_groups_calls.append(dict(kwargs))
        return self.list_groups_payload or {"Groups": []}


def _cog_user(*, sub: str, email: str, username: str | None = None, status: str = "CONFIRMED") -> dict[str, Any]:
    return {
        "Username": username or email,
        "UserStatus": status,
        "Enabled": True,
        "UserCreateDate": "2026-05-01T00:00:00",
        "UserLastModifiedDate": "2026-05-02T00:00:00",
        "Attributes": [
            {"Name": "sub", "Value": sub},
            {"Name": "email", "Value": email},
            {"Name": "email_verified", "Value": "true"},
        ],
    }


@pytest.fixture(autouse=True)
def _wire_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default to a configured Cognito pool so the search helpers run."""
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_TEST")
    monkeypatch.setenv("COGNITO_REGION", "us-east-1")
    from stocvest.utils import config as cfg

    cfg.get_settings.cache_clear()  # type: ignore[attr-defined]
    yield
    cfg.get_settings.cache_clear()  # type: ignore[attr-defined]


@pytest.fixture(autouse=True)
def _reset_profile_store() -> None:
    reset_user_profile_store_for_tests()
    yield
    reset_user_profile_store_for_tests()


# ── search_users ────────────────────────────────────────────────────────


def test_search_users_returns_records_sorted_by_email() -> None:
    cog = _FakeCognito(
        list_users_payload={
            "Users": [
                _cog_user(sub="sub-b", email="bob@example.com"),
                _cog_user(sub="sub-a", email="alice@example.com"),
            ]
        }
    )
    rows = search_users("a", client=cog)
    assert [r.email for r in rows] == ["alice@example.com", "bob@example.com"]
    assert rows[0].sub == "sub-a"
    assert cog.list_users_calls is not None
    assert cog.list_users_calls[0]["Filter"] == 'email ^= "a"'
    assert cog.list_users_calls[0]["Limit"] == DEFAULT_SEARCH_LIMIT


def test_search_users_empty_query_returns_empty() -> None:
    cog = _FakeCognito(list_users_payload={"Users": []})
    assert search_users("", client=cog) == []
    assert search_users("   ", client=cog) == []
    assert cog.list_users_calls == []


def test_search_users_caps_limit() -> None:
    cog = _FakeCognito(list_users_payload={"Users": []})
    search_users("a", limit=10_000, client=cog)
    assert cog.list_users_calls is not None
    assert cog.list_users_calls[0]["Limit"] == MAX_SEARCH_LIMIT


def test_search_users_returns_empty_when_pool_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("COGNITO_USER_POOL_ID", raising=False)
    from stocvest.utils import config as cfg

    cfg.get_settings.cache_clear()  # type: ignore[attr-defined]
    cog = _FakeCognito(list_users_payload={"Users": [_cog_user(sub="s", email="e@x")]})
    assert search_users("a", client=cog) == []
    # No call made — short-circuit before hitting the client.
    assert cog.list_users_calls == []


def test_search_users_skips_records_without_sub() -> None:
    cog = _FakeCognito(
        list_users_payload={
            "Users": [
                {"Username": "x", "Attributes": [{"Name": "email", "Value": "x@x.com"}]},
                _cog_user(sub="sub-ok", email="ok@x.com"),
            ]
        }
    )
    rows = search_users("o", client=cog)
    assert len(rows) == 1
    assert rows[0].sub == "sub-ok"


# ── list_groups_for_user ────────────────────────────────────────────────


def test_list_groups_returns_unique_sorted_names() -> None:
    cog = _FakeCognito(
        list_users_payload={},
        list_groups_payload={
            "Groups": [
                {"GroupName": "signal-analytics-admin"},
                {"GroupName": "beta-testers"},
                {"GroupName": "signal-analytics-admin"},  # dupes filtered
            ]
        },
    )
    groups = list_groups_for_user("alice@x.com", client=cog)
    assert groups == ["beta-testers", "signal-analytics-admin"]


def test_list_groups_empty_for_blank_username() -> None:
    cog = _FakeCognito(list_users_payload={}, list_groups_payload={"Groups": []})
    assert list_groups_for_user("", client=cog) == []


# ── get_user_detail ─────────────────────────────────────────────────────


def test_get_user_detail_composes_cognito_profile_groups(monkeypatch: pytest.MonkeyPatch) -> None:
    """The composed payload includes ``is_admin`` derived from group membership."""
    cog = _FakeCognito(
        list_users_payload={"Users": [_cog_user(sub="sub-1", email="alice@x.com")]},
        list_groups_payload={"Groups": [{"GroupName": ADMIN_COGNITO_GROUP}]},
    )

    profile = UserProfile(
        user_id="sub-1",
        email="alice@x.com",
        trading_mode=TradingMode.LIVE,
        subscription_plan="swing_pro",
    )
    store = InMemoryUserProfileStore()
    store.put_profile(profile)

    import stocvest.api.services.admin_user_directory as mod

    monkeypatch.setattr(mod, "get_user_profile_store", lambda: store)

    detail = get_user_detail("sub-1", client=cog)
    assert isinstance(detail, AdminUserDetail)
    assert detail.cognito.sub == "sub-1"
    assert detail.is_admin is True
    payload = detail.to_dict()
    assert payload["is_admin"] is True
    assert payload["groups"] == [ADMIN_COGNITO_GROUP]
    assert payload["profile"]["has_full_access"] is True
    assert payload["profile"]["subscription_plan"] == "swing_pro"


def test_get_user_detail_returns_none_when_cognito_user_missing() -> None:
    cog = _FakeCognito(list_users_payload={"Users": []})
    assert get_user_detail("sub-missing", client=cog) is None


def test_get_user_detail_blank_user_id_returns_none() -> None:
    cog = _FakeCognito(list_users_payload={})
    assert get_user_detail("", client=cog) is None
    assert get_user_detail("   ", client=cog) is None
