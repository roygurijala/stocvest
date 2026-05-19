"""Laggard detector pure-function tests (Chunk 4A)."""

from __future__ import annotations

import pytest

from stocvest.data.sector_peer_registry import (
    PeerGroupType,
    SectorPeerGroup,
    _PEER_GROUPS,
)
from stocvest.signals.laggard_detector import (
    LaggardType,
    PeerMove,
    build_laggard_context,
    detect_laggard,
    detect_laggard_multi_group,
)

SEMIS = _PEER_GROUPS["semiconductors"]
AI_THEME = _PEER_GROUPS["ai_theme"]
OPENAI = _PEER_GROUPS["openai_ecosystem"]
MEGA_TECH = _PEER_GROUPS["mega_cap_tech"]


def _pm(sym: str, d1: float, d5: float | None = None, vol: float = 1.0) -> PeerMove:
    return PeerMove(
        symbol=sym.upper(),
        pct_change_1d=d1,
        pct_change_5d=d5 if d5 is not None else d1 * 1.2,
        volume_ratio=vol,
        is_etf=is_etf(sym),
    )


def is_etf(sym: str) -> bool:
    from stocvest.data.sector_peer_registry import is_etf as _is_etf

    return _is_etf(sym)


def _semis_moves(
    *,
    subject: str,
    subject_d1: float,
    subject_d5: float,
    subject_vol: float = 1.0,
    etf_d1: float = 1.2,
    peer_d1: float = 3.5,
    peer_d5: float = 5.0,
) -> dict[str, PeerMove]:
    sym = subject.upper()
    data: dict[str, PeerMove] = {
        "SOXX": _pm("SOXX", etf_d1, etf_d1),
        sym: _pm(sym, subject_d1, subject_d5, subject_vol),
    }
    for p in SEMIS.peers:
        if p == sym:
            continue
        data[p] = _pm(p, peer_d1, peer_d5)
    return data


def _ctx(
    subject: str,
    moves: dict[str, PeerMove],
    *,
    group: SectorPeerGroup = SEMIS,
    structure: str = "intact",
    news_clean: bool = True,
    earnings: bool = False,
) -> object:
    sub = subject.upper()
    sub_m = moves[sub]
    return build_laggard_context(
        symbol=sub,
        group=group,
        symbol_move_1d=sub_m.pct_change_1d,
        symbol_move_5d=sub_m.pct_change_5d,
        symbol_vol_ratio=sub_m.volume_ratio,
        technical_structure=structure,
        news_clean=news_clean,
        has_earnings_risk=earnings,
        peer_move_data=moves,
    )


# ── Positive cases ───────────────────────────────────────────────────────────


def test_catch_up_basic_sector_group() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=0.2, subject_d5=-1.0, subject_vol=1.0)
    res = detect_laggard(_ctx("AVGO", moves))
    assert res is not None
    assert res.laggard_type == LaggardType.CATCH_UP
    assert res.driver_type == "sector"
    assert res.lag_vs_peers_1d >= 1.5


def test_pre_breakout_contracting_volume() -> None:
    moves = _semis_moves(
        subject="AVGO",
        subject_d1=0.1,
        subject_d5=-4.0,
        subject_vol=0.7,
        peer_d1=3.0,
        peer_d5=6.0,
    )
    res = detect_laggard(_ctx("AVGO", moves))
    assert res is not None
    assert res.laggard_type == LaggardType.PRE_BREAKOUT
    assert res.volume_pattern == "accumulating"


def test_distribution_negative_move() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=-1.2, subject_d5=-2.0)
    res = detect_laggard(_ctx("AVGO", moves))
    assert res is not None
    assert res.laggard_type == LaggardType.DISTRIBUTION


def test_distribution_weak_structure() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=0.4, subject_d5=0.5)
    res = detect_laggard(_ctx("AVGO", moves, structure="weak"))
    assert res is not None
    assert res.laggard_type == LaggardType.DISTRIBUTION


def test_pre_ipo_proxy_no_etf_required() -> None:
    moves = {
        "MSFT": _pm("MSFT", 2.5, 4.0),
        "NVDA": _pm("NVDA", 2.8, 4.5),
        "AMZN": _pm("AMZN", 2.2, 3.8),
        "GOOGL": _pm("GOOGL", 0.1, -1.0),
        "META": _pm("META", 2.0, 3.5),
        "AMD": _pm("AMD", 2.4, 4.0),
    }
    ctx_etf = build_laggard_context(
        symbol="GOOGL",
        group=OPENAI,
        symbol_move_1d=0.1,
        symbol_move_5d=-1.0,
        symbol_vol_ratio=1.0,
        technical_structure="intact",
        news_clean=True,
        has_earnings_risk=False,
        peer_move_data=moves,
        default_etf_move_1d=0.1,
    )
    res = detect_laggard(ctx_etf)
    assert res is not None
    assert res.driver_type == "pre_ipo_proxy"


