"""Defaults for invited beta tester access (Dynamo `Users` beta fields)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

# When enabling beta without an explicit end time, entitlement ends after this many days (UTC).
BETA_ACCESS_DEFAULT_DAYS = 21


def default_beta_access_until_iso(*, now: datetime | None = None) -> str:
    """ISO-8601 UTC timestamp marking the end of the default beta window."""
    n = now if now is not None else datetime.now(timezone.utc)
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    return (n + timedelta(days=BETA_ACCESS_DEFAULT_DAYS)).isoformat()
