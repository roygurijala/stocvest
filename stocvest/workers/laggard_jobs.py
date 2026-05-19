"""
EventBridge dispatcher for laggard scheduled jobs (Chunk 9).

Actions: ``warm_price_cache`` | ``pre_ipo_monitor`` | ``precompute_clusters``
"""

from __future__ import annotations

from typing import Any

from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def handler(event: Any, context: Any) -> dict[str, Any]:
    action = str((event or {}).get("action") or "").strip()
    if action == "warm_price_cache":
        from stocvest.workers.price_cache_warmer import handler as warm_handler

        return warm_handler(event, context)
    if action == "pre_ipo_monitor":
        from stocvest.workers.pre_ipo_monitor import handler as pre_ipo_handler

        return pre_ipo_handler(event, context)
    if action == "precompute_clusters":
        from stocvest.workers.dynamic_cluster_job import handler as cluster_handler

        return cluster_handler(event, context)

    _LOG.warning("laggard_jobs_unknown_action action=%s", action or "(empty)")
    return {"statusCode": 400, "error": "unknown_action", "action": action}