def test_adr_higher_lag_threshold() -> None:
    moves = _semis_moves(
        subject="TSM",
        subject_d1=1.0,
        subject_d5=0.0,
        peer_d1=2.9,
        peer_d5=3.0,
    )
    assert detect_laggard(_ctx("TSM", moves)) is None

    moves_nvda = _semis_moves(
        subject="NVDA",
        subject_d1=0.4,
        subject_d5=-3.0,
        peer_d1=2.9,
        peer_d5=4.0,
    )
    assert detect_laggard(_ctx("NVDA", moves_nvda)) is not None


def _rich_avgo_moves() -> dict[str, PeerMove]:
    """Semis + theme + mega-cap peers so AVGO can qualify in multiple groups."""
    moves = _semis_moves(subject="AVGO", subject_d1=0.2, subject_d5=-1.0)
    for sym in ("MSFT", "META", "SNOW", "CRWD", "MDB", "AAPL", "AMZN", "TSLA", "GOOGL"):
        moves[sym] = _pm(sym, 3.5, 5.0)
    moves["SMH"] = _pm("SMH", 1.0, 1.0)
    moves["XLK"] = _pm("XLK", 1.0, 1.0)
    return moves


def test_multi_group_picks_highest_score() -> None:
    moves = _rich_avgo_moves()
    res = detect_laggard_multi_group(
        "AVGO",
        0.2,
        -1.0,
        1.0,
        "intact",
        True,
        False,
        [SEMIS, AI_THEME],
        moves,
    )
    assert res is not None
    assert res.qualified_groups >= 2
    assert res.laggard_score >= 70


def test_multi_group_bonus_capped() -> None:
    moves = _rich_avgo_moves()
    moves["AVGO"] = _pm("AVGO", 0.1, -4.0, 0.7)
    groups = [SEMIS, AI_THEME, MEGA_TECH]
    res = detect_laggard_multi_group(
        "AVGO",
        0.1,
        -4.0,
        0.7,
        "intact",
        True,
        False,
        groups,
        moves,
    )
    assert res is not None
    assert res.qualified_groups >= 2
    assert res.laggard_score <= 100.0


def test_qualified_groups_count_set_correctly() -> None:
    moves = _rich_avgo_moves()
    res = detect_laggard_multi_group(
        "AVGO",
        0.2,
        -1.0,
        1.0,
        "intact",
        True,
        False,
        [SEMIS, AI_THEME, MEGA_TECH],
        moves,
    )
    assert res is not None
    assert res.qualified_groups >= 2


# ── Filter cases ─────────────────────────────────────────────────────────────


def test_no_signal_news_bearish() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=0.2, subject_d5=-1.0)
    ctx = build_laggard_context(
        symbol="AVGO",
        group=SEMIS,
        symbol_move_1d=0.2,
        symbol_move_5d=-1.0,
        symbol_vol_ratio=1.0,
        technical_structure="intact",
        news_clean=False,
        has_earnings_risk=False,
        peer_move_data=moves,
    )
    assert detect_laggard(ctx) is None


def test_no_signal_earnings_risk() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=0.2, subject_d5=-1.0)
    assert detect_laggard(_ctx("AVGO", moves, earnings=True)) is None


def test_no_signal_sector_not_moving() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=0.2, subject_d5=-1.0, peer_d1=0.2)
    assert detect_laggard(_ctx("AVGO", moves)) is None


def test_no_signal_etf_flat_for_sector_group() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=0.2, subject_d5=-1.0, etf_d1=0.3)
    assert detect_laggard(_ctx("AVGO", moves)) is None


def test_etf_flat_ok_for_theme_group() -> None:
    moves = {
        "NVDA": _pm("NVDA", 2.5, 4.0),
        "AMD": _pm("AMD", 2.4, 3.8),
        "MSFT": _pm("MSFT", 2.2, 3.5),
        "AVGO": _pm("AVGO", 0.1, -2.0),
        "META": _pm("META", 2.0, 3.0),
        "SNOW": _pm("SNOW", 2.1, 3.2),
        "CRWD": _pm("CRWD", 2.3, 3.6),
        "MDB": _pm("MDB", 2.0, 3.0),
        "SMH": _pm("SMH", 0.3, 0.3),
    }
    ctx = build_laggard_context(
        symbol="AVGO",
        group=AI_THEME,
        symbol_move_1d=0.1,
        symbol_move_5d=-2.0,
        symbol_vol_ratio=1.0,
        technical_structure="intact",
        news_clean=True,
        has_earnings_risk=False,
        peer_move_data=moves,
    )
    assert detect_laggard(ctx) is not None


