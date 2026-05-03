"""Stable pseudonyms for log correlation without emitting raw Cognito `sub` values."""

from __future__ import annotations

import hashlib


def user_ref_for_logs(user_id: str | None) -> str:
    """Short stable token derived from user id (not reversible to sub without brute force)."""
    if not user_id:
        return "anon"
    digest = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:12]
    return f"u_{digest}"
