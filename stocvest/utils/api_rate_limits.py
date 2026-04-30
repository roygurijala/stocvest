"""Distributed rate limits for Polygon REST and Anthropic (Redis-backed, no-op without Redis)."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from stocvest.utils.config import get_settings
from stocvest.utils.redis_client import get_sync_redis


async def await_polygon_rest_slot() -> None:
    """Wait until a Polygon REST call is allowed under the per-second Redis counter."""
    settings = get_settings()
    r: Any = get_sync_redis()
    if r is None:
        return
    limit = max(1, int(settings.polygon_rate_limit_per_second))

    async def _tick() -> bool:
        def _incr() -> int:
            slot = int(time.time())
            key = f"stocvest:rl:polygon:{slot}"
            n = int(r.incr(key))
            if n == 1:
                r.expire(key, 3)
            return n

        n = await asyncio.to_thread(_incr)
        return n <= limit

    for _ in range(200):
        if await _tick():
            return
        await asyncio.sleep(0.02)


async def await_claude_api_slot() -> None:
    """Wait until a Claude API call is allowed under the per-minute Redis counter."""
    settings = get_settings()
    r: Any = get_sync_redis()
    if r is None:
        return
    limit = max(1, int(settings.claude_rate_limit_per_minute))

    async def _tick() -> bool:
        def _incr() -> int:
            slot = int(time.time()) // 60
            key = f"stocvest:rl:claude:{slot}"
            n = int(r.incr(key))
            if n == 1:
                r.expire(key, 120)
            return n

        n = await asyncio.to_thread(_incr)
        return n <= limit

    for _ in range(600):
        if await _tick():
            return
        await asyncio.sleep(0.05)
