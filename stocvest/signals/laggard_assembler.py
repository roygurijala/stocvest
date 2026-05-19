"""
Laggard signal assembler — cache, registry, detector, narrative (Chunk 6).

Display context only; never blocks composite response. Never raises.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from stocvest.data.price_cache import PriceCache
from stocvest.data.sector_peer_registry import (
    SectorPeerGroup,
    _PEER_GROUPS,
    get_all_peer_groups,
    get_group_by_trigger_entity,
)
from stocvest.signals.dynamic_cluster_detector import (
    DynamicCluster,
    clusters_to_peer_groups,
    detect_all_dynamic_clusters,
)
from stocvest.signals.laggard_detector import (
    LaggardContext,
    LaggardResult,
    PeerMove,
    build_laggard_context,
    detect_laggard_multi_group,
)
from stocvest.signals.laggard_narrative import LaggardNarrative, build_narrative
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

_DYNAMIC_CLUSTER_TTL_SEC = 600
_ET_ZONE = ZoneInfo("America/New_York")


def _session_date_et() -> str:
    return datetime.now(_ET_ZONE).date().isoformat()


def _dynamic_clusters_key(session_date: str) -> str:
    return f"stocvest:dynamic_clusters:{session_date}"


def _pre_ipo_active_key(session_date: str) -> str:
    return f"stocvest:pre_ipo_active:{session_date}"


def news_verdict_is_clean(verdict: str) -> bool:
    """Bearish news blocks laggard detection."""
    return (verdict or "").strip().lower() != "bearish"


def tech_score_to_structure(tech_score: float) -> str:
    """Map swing technical layer score to laggard structure label."""
    if tech_score >= 50.0:
        return "intact"
    if tech_score < 30.0:
        return "weak"
    return "unknown"


def _volume_ratio(cache: PriceCache, symbol: str, vol_today: float | None) -> float:
    if vol_today is not None and vol_today > 0:
        avg = cache.get_vol_avg_20d(symbol)
        if avg is not None and avg > 0:
            return float(vol_today) / float(avg)
    return cache.get_volume_ratio(symbol)


def _resolve_move_1d(
    symbol: str,
    snapshot_move_1d: float | None,
    cache: PriceCache,
) -> float | None:
    if snapshot_move_1d is not None:
        return float(snapshot_move_1d)
    return cache.get_1d_change(symbol)


def build_peer_move_data(cache: PriceCache, symbols: list[str]) -> dict[str, PeerMove]:
    """Build PeerMove map from warmed price cache (skips missing symbols)."""
    out: dict[str, PeerMove] = {}
    for raw in symbols:
        sym = (raw or "").strip().upper()
        if not sym or sym in out:
            continue
        d1 = cache.get_1d_change(sym)
        if d1 is None:
            continue
        d5 = cache.get_5d_change(sym)
        if d5 is None:
            d5 = d1
        out[sym] = PeerMove(
            symbol=sym,
            pct_change_1d=float(d1),
            pct_change_5d=float(d5),
            volume_ratio=_volume_ratio(cache, sym, None),
        )
    return out


def _cluster_to_dict(cluster: DynamicCluster) -> dict[str, Any]:
    return {
        "leader_symbol": cluster.leader_symbol,
        "leader_move_1d": cluster.leader_move_1d,
        "leader_dominance_score": cluster.leader_dominance_score,
        "cluster_symbols": list(cluster.cluster_symbols),
        "cluster_direction": cluster.cluster_direction,
        "cluster_size": cluster.cluster_size,
        "is_ipo_mode": cluster.is_ipo_mode,
        "driver_label": cluster.driver_label,
    }


def _cluster_from_dict(raw: dict[str, Any]) -> DynamicCluster:
    return DynamicCluster(
        leader_symbol=str(raw["leader_symbol"]).upper(),
        leader_move_1d=float(raw["leader_move_1d"]),
        leader_dominance_score=float(raw.get("leader_dominance_score", 0.0)),
        cluster_symbols=tuple(str(s).upper() for s in raw.get("cluster_symbols") or []),
        cluster_direction=str(raw.get("cluster_direction") or "up"),
        cluster_size=int(raw.get("cluster_size") or 0),
        is_ipo_mode=bool(raw.get("is_ipo_mode")),
        driver_label=str(raw.get("driver_label") or ""),
    )


def _read_pre_ipo_active_entities(session_date: str) -> list[str]:
    r = get_sync_redis()
    if r is None:
        return []
    try:
        raw = r.get(_pre_ipo_active_key(session_date))
        if not raw:
            return []
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(x).strip() for x in parsed if str(x).strip()]
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        _LOG.warning("pre_ipo_active_parse_failed err=%s", type(exc).__name__)
    return []


def evaluation_groups_for_symbol(
    symbol: str,
    *,
    static_groups: list[SectorPeerGroup] | None = None,
    pre_ipo_active_entities: list[str] | None = None,
) -> list[SectorPeerGroup]:
    """Static peer groups plus news-activated pre-IPO proxy groups."""
    sym = symbol.strip().upper()
    groups = list(static_groups if static_groups is not None else get_all_peer_groups(sym))
    seen = {g.registry_key for g in groups if g.registry_key}
    for entity in pre_ipo_active_entities or []:
        group = get_group_by_trigger_entity(entity)
        if group is None:
            continue
        if group.registry_key and group.registry_key in seen:
            continue
        if sym not in {p.upper() for p in group.peers}:
            continue
        groups.append(group)
        if group.registry_key:
            seen.add(group.registry_key)
    return groups


def get_or_compute_dynamic_clusters(
    price_cache: PriceCache,
    *,
    session_date: str | None = None,
    redis_client: Any | None = None,
) -> list[DynamicCluster]:
    """
    Read session dynamic clusters from Redis; compute and cache on miss (10 min TTL).
    """
    day = session_date or _session_date_et()
    key = _dynamic_clusters_key(day)
    r = redis_client if redis_client is not None else get_sync_redis()
    if r is not None:
        try:
            raw = r.get(key)
            if raw:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [_cluster_from_dict(row) for row in parsed if isinstance(row, dict)]
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            _LOG.warning("dynamic_clusters_cache_read_failed err=%s", type(exc).__name__)

    clusters = detect_all_dynamic_clusters(price_cache)
    if r is not None:
        try:
            payload = json.dumps([_cluster_to_dict(c) for c in clusters])
            r.setex(key, _DYNAMIC_CLUSTER_TTL_SEC, payload)
        except Exception as exc:
            _LOG.warning("dynamic_clusters_cache_write_failed err=%s", type(exc).__name__)
    return clusters


def _collect_price_symbols(
    symbol: str,
    static_groups: list[SectorPeerGroup],
    dynamic_groups: list[SectorPeerGroup],
) -> list[str]:
    needed: set[str] = {symbol.strip().upper()}
    for group in (*static_groups, *dynamic_groups):
        if group.primary_etf:
            needed.add(group.primary_etf.strip().upper())
        for p in group.peers:
            needed.add(p.strip().upper())
    return sorted(needed)


def _sector_confirmed(result: LaggardResult) -> bool:
    if result.driver_type != "sector":
        return True
    return float(result.lag_vs_etf_1d) >= 0.8


def _serialize_signal(
    symbol: str,
    ctx: LaggardContext,
    result: LaggardResult,
    narrative: LaggardNarrative,
    *,
    news_clean: bool,
    has_earnings_risk: bool,
    technical_structure: str,
) -> dict[str, Any]:
    peers_moving = [
        {
            "symbol": p.symbol,
            "move_1d": round(p.pct_change_1d, 2),
            "move_5d": round(p.pct_change_5d, 2),
            "volume_ratio": round(p.volume_ratio, 2),
        }
        for p in result.peers_moving
    ]
    return {
        "symbol": symbol.strip().upper(),
        "has_laggard_signal": True,
        "laggard_type": result.laggard_type.value,
        "driver_type": result.driver_type,
        "driver_label": narrative.driver_label,
        "trigger_entity": result.trigger_entity,
        "confidence": result.confidence,
        "laggard_score": round(float(result.laggard_score), 1),
        "qualified_groups": int(result.qualified_groups),
        "context": {
            "sector_name": ctx.sector_name,
            "group_type": ctx.group_type.value,
            "avg_peer_move_1d": round(result.avg_peer_move_1d, 2),
            "avg_peer_move_5d": round(result.avg_peer_move_5d, 2),
            "symbol_move_1d": round(ctx.symbol_move_1d, 2),
            "symbol_move_5d": round(ctx.symbol_move_5d, 2),
            "lag_behind_peers_1d": round(result.lag_vs_peers_1d, 2),
            "lag_behind_peers_5d": round(result.lag_vs_peers_5d, 2),
            "volume_pattern": result.volume_pattern,
            "peers_moving": peers_moving,
        },
        "narrative": {
            "summary_line": narrative.summary_line,
            "explanation": narrative.explanation,
            "what_to_watch": narrative.what_to_watch,
        },
        "filters_passed": {
            "sector_confirmed": _sector_confirmed(result),
            "news_clean": news_clean,
            "no_earnings_nearby": not has_earnings_risk,
            "technical_intact": technical_structure == "intact",
        },
    }


async def compute_laggard_signal(
    *,
    symbol: str,
    news_verdict: str,
    has_earnings_risk: bool,
    tech_score: float,
    symbol_move_1d: float | None,
    symbol_vol_today: float | None,
    mode: str,
    price_cache: PriceCache | None = None,
    session_date: str | None = None,
    redis_client: Any | None = None,
) -> dict[str, Any] | None:
    """
    Full laggard pipeline for swing composite. Returns None on day mode, cache miss,
    no signal, or any error.
    """
    try:
        if (mode or "").strip().lower() != "swing":
            return None

        sym = symbol.strip().upper()
        if not sym:
            return None

        cache = price_cache or PriceCache()
        if not cache.list_cached_symbols():
            return None
        if not cache.is_cached(sym):
            return None

        move_1d = _resolve_move_1d(sym, symbol_move_1d, cache)
        if move_1d is None:
            return None

        move_5d = cache.get_5d_change(sym)
        if move_5d is None:
            move_5d = move_1d

        vol_ratio = _volume_ratio(cache, sym, symbol_vol_today)
        structure = tech_score_to_structure(float(tech_score))
        news_clean = news_verdict_is_clean(news_verdict)

        day = session_date or _session_date_et()
        pre_ipo_entities = _read_pre_ipo_active_entities(day)
        static_groups = evaluation_groups_for_symbol(sym, pre_ipo_active_entities=pre_ipo_entities)

        clusters = get_or_compute_dynamic_clusters(
            cache,
            session_date=day,
            redis_client=redis_client,
        )
        dynamic_groups = clusters_to_peer_groups(clusters)

        symbols_needed = _collect_price_symbols(sym, static_groups, dynamic_groups)
        peer_move_data = build_peer_move_data(cache, symbols_needed)

        result = detect_laggard_multi_group(
            symbol=sym,
            symbol_move_1d=float(move_1d),
            symbol_move_5d=float(move_5d),
            symbol_vol_ratio=vol_ratio,
            technical_structure=structure,
            news_clean=news_clean,
            has_earnings_risk=has_earnings_risk,
            groups=static_groups,
            peer_move_data=peer_move_data,
            dynamic_peer_groups=dynamic_groups,
        )
        if result is None:
            return None

        ctx = build_laggard_context(
            symbol=sym,
            group=_group_for_result(static_groups, dynamic_groups, result),
            symbol_move_1d=float(move_1d),
            symbol_move_5d=float(move_5d),
            symbol_vol_ratio=vol_ratio,
            technical_structure=structure,
            news_clean=news_clean,
            has_earnings_risk=has_earnings_risk,
            peer_move_data=peer_move_data,
        )
        narrative = build_narrative(ctx, result)
        return _serialize_signal(
            sym,
            ctx,
            result,
            narrative,
            news_clean=news_clean,
            has_earnings_risk=has_earnings_risk,
            technical_structure=structure,
        )
    except Exception as exc:
        _LOG.warning("compute_laggard_signal_failed symbol=%s err=%s", symbol, type(exc).__name__)
        return None


def _group_for_result(
    static_groups: list[SectorPeerGroup],
    dynamic_groups: list[SectorPeerGroup],
    result: LaggardResult,
) -> SectorPeerGroup:
    """Pick peer group row matching the winning detection (for narrative context)."""
    for group in (*static_groups, *dynamic_groups):
        if group.sector_name == result.group_name:
            return group
        if group.registry_key.startswith("dynamic_") and result.driver_type == "dynamic_cluster":
            if result.group_name == group.sector_name:
                return group
    if static_groups:
        return static_groups[0]
    if dynamic_groups:
        return dynamic_groups[0]
    spy_groups = get_all_peer_groups("SPY")
    if spy_groups:
        return spy_groups[0]
    return next(iter(_PEER_GROUPS.values()))
