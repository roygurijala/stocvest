"""
Laggard HTTP API helpers — caching, universe scan, response shaping (Chunk 8).
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from stocvest.api.services.scanner_response_cache import cache_get, cache_set
from stocvest.data.dashboard_cache import evidence_cache_key, read_dashboard_cache
from stocvest.data.price_cache import PriceCache
from stocvest.data.sector_peer_registry import get_all_registry_symbols
from stocvest.data.watchlist_maturation_repository import get_watchlist_maturation_repository
from stocvest.signals.laggard_assembler import compute_laggard_signal
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.workers.market_open_setup import collect_watchlist_symbols_for_price_warm

_SYMBOL_CACHE_TTL = 300
_SCANNER_CACHE_TTL = 600
_ET = ZoneInfo("America/New_York")

ConfidenceFilter = Literal["high", "medium", "all"]
TypeFilter = Literal["catch_up", "pre_breakout", "distribution", "all"]
DriverFilter = Literal["sector", "theme", "macro", "pre_ipo", "all"]


def laggard_plan_allowed(user_id: str | None) -> bool:
    """Swing Pro, Swing Day Pro, or active beta full access."""
    if not user_id:
        return False
    store = get_user_profile_store()
    profile = store.get_profile(user_id) if store else None
    if profile is None:
        return False
    return bool(profile.has_full_access)


def _session_date_et() -> str:
    return datetime.now(_ET).date().isoformat()


def laggard_symbol_cache_key(symbol: str) -> str:
    day = _session_date_et()
    return f"stocvest:laggard:symbol:{symbol.strip().upper()}:{day}"


def laggard_scanner_cache_key(
    *,
    confidence: str,
    laggard_type: str,
    driver: str,
) -> str:
    day = _session_date_et()
    return f"stocvest:laggard:scanner:{day}:{confidence}:{laggard_type}:{driver}"


def active_universe_symbols(*, limit: int = 120) -> list[str]:
    """Registry + platform default watchlists (price-cache universe)."""
    merged = list(
        dict.fromkeys(
            [
                *[s.upper() for s in get_all_registry_symbols()],
                *[s.upper() for s in collect_watchlist_symbols_for_price_warm()],
            ]
        )
    )
    return merged[: max(1, limit)]


def format_laggard_payload(symbol: str, laggard_data: dict[str, Any] | None) -> dict[str, Any]:
    sym = symbol.strip().upper()
    if laggard_data and laggard_data.get("has_laggard_signal"):
        out = dict(laggard_data)
        out["symbol"] = sym
        return out
    reason = "No relative-strength divergence detected for this symbol."
    if laggard_data is None:
        reason = "Price cache not warmed or insufficient session data."
    return {
        "symbol": sym,
        "has_laggard_signal": False,
        "reason": reason,
    }


def _laggard_from_composite_cache(symbol: str) -> dict[str, Any] | None:
    envelope = read_dashboard_cache(evidence_cache_key(symbol, "swing"))
    if not envelope or not isinstance(envelope.get("data"), dict):
        return None
    lag = envelope["data"].get("laggard_signal")
    if isinstance(lag, dict):
        return lag
    return None


async def _compute_laggard_from_price_cache(symbol: str) -> dict[str, Any] | None:
    cache = PriceCache()
    move = cache.get_1d_change(symbol)
    if move is None:
        return None
    vol_avg = cache.get_vol_avg_20d(symbol)
    vol_today = (vol_avg * cache.get_volume_ratio(symbol)) if vol_avg else None
    return await compute_laggard_signal(
        symbol=symbol,
        news_verdict="neutral",
        has_earnings_risk=False,
        tech_score=50.0,
        symbol_move_1d=float(move),
        symbol_vol_today=vol_today,
        mode="swing",
        price_cache=cache,
    )


async def get_symbol_laggard_payload(
    symbol: str,
    *,
    mode: str = "swing",
    user_id: str | None = None,
) -> dict[str, Any]:
    sym = symbol.strip().upper()
    if not sym:
        return format_laggard_payload("", None)
    if (mode or "swing").strip().lower() != "swing":
        return {
            "symbol": sym,
            "has_laggard_signal": False,
            "reason": "Laggard context is available for swing mode only.",
        }

    ck = laggard_symbol_cache_key(sym)
    cached = cache_get(ck)
    if cached is not None:
        return cached

    lag = _laggard_from_composite_cache(sym)
    if lag is None:
        lag = await _compute_laggard_from_price_cache(sym)

    body = format_laggard_payload(sym, lag)
    cache_set(ck, body, ttl_seconds=_SYMBOL_CACHE_TTL)
    return body


def _confidence_matches(level: str, filt: ConfidenceFilter) -> bool:
    order = {"low": 0, "medium": 1, "high": 2}
    val = order.get((level or "").strip().lower(), 0)
    if filt == "all":
        return True
    if filt == "high":
        return val >= 2
    return val >= 1


def _type_matches(value: str, filt: TypeFilter) -> bool:
    if filt == "all":
        return True
    return (value or "").strip().lower() == filt


def _driver_matches(value: str, filt: DriverFilter) -> bool:
    if filt == "all":
        return True
    v = (value or "").strip().lower()
    if filt == "pre_ipo":
        return v == "pre_ipo_proxy"
    return v == filt


def _maturation_state(user_id: str | None, symbol: str) -> str | None:
    if not user_id:
        return None
    repo = get_watchlist_maturation_repository()
    if repo is None:
        return None
    entry = repo.get_entry(user_id, symbol.upper(), "swing")
    if entry is None:
        return None
    return entry.state.value


async def scan_laggards(
    *,
    user_id: str | None,
    confidence: ConfidenceFilter = "medium",
    laggard_type: TypeFilter = "all",
    driver: DriverFilter = "all",
) -> dict[str, Any]:
    ck = laggard_scanner_cache_key(
        confidence=confidence,
        laggard_type=laggard_type,
        driver=driver,
    )
    cached = cache_get(ck)
    if cached is not None:
        return cached

    symbols = active_universe_symbols()
    laggards: list[dict[str, Any]] = []
    cache = PriceCache()

    for sym in symbols:
        if not cache.is_cached(sym):
            continue
        lag = await _compute_laggard_from_price_cache(sym)
        if not lag or not lag.get("has_laggard_signal"):
            continue
        if not _confidence_matches(str(lag.get("confidence") or ""), confidence):
            continue
        if not _type_matches(str(lag.get("laggard_type") or ""), laggard_type):
            continue
        if not _driver_matches(str(lag.get("driver_type") or ""), driver):
            continue
        narrative = lag.get("narrative") if isinstance(lag.get("narrative"), dict) else {}
        laggards.append(
            {
                "symbol": sym,
                "laggard_type": lag.get("laggard_type"),
                "driver_type": lag.get("driver_type"),
                "driver_label": lag.get("driver_label"),
                "confidence": lag.get("confidence"),
                "laggard_score": lag.get("laggard_score"),
                "summary_line": narrative.get("summary_line") if isinstance(narrative, dict) else None,
                "current_watchlist_state": _maturation_state(user_id, sym),
            }
        )

    laggards.sort(key=lambda row: float(row.get("laggard_score") or 0.0), reverse=True)
    body = {
        "session_date": _session_date_et(),
        "scanned": len(symbols),
        "laggards_found": len(laggards),
        "laggards": laggards,
    }
    cache_set(ck, body, ttl_seconds=_SCANNER_CACHE_TTL)
    return body


def get_symbol_laggard_payload_sync(symbol: str, *, mode: str = "swing", user_id: str | None = None) -> dict[str, Any]:
    return asyncio.run(get_symbol_laggard_payload(symbol, mode=mode, user_id=user_id))


def scan_laggards_sync(
    *,
    user_id: str | None,
    confidence: ConfidenceFilter = "medium",
    laggard_type: TypeFilter = "all",
    driver: DriverFilter = "all",
) -> dict[str, Any]:
    return asyncio.run(
        scan_laggards(
            user_id=user_id,
            confidence=confidence,
            laggard_type=laggard_type,
            driver=driver,
        )
    )
