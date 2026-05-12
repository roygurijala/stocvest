"""Composition layer over Cognito + ``UserProfile`` for the admin hub.

The Users DynamoDB table is keyed by ``userId`` (the Cognito ``sub``) with
**no email GSI**, so we cannot answer "find users matching foo@bar" from
DDB alone — Cognito is the source of truth for email <-> sub mapping.

This module wraps the two Cognito reads we need for the admin user-management
page and composes them with the DDB ``UserProfile`` row + group membership
so the handler layer stays straight-line:

* :func:`search_users` — ``cognito-idp:ListUsers`` with ``email ^= "<q>"``,
  capped to 25 hits to keep latency predictable.
* :func:`get_user_detail` — ``cognito-idp:ListUsers`` filtered by ``sub``,
  plus ``AdminListGroupsForUser`` and a DDB ``UserProfile`` read.

The handler layer maps these into HTTP responses. Cognito mutations
(reset-password, group add/remove) live in :mod:`stocvest.api.handlers.admin_users`
because they're one-line boto3 calls with no composition value.

All reads are **best-effort**: when Cognito is unconfigured (no pool id in
the environment, as in pytest), every function returns empty/``None``
rather than raising — same convention as ``parameter_history_store``.
That lets the admin hub render a friendly empty state in dev without a
fake Cognito stub.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.data.models import UserProfile
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

#: Cap on a single search response. Admins type more characters when they
#: don't see what they want — paginating would only complicate the UI.
DEFAULT_SEARCH_LIMIT = 25
MAX_SEARCH_LIMIT = 60

#: Group name that grants D10 admin authority. Mirrors
#: ``signal_analysis.analysis_authorized`` and the frontend
#: ``ADMIN_COGNITO_GROUP`` constant — all three MUST stay in lockstep.
ADMIN_COGNITO_GROUP = "signal-analytics-admin"

#: Whitelist of groups the admin UI is allowed to grant/revoke. Defense
#: in depth — even if a future endpoint sends a different group name,
#: the handler refuses. Add new admin-relevant groups here explicitly.
ASSIGNABLE_GROUPS: frozenset[str] = frozenset({ADMIN_COGNITO_GROUP})


@dataclass(frozen=True)
class CognitoUserRecord:
    """Subset of a Cognito user we surface to the admin hub.

    ``sub`` is the canonical id we use everywhere downstream (it's the
    JWT subject and the ``UserProfile`` partition key). ``username`` is
    the email Cognito was given at sign-up — kept separately because for
    historical accounts they could in principle drift, and the password
    reset / group APIs require the username verbatim.
    """

    sub: str
    username: str
    email: str
    email_verified: bool
    status: str
    enabled: bool
    created_at: str
    updated_at: str

    def to_summary_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.sub,
            "username": self.username,
            "email": self.email,
            "email_verified": self.email_verified,
            "status": self.status,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass(frozen=True)
class AdminUserDetail:
    """Full per-user payload returned by ``GET /v1/admin/users/{user_id}``."""

    cognito: CognitoUserRecord
    profile: UserProfile
    groups: list[str] = field(default_factory=list)

    @property
    def is_admin(self) -> bool:
        return ADMIN_COGNITO_GROUP in self.groups

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.cognito.to_summary_dict(),
            "groups": list(self.groups),
            "is_admin": self.is_admin,
            "profile": {
                "subscription_plan": self.profile.subscription_plan,
                "trading_mode": self.profile.trading_mode.value,
                "onboarding_completed": self.profile.onboarding_completed,
                "onboarding_completed_at": self.profile.onboarding_completed_at,
                "legal_acknowledged": self.profile.legal_acknowledged,
                "legal_acknowledged_at": self.profile.legal_acknowledged_at,
                "legal_acknowledged_version": self.profile.legal_acknowledged_version,
                "beta_full_access": self.profile.beta_full_access,
                "beta_access_until": self.profile.beta_access_until,
                "beta_access_granted_at": self.profile.beta_access_granted_at,
                "has_full_access": self.profile.has_full_access or self.is_admin,
                "has_ai_explanations": self.profile.has_ai_explanations or self.is_admin,
            },
        }


# ── Internal helpers ────────────────────────────────────────────────────


def _build_cognito_client(client: Any | None) -> Any | None:
    """Build (or accept) a Cognito idp client; ``None`` when unconfigured."""
    if client is not None:
        return client
    settings = get_settings()
    pool = (settings.cognito_user_pool_id or "").strip()
    if not pool:
        return None
    region = (settings.cognito_region or settings.aws_region or "us-east-1").strip()
    try:
        import boto3

        return boto3.client("cognito-idp", region_name=region)
    except Exception as exc:  # pragma: no cover — boto3 surface
        _LOG.warning("cognito client build failed: %s", exc)
        return None


def _pool_id() -> str:
    settings = get_settings()
    return (settings.cognito_user_pool_id or "").strip()


def _attr(user_attrs: list[dict[str, Any]] | None, name: str) -> str:
    if not isinstance(user_attrs, list):
        return ""
    for attr in user_attrs:
        if not isinstance(attr, dict):
            continue
        if attr.get("Name") == name:
            value = attr.get("Value")
            if value is None:
                return ""
            return str(value)
    return ""


def _coerce_record(raw: dict[str, Any]) -> CognitoUserRecord | None:
    """Turn a Cognito ``User`` payload into our internal record.

    Returns ``None`` for rows missing a ``sub`` attribute (defensive — a
    Cognito user without a sub shouldn't exist, but if it does the admin
    UI shouldn't crash on it).
    """
    attrs = raw.get("Attributes") or raw.get("UserAttributes") or []
    sub = _attr(attrs, "sub")
    if not sub:
        return None
    username = str(raw.get("Username") or "")
    return CognitoUserRecord(
        sub=sub,
        username=username,
        email=_attr(attrs, "email"),
        email_verified=_attr(attrs, "email_verified").lower() == "true",
        status=str(raw.get("UserStatus") or ""),
        enabled=bool(raw.get("Enabled")) if raw.get("Enabled") is not None else True,
        created_at=str(raw.get("UserCreateDate") or ""),
        updated_at=str(raw.get("UserLastModifiedDate") or ""),
    )


# ── Public API ──────────────────────────────────────────────────────────


def search_users(
    query: str,
    *,
    limit: int = DEFAULT_SEARCH_LIMIT,
    client: Any | None = None,
) -> list[CognitoUserRecord]:
    """Find users whose email begins with ``query``.

    Returns ``[]`` for an empty query, when Cognito is unconfigured, or
    when the API call fails. Result is sorted by email ascending so the
    admin UI is stable across page loads.

    ``limit`` is clamped to ``[1, MAX_SEARCH_LIMIT]``; the default of 25
    is plenty for "type a prefix, pick a row" workflows.
    """
    q = (query or "").strip()
    if not q:
        return []
    capped = max(1, min(MAX_SEARCH_LIMIT, int(limit)))
    pool = _pool_id()
    if not pool:
        return []
    c = _build_cognito_client(client)
    if c is None:
        return []
    try:
        resp = c.list_users(
            UserPoolId=pool,
            Filter=f'email ^= "{q}"',
            Limit=capped,
        )
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.warning("cognito list_users(search) failed: %s", exc)
        return []
    users = resp.get("Users") or []
    out: list[CognitoUserRecord] = []
    for raw in users:
        if not isinstance(raw, dict):
            continue
        rec = _coerce_record(raw)
        if rec is not None:
            out.append(rec)
    out.sort(key=lambda r: (r.email or "").lower())
    return out


def get_cognito_user_by_sub(
    sub: str,
    *,
    client: Any | None = None,
) -> CognitoUserRecord | None:
    """Fetch one Cognito user by ``sub`` (the user_id we store everywhere).

    Uses ``ListUsers`` with a ``sub`` filter rather than ``AdminGetUser``
    because the latter requires the username (email) which we don't always
    have on the way in — the admin clicks "view" on a row whose only
    stable id is the sub.
    """
    needle = (sub or "").strip()
    if not needle:
        return None
    pool = _pool_id()
    if not pool:
        return None
    c = _build_cognito_client(client)
    if c is None:
        return None
    try:
        resp = c.list_users(
            UserPoolId=pool,
            Filter=f'sub = "{needle}"',
            Limit=1,
        )
    except Exception as exc:
        _LOG.warning("cognito list_users(sub=%r) failed: %s", needle, exc)
        return None
    users = resp.get("Users") or []
    if not users or not isinstance(users[0], dict):
        return None
    return _coerce_record(users[0])


def list_groups_for_user(
    username: str,
    *,
    client: Any | None = None,
) -> list[str]:
    """Return the Cognito groups ``username`` belongs to (best-effort)."""
    name = (username or "").strip()
    if not name:
        return []
    pool = _pool_id()
    if not pool:
        return []
    c = _build_cognito_client(client)
    if c is None:
        return []
    try:
        resp = c.admin_list_groups_for_user(Username=name, UserPoolId=pool)
    except Exception as exc:
        _LOG.warning("cognito admin_list_groups_for_user(%r) failed: %s", name, exc)
        return []
    groups = resp.get("Groups") or []
    out: list[str] = []
    for g in groups:
        if isinstance(g, dict):
            gn = g.get("GroupName")
            if isinstance(gn, str) and gn.strip():
                out.append(gn.strip())
    return sorted(set(out))


def get_user_detail(
    user_id: str,
    *,
    client: Any | None = None,
) -> AdminUserDetail | None:
    """Compose Cognito user + group membership + ``UserProfile`` in one call.

    Returns ``None`` when the user isn't in Cognito (which is the only
    place we'd find their email). A user with a ``UserProfile`` row but
    no Cognito presence is treated as deleted from the admin UI's POV.
    """
    sub = (user_id or "").strip()
    if not sub:
        return None
    cog = get_cognito_user_by_sub(sub, client=client)
    if cog is None:
        return None
    profile = get_user_profile_store().get_profile(sub)
    groups = list_groups_for_user(cog.username, client=client)
    return AdminUserDetail(cognito=cog, profile=profile, groups=groups)
