"""Weekly Position gem-scan batch — ADR-004 POS-D15 (full).

Invoked from the scanner Lambda on ``scan_type="position_scan_batch"`` (weekend EventBridge).
Builds the expanded, pre-filtered universe (:func:`build_scan_universe`), composites + ranks it
(:func:`run_position_scan_async`), persists the snapshot to the cross-instance store, and warms
the in-process cache so the invoking instance serves immediately.

Best-effort and self-contained: a screener failure degrades to the curated universe; a store
failure still returns a successful scan (persistence just no-ops). Never raises to the Lambda.
"""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.api.services.position_scan import (
    run_position_scan_async,
    set_position_scan_snapshot_cache,
)
from stocvest.api.services.position_scan_store import get_position_scan_store
from stocvest.api.services.position_universe import build_scan_universe
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_DEFAULT_CONCURRENCY = 6


async def run_position_scan_batch_async(
    *,
    max_universe: int | None = None,
    concurrency: int = _DEFAULT_CONCURRENCY,
) -> dict[str, Any]:
    universe = await build_scan_universe(max_size=max_universe)
    snapshot = await run_position_scan_async(universe=universe, concurrency=concurrency)

    persisted = False
    try:
        persisted = get_position_scan_store().put(snapshot)
    except Exception as exc:  # noqa: BLE001 — persistence is best-effort
        _LOG.warning("position scan batch persist failed: %s", type(exc).__name__)
    # Warm the invoking instance regardless of whether cross-instance persistence succeeded.
    set_position_scan_snapshot_cache(snapshot)

    tiers: dict[str, int] = {}
    for c in snapshot.candidates:
        tiers[c.tier] = tiers.get(c.tier, 0) + 1

    out = {
        "job": "position_scan_batch",
        "universe": len(universe),
        "candidates": len(snapshot.candidates),
        "tiers": tiers,
        "persisted": persisted,
    }
    _LOG.info(
        "position scan batch done universe=%s candidates=%s gems=%s strong=%s persisted=%s",
        len(universe),
        len(snapshot.candidates),
        tiers.get("gem", 0),
        tiers.get("strong", 0),
        persisted,
    )
    return out


def run_position_scan_batch_sync(
    *,
    max_universe: int | None = None,
    concurrency: int = _DEFAULT_CONCURRENCY,
) -> dict[str, Any]:
    return asyncio.run(
        run_position_scan_batch_async(max_universe=max_universe, concurrency=concurrency)
    )
