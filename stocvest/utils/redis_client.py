"""Lazy sync Redis client for caching and rate limits (optional when disabled or unreachable)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from stocvest.utils.config import get_settings

if TYPE_CHECKING:
    import redis as redis_types

_redis: Any | None = None
_redis_failed: bool = False


def reset_redis_client_for_tests() -> None:
    """Clear cached client (used from tests only)."""
    global _redis, _redis_failed
    if _redis is not None:
        try:
            _redis.close()
        except Exception:
            pass
    _redis = None
    _redis_failed = False


def get_sync_redis() -> Any | None:
    """Return a shared ``redis.Redis`` client, or ``None`` if Redis is disabled or unavailable."""
    global _redis, _redis_failed
    settings = get_settings()
    if settings.stocvest_disable_redis or _redis_failed:
        return None
    if _redis is not None:
        return _redis
    try:
        import redis

        client = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=1.5,
            socket_timeout=3.0,
        )
        client.ping()
        _redis = client
        return _redis
    except Exception:
        _redis_failed = True
        _redis = None
        return None


def redis_available() -> bool:
    return get_sync_redis() is not None
