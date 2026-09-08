"""Sector peer resolution for Position valuation (ADR-004 POS-D1).

v1 primary source: FMP ``stock-peers`` via ``FundamentalsProvider.get_sector_peers``.
Sector ETF holdings fallback is reserved for v1.1 (documented in POSITION_FUNDAMENTALS_SPEC).
"""

from __future__ import annotations

from stocvest.data.fundamentals_models import (
    clamp_fundamentals_limit,
    normalize_fundamentals_symbol,
)
from stocvest.data.fundamentals_provider import FundamentalsProvider, get_fundamentals_provider

_DEFAULT_PEER_LIMIT = 15


async def resolve_position_peers(
    symbol: str,
    provider: FundamentalsProvider | None = None,
    *,
    limit: int = _DEFAULT_PEER_LIMIT,
    sector_etf: str | None = None,
) -> list[str]:
    """
    Return a bounded peer list for relative valuation (F4).

    Never raises. ``sector_etf`` is accepted for forward compatibility (v1.1 ETF-holdings
    fallback) but is **not** used in v1 — peers come only from the provider.
    """
    sym = normalize_fundamentals_symbol(symbol)
    if not sym:
        return []
    _ = sector_etf  # v1.1: sector ETF top-N holdings when FMP peers empty

    prov = provider or get_fundamentals_provider()
    lim = clamp_fundamentals_limit(limit, max_limit=25)
    try:
        peers = await prov.get_sector_peers(sym, limit=lim)
    except Exception:
        return []
    return peers