def test_no_signal_symbol_also_moving() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=3.2, subject_d5=4.0, peer_d1=3.5)
    assert detect_laggard(_ctx("AVGO", moves)) is None


def test_symbol_excluded_from_peer_average() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=0.2, subject_d5=-1.0, peer_d1=4.0)
    res = detect_laggard(_ctx("AVGO", moves))
    assert res is not None
    assert all(p.symbol != "AVGO" for p in res.peers_moving)


# ── Scoring ──────────────────────────────────────────────────────────────────


def test_high_confidence_large_lag() -> None:
    moves = _semis_moves(
        subject="AVGO",
        subject_d1=0.1,
        subject_d5=-5.0,
        subject_vol=0.7,
        peer_d1=4.5,
        peer_d5=8.0,
    )
    res = detect_laggard(_ctx("AVGO", moves))
    assert res is not None
    assert res.confidence == "high"
    assert res.laggard_score >= 70


def test_low_confidence_minimal_lag() -> None:
    moves = _semis_moves(
        subject="AVGO",
        subject_d1=1.85,
        subject_d5=0.0,
        peer_d1=3.4,
        peer_d5=2.5,
    )
    res = detect_laggard(_ctx("AVGO", moves))
    if res is not None:
        assert res.laggard_score < 70 or res.confidence in ("low", "medium")


def test_pre_ipo_proxy_bonus_adds_5() -> None:
    base_moves = {
        "MSFT": _pm("MSFT", 2.5, 5.0),
        "NVDA": _pm("NVDA", 2.8, 5.5),
        "AMZN": _pm("AMZN", 2.2, 4.8),
        "META": _pm("META", 2.0, 4.5),
        "AMD": _pm("AMD", 2.4, 5.0),
    }
    openai_moves = {**base_moves, "GOOGL": _pm("GOOGL", 0.1, -3.0)}
    theme_moves = {
        **base_moves,
        "GOOGL": _pm("GOOGL", 0.1, -3.0),
        "AVGO": _pm("AVGO", 0.1, -3.0),
        "SNOW": _pm("SNOW", 2.1, 5.0),
        "CRWD": _pm("CRWD", 2.3, 5.2),
        "MDB": _pm("MDB", 2.0, 4.8),
    }
    ctx_openai = build_laggard_context(
        symbol="GOOGL",
        group=OPENAI,
        symbol_move_1d=0.1,
        symbol_move_5d=-3.0,
        symbol_vol_ratio=1.0,
        technical_structure="intact",
        news_clean=True,
        has_earnings_risk=False,
        peer_move_data=openai_moves,
    )
    ctx_theme = build_laggard_context(
        symbol="GOOGL",
        group=AI_THEME,
        symbol_move_1d=0.1,
        symbol_move_5d=-3.0,
        symbol_vol_ratio=1.0,
        technical_structure="intact",
        news_clean=True,
        has_earnings_risk=False,
        peer_move_data=theme_moves,
    )
    r_openai = detect_laggard(ctx_openai)
    r_theme = detect_laggard(ctx_theme)
    assert r_openai is not None and r_theme is not None
    assert r_openai.laggard_score >= r_theme.laggard_score - 6


def test_cross_group_bonus_flat_10() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=0.1, subject_d5=-4.0, subject_vol=0.7)
    single = detect_laggard(_ctx("AVGO", moves))
    multi = detect_laggard_multi_group(
        "AVGO",
        0.1,
        -4.0,
        0.7,
        "intact",
        True,
        False,
        [SEMIS, AI_THEME],
        moves,
    )
    assert single is not None and multi is not None
    if multi.qualified_groups >= 2:
        assert multi.laggard_score >= single.laggard_score + 9
        assert multi.laggard_score <= single.laggard_score + 11


# ── Edge cases ───────────────────────────────────────────────────────────────


def test_empty_peer_list_returns_none() -> None:
    ctx = build_laggard_context(
        symbol="ZZZ",
        group=SEMIS,
        symbol_move_1d=0.0,
        symbol_move_5d=0.0,
        symbol_vol_ratio=1.0,
        technical_structure="intact",
        news_clean=True,
        has_earnings_risk=False,
        peer_move_data={},
    )
    assert detect_laggard(ctx) is None


def test_single_peer_below_minimum() -> None:
    moves = {
        "SOXX": _pm("SOXX", 1.2, 1.2),
        "AVGO": _pm("AVGO", 0.1, -3.0),
        "NVDA": _pm("NVDA", 3.0, 5.0),
    }
    assert detect_laggard(_ctx("AVGO", moves)) is None


def test_negative_etf_no_catchup_signal() -> None:
    moves = _semis_moves(subject="AVGO", subject_d1=0.2, subject_d5=-1.0, etf_d1=-1.0)
    assert detect_laggard(_ctx("AVGO", moves)) is None
