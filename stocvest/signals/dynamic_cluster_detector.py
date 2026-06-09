"""
Dynamic cluster detection — emerging leaders and correlated movers (Chunk 4B).

Universe = symbols warmed in PriceCache (registry + watchlists), not full market.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from stocvest.data.market_context_flags import resolve_market_context_flags
from stocvest.data.sector_peer_registry import PeerGroupType, SectorPeerGroup, is_etf
from stocvest.utils.logging import get_logger

if TYPE_CHECKING:
    from stocvest.data.price_cache import PriceCache

_LOG = get_logger(__name__)

_MIN_STD_FLOOR = 0.1
_VOLUME_ZSCALE = 0.5
_OVERLAP_DEDUPE_RATIO = 0.70


@dataclass(frozen=True)
class DynamicCluster:
    leader_symbol: str
    leader_move_1d: float
    leader_dominance_score: float
    cluster_symbols: tuple[str, ...]
    cluster_direction: str
    cluster_size: int
    is_ipo_mode: bool
    driver_label: str


def _robust_spread(values: list[float]) -> float:
    """Std with IQR fallback when dispersion is near zero."""
    if len(values) < 2:
        return _MIN_STD_FLOOR
    st = statistics.pstdev(values)
    if st >= _MIN_STD_FLOOR:
        return st
    try:
        q1, _, q3 = statistics.quantiles(values, n=4, method="inclusive")
        iqr = float(q3 - q1)
        if iqr > 0:
            return max(_MIN_STD_FLOOR, iqr / 1.35)
    except statistics.StatisticsError:
        pass
    return _MIN_STD_FLOOR


def compute_universe_stats(
    cached_symbols: list[str],
    price_cache: PriceCache,
) -> dict[str, Any]:
    """
    Universe-wide move/volume stats for z-scoring.

    Skips symbols without 1d move. Uses median-centered robust spread.
    """
    moves_1d: list[float] = []
    vol_ratios: list[float] = []
    symbol_moves: dict[str, float] = {}

    for sym in cached_symbols:
        su = (sym or "").strip().upper()
        if not su or is_etf(su):
            continue
        move = price_cache.get_1d_change(su)
        if move is None:
            move = price_cache.get_5d_change(su)
        if move is None:
            continue
        vol = price_cache.get_volume_ratio(su)
        moves_1d.append(float(move))
        vol_ratios.append(float(vol))
        symbol_moves[su] = float(move)

    if not moves_1d:
        return {
            "mean_move_1d": 0.0,
            "std_move_1d": _MIN_STD_FLOOR,
            "mean_vol_ratio": 1.0,
            "std_vol_ratio": _VOLUME_ZSCALE,
            "symbol_moves": {},
        }

    mean_move = statistics.median(moves_1d)
    std_move = _robust_spread(moves_1d)
    mean_vol = statistics.median(vol_ratios) if vol_ratios else 1.0
    std_vol = _robust_spread(vol_ratios) if len(vol_ratios) > 1 else _VOLUME_ZSCALE

    return {
        "mean_move_1d": mean_move,
        "std_move_1d": std_move,
        "mean_vol_ratio": mean_vol,
        "std_vol_ratio": max(_VOLUME_ZSCALE, std_vol),
        "symbol_moves": symbol_moves,
    }


def compute_dominance_score(
    symbol: str,
    move_1d: float,
    vol_ratio: float,
    universe_stats: dict[str, Any],
) -> float:
    """
    dominance_score = move_1d_z * 0.5 + volume_z * 0.3 (vs_peers in Chunk 4B spec = 0 here).
    """
    _ = symbol
    mean_move = float(universe_stats.get("mean_move_1d", 0.0))
    std_move = max(_MIN_STD_FLOOR, float(universe_stats.get("std_move_1d", _MIN_STD_FLOOR)))
    move_z = (float(move_1d) - mean_move) / std_move

    vol_z = (float(vol_ratio) - 1.0) / _VOLUME_ZSCALE
    return move_z * 0.5 + vol_z * 0.3


def detect_emerging_leaders(
    universe_stats: dict[str, Any],
    price_cache: PriceCache,
    min_dominance_score: float = 2.0,
) -> list[str]:
    """Symbols with dominance_score > threshold, sorted DESC by score."""
    symbol_moves: dict[str, float] = universe_stats.get("symbol_moves") or {}
    scored: list[tuple[str, float]] = []
    for sym, move in symbol_moves.items():
        vol = price_cache.get_volume_ratio(sym)
        score = compute_dominance_score(sym, move, vol, universe_stats)
        if score > min_dominance_score:
            scored.append((sym, score))
    scored.sort(key=lambda x: x[1], reverse=True)
    return [s for s, _ in scored]


def leader_is_ipo_mode(leader: str) -> bool:
    """True when the cluster leader is an unseasoned listing or in an index-inclusion window."""
    sym = leader.strip().upper()
    if not sym:
        return False
    flags = resolve_market_context_flags(sym, reference=None)
    if flags.get("ipo_unseasoned") or flags.get("index_inclusion_window"):
        return True
    return flags.get("ecosystem_role") == "listed_issuer"


def build_cluster_around_leader(
    leader: str,
    leader_move_1d: float,
    universe_stats: dict[str, Any],
    *,
    min_correlation_pct: float = 0.50,
    min_cluster_size: int = 3,
    is_ipo_mode: bool = False,
) -> DynamicCluster | None:
    """
  Find symbols moving in the same direction with move >= 50% of leader magnitude.
    """
    sym = leader.strip().upper()
    symbol_moves: dict[str, float] = dict(universe_stats.get("symbol_moves") or {})
    if sym not in symbol_moves:
        return None

    direction = "up" if leader_move_1d > 0 else "down"
    threshold = abs(leader_move_1d) * min_correlation_pct
    members: list[str] = [sym]

    for other, move in symbol_moves.items():
        if other == sym:
            continue
        if direction == "up" and move <= 0:
            continue
        if direction == "down" and move >= 0:
            continue
        if abs(move) >= threshold:
            members.append(other)

    if len(members) < min_cluster_size:
        return None

    vol = 1.0  # leader vol filled by caller path in detect_all
    dominance = compute_dominance_score(sym, leader_move_1d, vol, universe_stats)
    label = f"Dynamic cluster: {sym} driving {len(members)} stocks"

    return DynamicCluster(
        leader_symbol=sym,
        leader_move_1d=leader_move_1d,
        leader_dominance_score=dominance,
        cluster_symbols=tuple(sorted(set(members))),
        cluster_direction=direction,
        cluster_size=len(members),
        is_ipo_mode=is_ipo_mode,
        driver_label=label,
    )


def _overlap_ratio(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / min(len(a), len(b))


def _dedupe_clusters(clusters: list[DynamicCluster]) -> list[DynamicCluster]:
    if len(clusters) <= 1:
        return clusters
    ranked = sorted(clusters, key=lambda c: c.leader_dominance_score, reverse=True)
    kept: list[DynamicCluster] = []
    for cluster in ranked:
        sym_set = set(cluster.cluster_symbols)
        if any(_overlap_ratio(sym_set, set(k.cluster_symbols)) > _OVERLAP_DEDUPE_RATIO for k in kept):
            continue
        kept.append(cluster)
    return kept


def detect_all_dynamic_clusters(
    price_cache: PriceCache,
    min_dominance_score: float = 2.0,
    min_cluster_size: int = 3,
) -> list[DynamicCluster]:
    """
    Full pipeline: universe stats → emerging leaders → clusters → dedupe.

    Never raises.
    """
    try:
        symbols = price_cache.list_cached_symbols()
        if not symbols:
            return []
        stats = compute_universe_stats(symbols, price_cache)
        if not stats.get("symbol_moves"):
            return []

        leaders = detect_emerging_leaders(stats, price_cache, min_dominance_score=min_dominance_score)
        clusters: list[DynamicCluster] = []
        for leader in leaders:
            move = float(stats["symbol_moves"][leader])
            cluster = build_cluster_around_leader(
                leader,
                move,
                stats,
                min_cluster_size=min_cluster_size,
                is_ipo_mode=leader_is_ipo_mode(leader),
            )
            if cluster is not None:
                vol = price_cache.get_volume_ratio(leader)
                dominance = compute_dominance_score(leader, move, vol, stats)
                clusters.append(
                    DynamicCluster(
                        leader_symbol=cluster.leader_symbol,
                        leader_move_1d=cluster.leader_move_1d,
                        leader_dominance_score=dominance,
                        cluster_symbols=cluster.cluster_symbols,
                        cluster_direction=cluster.cluster_direction,
                        cluster_size=cluster.cluster_size,
                        is_ipo_mode=cluster.is_ipo_mode,
                        driver_label=cluster.driver_label,
                    )
                )
        return _dedupe_clusters(clusters)
    except Exception as exc:
        _LOG.warning("detect_all_dynamic_clusters_failed err=%s", type(exc).__name__)
        return []


def clusters_to_peer_groups(clusters: list[DynamicCluster]) -> list[SectorPeerGroup]:
    """Convert dynamic clusters to SectorPeerGroup for detect_laggard_multi_group."""
    out: list[SectorPeerGroup] = []
    for cluster in clusters:
        min_peers = min(3, max(1, cluster.cluster_size - 1))
        out.append(
            SectorPeerGroup(
                sector_name=cluster.driver_label,
                group_type=PeerGroupType.THEME,
                primary_etf=None,
                peers=cluster.cluster_symbols,
                min_peers_for_signal=min_peers,
                requires_etf_confirmation=False,
                registry_key=f"dynamic_{cluster.leader_symbol.lower()}",
            )
        )
    return out
