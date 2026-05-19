"""
Laggard detection — pure functions (Chunk 4A). No I/O.

Answers: "What should have moved but hasn't?" Display context only; never gating.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from stocvest.data.sector_peer_registry import (
    PeerGroupType,
    SectorPeerGroup,
    get_lag_threshold,
    is_etf,
)

_SECTOR_PEER_MOVE_1D = 0.8
_NON_SECTOR_PEER_MOVE_1D = 1.0
_ETF_MOVE_MIN_1D = 0.8
_CROSS_GROUP_BONUS = 10.0
_SCORE_CAP = 100.0


class LaggardType(str, Enum):
    CATCH_UP = "catch_up"
    PRE_BREAKOUT = "pre_breakout"
    DISTRIBUTION = "distribution"
    NOT_A_LAGGARD = "not_a_laggard"


@dataclass(frozen=True)
class PeerMove:
    symbol: str
    pct_change_1d: float
    pct_change_5d: float
    volume_ratio: float
    is_etf: bool = False


@dataclass(frozen=True)
class LaggardContext:
    symbol: str
    symbol_move_1d: float
    symbol_move_5d: float
    symbol_vol_ratio: float
    technical_structure: str
    news_clean: bool
    has_earnings_risk: bool
    etf_move_1d: float
    etf_move_5d: float
    peer_moves: tuple[PeerMove, ...]
    sector_name: str
    sector_etf: str | None
    group_type: PeerGroupType
    requires_etf_confirmation: bool
    lag_threshold: float
    min_peers_for_signal: int
    trigger_entity: str | None = None
    registry_key: str = ""


@dataclass(frozen=True)
class LaggardResult:
    laggard_type: LaggardType
    confidence: str
    laggard_score: float
    avg_peer_move_1d: float
    avg_peer_move_5d: float
    lag_vs_peers_1d: float
    lag_vs_peers_5d: float
    lag_vs_etf_1d: float
    peers_moving: tuple[PeerMove, ...]
    volume_pattern: str
    driver_type: str
    group_name: str
    trigger_entity: str | None
    qualified_groups: int = 1


def _driver_type(group_type: PeerGroupType, registry_key: str = "") -> str:
    if (registry_key or "").startswith("dynamic_"):
        return "dynamic_cluster"
    return group_type.value


def _peer_confirm_threshold(ctx: LaggardContext) -> float:
    return _SECTOR_PEER_MOVE_1D if ctx.requires_etf_confirmation else _NON_SECTOR_PEER_MOVE_1D


def _peers_for_group(ctx: LaggardContext) -> list[PeerMove]:
    sym = ctx.symbol.strip().upper()
    out: list[PeerMove] = []
    for p in ctx.peer_moves:
        ps = p.symbol.strip().upper()
        if ps == sym or is_etf(ps):
            continue
        out.append(p)
    return out


def _confirming_peers(ctx: LaggardContext) -> list[PeerMove]:
    thresh = _peer_confirm_threshold(ctx)
    return [p for p in _peers_for_group(ctx) if p.pct_change_1d >= thresh]


def _avg(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _compute_volume_pattern(vol_ratio: float, move_1d: float) -> str:
    if vol_ratio < 0.8 and move_1d >= -0.3:
        return "accumulating"
    if vol_ratio > 1.3 and move_1d <= 0.3:
        return "distributing"
    return "neutral"


def _classify_laggard(
    sym_move_1d: float,
    sym_move_5d: float,
    lag_vs_peers_5d: float,
    sym_vol_ratio: float,
    technical_structure: str,
) -> LaggardType:
    structure = (technical_structure or "unknown").strip().lower()

    if (
        sym_move_1d < 0.0
        or (sym_vol_ratio > 1.3 and sym_move_1d < 0.3)
        or structure == "weak"
    ):
        return LaggardType.DISTRIBUTION

    if (
        abs(sym_move_1d) < 0.5
        and lag_vs_peers_5d > 3.0
        and sym_vol_ratio < 0.8
        and structure == "intact"
    ):
        return LaggardType.PRE_BREAKOUT

    if (
        sym_move_1d < 0.5
        and lag_vs_peers_5d > 2.0
        and sym_vol_ratio < 1.3
        and structure in ("intact", "unknown")
    ):
        return LaggardType.CATCH_UP

    return LaggardType.NOT_A_LAGGARD


def _compute_confidence(
    *,
    lag_vs_peers_1d: float,
    lag_vs_peers_5d: float,
    peers_confirming: int,
    technical_structure: str,
    volume_pattern: str,
    laggard_type: LaggardType,
    group_type: PeerGroupType,
) -> tuple[str, float]:
    score = 0.0
    if lag_vs_peers_1d >= 3.0:
        score += 30.0
    elif lag_vs_peers_1d >= 2.0:
        score += 20.0
    elif lag_vs_peers_1d >= 1.5:
        score += 10.0

    if lag_vs_peers_5d >= 4.0:
        score += 20.0
    elif lag_vs_peers_5d >= 2.0:
        score += 10.0

    if peers_confirming >= 5:
        score += 20.0
    elif peers_confirming >= 3:
        score += 12.0
    elif peers_confirming >= 2:
        score += 6.0

    structure = (technical_structure or "unknown").strip().lower()
    if structure == "intact":
        score += 15.0
    elif structure == "unknown":
        score += 7.0

    if laggard_type in (LaggardType.CATCH_UP, LaggardType.PRE_BREAKOUT) and volume_pattern == "accumulating":
        score += 15.0
    elif laggard_type == LaggardType.DISTRIBUTION and volume_pattern == "distributing":
        score += 15.0
    else:
        score += 5.0

    if group_type == PeerGroupType.PRE_IPO_PROXY:
        score += 5.0

    score = min(_SCORE_CAP, score)
    if score >= 70.0:
        band = "high"
    elif score >= 45.0:
        band = "medium"
    else:
        band = "low"
    return band, score


def detect_laggard(ctx: LaggardContext) -> LaggardResult | None:
    """
    Detect laggard in one group context. Returns None when gates fail or no signal.
    """
    if not ctx.news_clean or ctx.has_earnings_risk:
        return None

    if ctx.requires_etf_confirmation and ctx.etf_move_1d < _ETF_MOVE_MIN_1D:
        return None

    confirming = _confirming_peers(ctx)
    if len(confirming) < ctx.min_peers_for_signal:
        return None

    avg_1d = _avg([p.pct_change_1d for p in confirming])
    avg_5d = _avg([p.pct_change_5d for p in confirming])
    lag_1d = avg_1d - ctx.symbol_move_1d
    if lag_1d < ctx.lag_threshold:
        return None

    lag_5d = avg_5d - ctx.symbol_move_5d
    lag_etf_1d = ctx.etf_move_1d - ctx.symbol_move_1d if ctx.sector_etf else 0.0
    volume_pattern = _compute_volume_pattern(ctx.symbol_vol_ratio, ctx.symbol_move_1d)
    laggard_type = _classify_laggard(
        ctx.symbol_move_1d,
        ctx.symbol_move_5d,
        lag_5d,
        ctx.symbol_vol_ratio,
        ctx.technical_structure,
    )
    if laggard_type == LaggardType.NOT_A_LAGGARD:
        return None

    confidence, laggard_score = _compute_confidence(
        lag_vs_peers_1d=lag_1d,
        lag_vs_peers_5d=lag_5d,
        peers_confirming=len(confirming),
        technical_structure=ctx.technical_structure,
        volume_pattern=volume_pattern,
        laggard_type=laggard_type,
        group_type=ctx.group_type,
    )

    return LaggardResult(
        laggard_type=laggard_type,
        confidence=confidence,
        laggard_score=laggard_score,
        avg_peer_move_1d=avg_1d,
        avg_peer_move_5d=avg_5d,
        lag_vs_peers_1d=lag_1d,
        lag_vs_peers_5d=lag_5d,
        lag_vs_etf_1d=lag_etf_1d,
        peers_moving=tuple(confirming),
        volume_pattern=volume_pattern,
        driver_type=_driver_type(ctx.group_type, ctx.registry_key),
        group_name=ctx.sector_name,
        trigger_entity=ctx.trigger_entity,
        qualified_groups=1,
    )


def build_laggard_context(
    *,
    symbol: str,
    group: SectorPeerGroup,
    symbol_move_1d: float,
    symbol_move_5d: float,
    symbol_vol_ratio: float,
    technical_structure: str,
    news_clean: bool,
    has_earnings_risk: bool,
    peer_move_data: dict[str, PeerMove],
    default_etf_move_1d: float = 0.0,
    default_etf_move_5d: float = 0.0,
) -> LaggardContext:
    """Assemble context for a static or dynamic (Chunk 4B) peer group."""
    sym = symbol.strip().upper()
    peer_list: list[PeerMove] = []
    for p_sym in group.peers:
        su = p_sym.strip().upper()
        if su in peer_move_data:
            peer_list.append(peer_move_data[su])
    etf_1d = default_etf_move_1d
    etf_5d = default_etf_move_5d
    if group.primary_etf:
        etf_key = group.primary_etf.strip().upper()
        em = peer_move_data.get(etf_key)
        if em is not None:
            etf_1d = em.pct_change_1d
            etf_5d = em.pct_change_5d
    return LaggardContext(
        symbol=sym,
        symbol_move_1d=symbol_move_1d,
        symbol_move_5d=symbol_move_5d,
        symbol_vol_ratio=symbol_vol_ratio,
        technical_structure=technical_structure,
        news_clean=news_clean,
        has_earnings_risk=has_earnings_risk,
        etf_move_1d=etf_1d,
        etf_move_5d=etf_5d,
        peer_moves=tuple(peer_list),
        sector_name=group.sector_name,
        sector_etf=group.primary_etf,
        group_type=group.group_type,
        requires_etf_confirmation=group.requires_etf_confirmation,
        lag_threshold=get_lag_threshold(group, sym),
        min_peers_for_signal=group.min_peers_for_signal,
        trigger_entity=group.trigger_entity,
        registry_key=group.registry_key,
    )


def detect_laggard_multi_group(
    symbol: str,
    symbol_move_1d: float,
    symbol_move_5d: float,
    symbol_vol_ratio: float,
    technical_structure: str,
    news_clean: bool,
    has_earnings_risk: bool,
    groups: list[SectorPeerGroup],
    peer_move_data: dict[str, PeerMove],
    dynamic_peer_groups: list[SectorPeerGroup] | None = None,
) -> LaggardResult | None:
    """
    Evaluate all groups (and optional dynamic cluster pseudo-groups). Highest score wins.
    +10 bonus when 2+ groups qualify (flat, capped at 100).
    """
    all_groups = [*groups, *(dynamic_peer_groups or [])]
    qualified: list[LaggardResult] = []
    for group in all_groups:
        ctx = build_laggard_context(
            symbol=symbol,
            group=group,
            symbol_move_1d=symbol_move_1d,
            symbol_move_5d=symbol_move_5d,
            symbol_vol_ratio=symbol_vol_ratio,
            technical_structure=technical_structure,
            news_clean=news_clean,
            has_earnings_risk=has_earnings_risk,
            peer_move_data=peer_move_data,
        )
        hit = detect_laggard(ctx)
        if hit is not None:
            qualified.append(hit)

    if not qualified:
        return None

    best = max(qualified, key=lambda r: r.laggard_score)
    count = len(qualified)
    bonus = _CROSS_GROUP_BONUS if count >= 2 else 0.0
    score = min(_SCORE_CAP, best.laggard_score + bonus)
    return LaggardResult(
        laggard_type=best.laggard_type,
        confidence=best.confidence,
        laggard_score=score,
        avg_peer_move_1d=best.avg_peer_move_1d,
        avg_peer_move_5d=best.avg_peer_move_5d,
        lag_vs_peers_1d=best.lag_vs_peers_1d,
        lag_vs_peers_5d=best.lag_vs_peers_5d,
        lag_vs_etf_1d=best.lag_vs_etf_1d,
        peers_moving=best.peers_moving,
        volume_pattern=best.volume_pattern,
        driver_type=best.driver_type,
        group_name=best.group_name,
        trigger_entity=best.trigger_entity,
        qualified_groups=count,
    )
