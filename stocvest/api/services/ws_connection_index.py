"""Redis index of WebSocket ``connectionId`` values subscribed to push channels (scanner fan-out)."""

from __future__ import annotations

from stocvest.utils.redis_client import get_sync_redis

SCANNER_UPDATES_CHANNEL = "scanner:updates"

_REDIS_KEY = "stocvest:ws:subscribers:scanner:updates"


def index_subscribe_scanner_updates(connection_id: str) -> None:
    r = get_sync_redis()
    if r is None:
        return
    r.sadd(_REDIS_KEY, connection_id)
    r.expire(_REDIS_KEY, 86400)


def index_unsubscribe_scanner_updates(connection_id: str) -> None:
    r = get_sync_redis()
    if r is None:
        return
    r.srem(_REDIS_KEY, connection_id)


def list_scanner_update_subscribers() -> list[str]:
    r = get_sync_redis()
    if r is None:
        return []
    raw = r.smembers(_REDIS_KEY)
    return sorted(str(x) for x in raw) if raw else []


def reset_ws_subscriber_index_for_tests() -> None:
    try:
        r = get_sync_redis()
    except Exception:
        return
    if r is not None:
        try:
            r.delete(_REDIS_KEY)
        except Exception:
            pass
