"""Manual Opportunity Desk refresh — per-user cooldown + Tier B then C batch."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from stocvest.api.services.opportunity_desk.batch import run_opportunity_desk_batch_sync
from stocvest.data.dashboard_cache import upstash_configured, get_upstash
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

DESK_MANUAL_REFRESH_COOLDOWN_SEC = 300


@dataclass(frozen=True)
class DeskRefreshCooldownError(Exception):
    retry_after_seconds: int

    def __str__(self) -> str:
        return f"desk refresh cooldown ({self.retry_after_seconds}s)"


def desk_refresh_cooldown_key(user_id: str | None) -> str:
    uid = str(user_id or "anon").strip() or "anon"
    return f"stocvest:desk:refresh_cooldown:{uid}"


def try_acquire_desk_refresh_cooldown(user_id: str | None) -> tuple[bool, int]:
    """
    Return ``(acquired, retry_after_seconds)``.

    When Upstash is not configured, allow refresh (local/dev).
    """
    if not upstash_configured():
        return True, 0
    key = desk_refresh_cooldown_key(user_id)
    try:
        r = get_upstash()
        acquired = bool(r.set(key, "1", nx=True, ex=DESK_MANUAL_REFRESH_COOLDOWN_SEC))
        if acquired:
            return True, 0
        ttl = r.ttl(key)
        retry = int(ttl) if isinstance(ttl, int) and ttl > 0 else DESK_MANUAL_REFRESH_COOLDOWN_SEC
        return False, retry
    except Exception as exc:
        _LOG.warning("desk_refresh_cooldown_check_failed: %s", exc)
        return True, 0


def release_desk_refresh_cooldown(user_id: str | None) -> None:
    """Best-effort cooldown rollback for failed manual refresh attempts."""
    if not upstash_configured():
        return
    key = desk_refresh_cooldown_key(user_id)
    try:
        get_upstash().delete(key)
    except Exception as exc:  # noqa: BLE001 - cooldown cleanup should never break request flow
        _LOG.warning("desk_refresh_cooldown_release_failed: %s", exc)


def run_manual_desk_refresh(user_id: str | None) -> dict[str, Any]:
    """Tier B (movers) then Tier C (full discovery composite)."""
    acquired, retry_after = try_acquire_desk_refresh_cooldown(user_id)
    if not acquired:
        raise DeskRefreshCooldownError(retry_after_seconds=retry_after)

    try:
        movers = run_opportunity_desk_batch_sync(tier="movers")
        full = run_opportunity_desk_batch_sync(tier="full")
    except Exception:
        release_desk_refresh_cooldown(user_id)
        raise
    return {
        "status": "ok",
        "tiers": ["movers", "full"],
        "movers": movers,
        "full": full,
    }
