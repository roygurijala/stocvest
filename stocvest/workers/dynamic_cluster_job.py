"""
Pre-compute dynamic laggard clusters after the open (Chunk 9).

Writes session cache key ``stocvest:dynamic_clusters:{date}`` (10 min TTL).
"""

from __future__ import annotations

from typing import Any

from stocvest.data.price_cache import PriceCache
from stocvest.signals.laggard_assembler import get_or_compute_dynamic_clusters
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def run_dynamic_cluster_precompute() -> dict[str, Any]:
    cache = PriceCache()
    clusters = get_or_compute_dynamic_clusters(cache)
    return {
        "job": "precompute_clusters",
        "clusters_found": len(clusters),
        "leaders": [c.leader_symbol for c in clusters[:10]],
    }


def handler(event: Any, context: Any) -> dict[str, Any]:
    """EventBridge entry — never raises."""
    _ = (event, context)
    try:
        body = run_dynamic_cluster_precompute()
        return {"statusCode": 200, **body}
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("dynamic_cluster_job_failed err=%s", type(exc).__name__)
        return {
            "statusCode": 200,
            "job": "precompute_clusters",
            "clusters_found": 0,
            "error": type(exc).__name__,
        }
