"""Merge Opportunity Desk cache symbols into scheduled scanner universe (D13 Phase 5)."""

from __future__ import annotations

from typing import Any

from stocvest.api.services.opportunity_desk.batch import opportunity_desk_redis_key
from stocvest.data.dashboard_cache import read_dashboard_cache

DISCOVERY_UNIVERSE_LIMIT = 15
MOVERS_RADAR_UNIVERSE_LIMIT = 30


def _symbols_from_desk_data(data: dict[str, Any] | None) -> list[str]:
    if not data:
        return []
    out: list[str] = []
    discovery = data.get("discovery")
    if isinstance(discovery, list):
        for row in discovery[:DISCOVERY_UNIVERSE_LIMIT]:
            if isinstance(row, dict):
                sym = str(row.get("symbol") or "").strip().upper()
                if sym:
                    out.append(sym)
    movers = data.get("movers_radar")
    if isinstance(movers, list):
        for row in movers[:MOVERS_RADAR_UNIVERSE_LIMIT]:
            if isinstance(row, dict):
                sym = str(row.get("symbol") or "").strip().upper()
                if sym:
                    out.append(sym)
    return out


def desk_universe_symbols_from_cache(*, limit: int = 50) -> list[str]:
    """Best-effort Tier B/C symbols from swing + day desk envelopes."""
    merged: list[str] = []
    seen: set[str] = set()
    for mode in ("swing", "day"):
        envelope = read_dashboard_cache(opportunity_desk_redis_key(mode))  # type: ignore[arg-type]
        if not isinstance(envelope, dict):
            continue
        raw = envelope.get("data")
        data = raw if isinstance(raw, dict) else None
        for sym in _symbols_from_desk_data(data):
            if sym in seen:
                continue
            seen.add(sym)
            merged.append(sym)
            if len(merged) >= limit:
                return merged
    return merged
