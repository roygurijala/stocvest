"""Lock-in tests for admin user-management HTTP handlers.

Five routes under ``/v1/admin/users``:

* ``GET    /search`` — Cognito email-prefix search.
* ``GET    /{user_id}`` — Cognito + UserProfile + groups detail.
* ``POST   /{user_id}/reset-password`` — Cognito ``AdminResetUserPassword``.
* ``POST   /{user_id}/groups/{group}`` — add to whitelisted group.
* ``DELETE /{user_id}/groups/{group}`` — remove from whitelisted group.

Every test asserts:

* The admin gate is enforced (403 without ``analysis_authorized``).
* Cognito ``Username`` (the email) is forwarded — never the ``sub``,
  because the password / group APIs require the username verbatim.
* The whitelisted group list rejects unrelated groups even when the
  caller is an admin.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

from stocvest.api.handlers.admin_users import (
    admin_users_add_group_handler,
    admin_users_detail_handler,
    admin_users_remove_group_handler,
    admin_users_reset_password_handler,
    admin_users_search_handler,
)
from stocvest.api.services.admin_user_directory import (
    ADMIN_COGNITO_GROUP,
    AdminUserDetail,
    CognitoUserRecord,
)
from stocvest.data.models import UserProfile


def _evt(
    *,
    method: str = "GET",
    path: str = "/v1/admin/users/search",
    path_params: dict[str, str] | None = None,
    query_params: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    user_id: str = "admin-sub-1",
) -> dict[str, Any]:
    return {
        "path": path,
        "pathParameters": dict(path_params) if path_params else None,
        "queryStringParameters": dict(query_params) if query_params else None,
        "requestContext": {
            "requestId": "req-test",
            "http": {"method": method, "path": path},
            "authorizer": {"claims": {"sub": user_id}},
        },
        "headers": {"x-stocvest-session-id": "sess-1"},
        "body": json.dumps(body) if body is not None else None,
    }


def _cog_rec(*, sub: str = "sub-1", email: str = "alice@x.com") -> CognitoUserRecord:
    return CognitoUserRecord(
        sub=sub,
        username=email,
        email=email,
        email_verified=True,
        status="CONFIRMED",
        enabled=True,
        created_at="2026-05-01T00:00:00",
        updated_at="2026-05-02T00:00:00",
    )


def _detail(*, sub: str = "sub-1", email: str = "alice@x.com", admin: bool = False) -> AdminUserDetail:
    return AdminUserDetail(
        cognito=_cog_rec(sub=sub, email=email),
        profile=UserProfile(user_id=sub, email=email),
        groups=[ADMIN_COGNITO_GROUP] if admin else [],
    )


@pytest.fixture(autouse=True)
def _silence_audit() -> Any:
    with patch("stocvest.api.handlers.admin_users.get_audit_store") as m:
        m.return_value.put_event.return_value = None
        yield m


# ── 403 gate (applies to every handler) ─────────────────────────────────


@pytest.mark.parametrize(
    "handler,event",
    [
        (admin_users_search_handler, _evt(query_params={"q": "a"})),
        (
            admin_users_detail_handler,
            _evt(path_params={"user_id": "sub-1"}),
        ),
        (
            admin_users_reset_password_handler,
            _evt(method="POST", path_params={"user_id": "sub-1"}),
        ),
        (
            admin_users_add_group_handler,
            _evt(
                method="POST",
                path_params={"user_id": "sub-1", "group": ADMIN_COGNITO_GROUP},
            ),
        ),
        (
            admin_users_remove_group_handler,
            _evt(
                method="DELETE",
                path_params={"user_id": "sub-1", "group": ADMIN_COGNITO_GROUP},
            ),
        ),
    ],
)
def test_handlers_return_403_without_admin_auth(handler: Any, event: dict[str, Any]) -> None:
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=False
    ):
        response = handler(event, None)
    assert response["statusCode"] == 403


# ── search ──────────────────────────────────────────────────────────────


def test_search_handler_returns_items() -> None:
    from stocvest.api.services.admin_user_directory import UserSearchPage

    event = _evt(query_params={"q": "alice", "limit": "10"})
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.list_users_page",
        return_value=UserSearchPage(
            records=[_cog_rec(sub="sub-1", email="alice@x.com")],
            next_token=None,
        ),
    ) as m:
        response = admin_users_search_handler(event, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["query"] == "alice"
    assert body["limit"] == 10
    assert body["items"][0]["user_id"] == "sub-1"
    assert body["items"][0]["email"] == "alice@x.com"
    assert body["next_token"] is None
    m.assert_called_once()


def test_search_handler_empty_query_returns_full_listing() -> None:
    """No ``q`` ⇒ list every user in the pool (paginated), don't 400.

    Previously the handler required a ``q`` param. The Admin Users page
    contract is "show all users by default; if more than 25, paginate"
    so a bare ``GET /v1/admin/users/search`` is now the canonical
    landing call.
    """
    from stocvest.api.services.admin_user_directory import UserSearchPage

    event = _evt(query_params=None)
    fake_records = [
        _cog_rec(sub=f"sub-{i}", email=f"user{i}@x.com") for i in range(3)
    ]
    captured: dict[str, Any] = {}

    def _fake_page(query: str, *, limit: int, page_token: str | None = None) -> UserSearchPage:
        captured["query"] = query
        captured["limit"] = limit
        captured["page_token"] = page_token
        return UserSearchPage(records=fake_records, next_token="tok-next")

    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.list_users_page",
        side_effect=_fake_page,
    ):
        response = admin_users_search_handler(event, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["query"] == ""
    assert len(body["items"]) == 3
    # The opaque token from Cognito is round-tripped to the client so
    # the UI can request the next page.
    assert body["next_token"] == "tok-next"
    # And the handler forwarded the empty query + no page_token.
    assert captured["query"] == ""
    assert captured["page_token"] is None


def test_search_handler_forwards_page_token() -> None:
    from stocvest.api.services.admin_user_directory import UserSearchPage

    event = _evt(query_params={"page_token": "tok-from-prev"})
    captured: dict[str, Any] = {}

    def _fake_page(query: str, *, limit: int, page_token: str | None = None) -> UserSearchPage:
        captured["page_token"] = page_token
        return UserSearchPage(records=[], next_token=None)

    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.list_users_page",
        side_effect=_fake_page,
    ):
        response = admin_users_search_handler(event, None)
    assert response["statusCode"] == 200
    assert captured["page_token"] == "tok-from-prev"


def test_search_handler_rejects_non_integer_limit() -> None:
    event = _evt(query_params={"q": "a", "limit": "abc"})
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ):
        response = admin_users_search_handler(event, None)
    assert response["statusCode"] == 400


# ── detail ──────────────────────────────────────────────────────────────


def test_detail_handler_returns_composed_payload() -> None:
    event = _evt(path_params={"user_id": "sub-1"})
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.get_user_detail",
        return_value=_detail(admin=True),
    ):
        response = admin_users_detail_handler(event, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["user_id"] == "sub-1"
    assert body["is_admin"] is True
    assert body["groups"] == [ADMIN_COGNITO_GROUP]
    assert body["profile"]["has_full_access"] is True  # bumped by admin


def test_detail_handler_404_when_user_missing() -> None:
    event = _evt(path_params={"user_id": "sub-missing"})
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.get_user_detail", return_value=None
    ):
        response = admin_users_detail_handler(event, None)
    assert response["statusCode"] == 404


def test_detail_handler_400_for_blank_user_id() -> None:
    event = _evt(path_params={"user_id": "  "})
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ):
        response = admin_users_detail_handler(event, None)
    assert response["statusCode"] == 400


# ── reset-password ──────────────────────────────────────────────────────


def test_reset_password_handler_calls_cognito_with_username() -> None:
    """The Cognito call must use the email-shaped ``username``, NOT the sub."""
    event = _evt(
        method="POST",
        path="/v1/admin/users/sub-1/reset-password",
        path_params={"user_id": "sub-1"},
    )
    cognito_client = type(
        "C", (), {"admin_reset_user_password": lambda self, **kw: None}
    )()
    captured: dict[str, Any] = {}

    def _fake_reset(**kwargs: Any) -> None:
        captured.update(kwargs)

    cognito_client.admin_reset_user_password = _fake_reset  # type: ignore[assignment]

    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.get_user_detail",
        return_value=_detail(sub="sub-1", email="alice@x.com"),
    ), patch(
        "stocvest.api.handlers.admin_users._build_cognito_client",
        return_value=cognito_client,
    ), patch(
        "stocvest.api.handlers.admin_users.get_settings"
    ) as m_settings:
        m_settings.return_value.cognito_user_pool_id = "us-east-1_TEST"
        response = admin_users_reset_password_handler(event, None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["user_id"] == "sub-1"
    assert body["username"] == "alice@x.com"
    assert captured["Username"] == "alice@x.com"  # NOT "sub-1"


def test_reset_password_handler_404_when_user_missing() -> None:
    event = _evt(
        method="POST",
        path_params={"user_id": "sub-missing"},
    )
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.get_user_detail", return_value=None
    ):
        response = admin_users_reset_password_handler(event, None)
    assert response["statusCode"] == 404


def test_reset_password_handler_500_when_cognito_unconfigured() -> None:
    event = _evt(method="POST", path_params={"user_id": "sub-1"})
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.get_user_detail",
        return_value=_detail(),
    ), patch(
        "stocvest.api.handlers.admin_users._build_cognito_client", return_value=None
    ):
        response = admin_users_reset_password_handler(event, None)
    assert response["statusCode"] == 500


# ── groups ──────────────────────────────────────────────────────────────


def test_add_group_handler_rejects_non_whitelisted_group() -> None:
    """Defense in depth: even with admin auth, only whitelisted groups
    can be assigned via this endpoint."""
    event = _evt(
        method="POST",
        path_params={"user_id": "sub-1", "group": "cognito-idp-admin"},
    )
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ):
        response = admin_users_add_group_handler(event, None)
    assert response["statusCode"] == 400
    body = json.loads(response["body"])
    assert "assignable" in body["message"].lower()


def test_add_group_handler_calls_cognito_with_username_and_group() -> None:
    event = _evt(
        method="POST",
        path_params={"user_id": "sub-1", "group": ADMIN_COGNITO_GROUP},
    )
    captured: dict[str, Any] = {}

    class _C:
        def admin_add_user_to_group(self, **kwargs: Any) -> None:
            captured.update(kwargs)

    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.get_user_detail",
        side_effect=[
            _detail(sub="sub-1", email="alice@x.com"),
            _detail(sub="sub-1", email="alice@x.com", admin=True),
        ],
    ), patch(
        "stocvest.api.handlers.admin_users._build_cognito_client",
        return_value=_C(),
    ), patch(
        "stocvest.api.handlers.admin_users.get_settings"
    ) as m_settings:
        m_settings.return_value.cognito_user_pool_id = "us-east-1_TEST"
        response = admin_users_add_group_handler(event, None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["action"] == "add"
    assert body["group"] == ADMIN_COGNITO_GROUP
    assert body["is_admin"] is True
    assert captured["Username"] == "alice@x.com"
    assert captured["GroupName"] == ADMIN_COGNITO_GROUP


def test_remove_group_handler_calls_admin_remove() -> None:
    event = _evt(
        method="DELETE",
        path_params={"user_id": "sub-1", "group": ADMIN_COGNITO_GROUP},
    )
    captured: dict[str, Any] = {}

    class _C:
        def admin_remove_user_from_group(self, **kwargs: Any) -> None:
            captured.update(kwargs)

    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.get_user_detail",
        side_effect=[
            _detail(sub="sub-1", email="alice@x.com", admin=True),
            _detail(sub="sub-1", email="alice@x.com", admin=False),
        ],
    ), patch(
        "stocvest.api.handlers.admin_users._build_cognito_client",
        return_value=_C(),
    ), patch(
        "stocvest.api.handlers.admin_users.get_settings"
    ) as m_settings:
        m_settings.return_value.cognito_user_pool_id = "us-east-1_TEST"
        response = admin_users_remove_group_handler(event, None)

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["action"] == "remove"
    assert body["is_admin"] is False
    assert captured["GroupName"] == ADMIN_COGNITO_GROUP


def test_group_handler_404_when_user_missing() -> None:
    event = _evt(
        method="POST",
        path_params={"user_id": "sub-missing", "group": ADMIN_COGNITO_GROUP},
    )
    with patch(
        "stocvest.api.handlers.admin_users.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_users.get_user_detail", return_value=None
    ):
        response = admin_users_add_group_handler(event, None)
    assert response["statusCode"] == 404
