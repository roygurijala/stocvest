"""Laggard narrative tests (Chunk 5)."""

from __future__ import annotations

import itertools

import pytest

from stocvest.data.sector_peer_registry import (
    PeerGroupType,
    SectorPeerGroup,
    _PEER_GROUPS,
)
from stocvest.signals.laggard_detector import (
    LaggardContext,
    LaggardResult,
    LaggardType,
    PeerMove,
    build_laggard_context,
    detect_laggard,
)
from stocvest.signals.laggard_narrative import _validate_narrative, build_narrative

SEMIS = _PEER_GROUPS["semiconductors"]
OPENAI = _PEER_GROUPS["openai_ecosystem"]
AI_THEME = _PEER_GROUPS["ai_theme"]
RATE_MACRO = _PEER_GROUPS["rate_sensitive_growth"]


def _pm(sym: str, d1: float, d5: float | None = None, vol: float = 1.0) -> PeerMove:
    return PeerMove(symbol=sym.upper(), pct_change_1d=d1, pct_change_5d=d5 or d1 * 1.2, volume_ratio=vol)


def _semis_moves(subject: str, subject_d1: float, subject_d5: float, subject_vol: float = 1.0) -> dict[str, PeerMove]:
    sym = subject.upper()
    data: dict[str, PeerMove] = {"SOXX": _pm("SOXX", 1.2), sym: _pm(sym, subject_d1, subject_d5, subject_vol)}
    for p in SEMIS.peers:
        if p != sym:
            data[p] = _pm(p, 3.5, 5.0)
    return data


def _result_and_ctx(
    group: SectorPeerGroup,
    moves: dict[str, PeerMove],
    subject: str,
    *,
    structure: str = "intact",
) -> tuple[LaggardContext, LaggardResult]:
    sub = subject.upper()
    sub_m = moves[sub]
    ctx = build_laggard_context(
        symbol=sub,
        group=group,
        symbol_move_1d=sub_m.pct_change_1d,
        symbol_move_5d=sub_m.pct_change_5d,
        symbol_vol_ratio=sub_m.volume_ratio,
        technical_structure=structure,
        news_clean=True,
        has_earnings_risk=False,
        peer_move_data=moves,
    )
    res = detect_laggard(ctx)
    assert res is not None
    return ctx, res


def test_sector_narrative_mentions_sector_name() -> None:
    ctx, res = _result_and_ctx(SEMIS, _semis_moves("AVGO", 0.2, -1.0), "AVGO")
    n = build_narrative(ctx, res)
    assert "Semiconductor" in n.explanation or "Semiconductor" in n.driver_label
    assert res.driver_type == "sector"


def test_macro_narrative_no_sector_label() -> None:
    sym = "SNOW"
    moves = {sym: _pm(sym, 0.1, -0.5, 1.0)}
    for p in RATE_MACRO.peers:
        if p != sym:
            moves[p] = _pm(p, 2.5, 4.0)
    ctx, res = _result_and_ctx(RATE_MACRO, moves, sym)
    n = build_narrative(ctx, res)
    assert res.driver_type == "macro"
    assert "macro sector" not in n.explanation.lower()
    assert "rate-sensitive" in n.explanation.lower() or "Rate-sensitive" in n.driver_label


def test_pre_ipo_narrative_mentions_trigger_entity() -> None:
    sym = "MSFT"
    moves = {sym: _pm(sym, 0.15, -0.8)}
    for p in OPENAI.peers:
        if p != sym:
            moves[p] = _pm(p, 2.2, 3.0)
    ctx, res = _result_and_ctx(OPENAI, moves, sym)
    n = build_narrative(ctx, res)
    assert "OpenAI" in n.explanation
    assert res.driver_type == "pre_ipo_proxy"


def test_dynamic_cluster_narrative_uncertainty_language() -> None:
    dynamic = SectorPeerGroup(
        sector_name="Dynamic cluster: SPCX driving 3 stocks",
        group_type=PeerGroupType.THEME,
        primary_etf=None,
        peers=("SPCX", "RKLB", "ASTS", "AVGO"),
        min_peers_for_signal=2,
        requires_etf_confirmation=False,
        registry_key="dynamic_spcx",
    )
    moves = {
        "AVGO": _pm("AVGO", 0.2, -1.0, 1.0),
        "SPCX": _pm("SPCX", 8.0, 10.0),
        "RKLB": _pm("RKLB", 5.0, 6.0),
        "ASTS": _pm("ASTS", 4.0, 5.0),
    }
    ctx, res = _result_and_ctx(dynamic, moves, "AVGO")
    assert res.driver_type == "dynamic_cluster"
    n = build_narrative(ctx, res)
    lower = n.explanation.lower()
    assert "emerging" in lower or "cluster" in lower
    assert "sector forming" not in lower
    assert "new sector" not in lower


def test_all_summaries_under_60_chars() -> None:
    cases = [
        (SEMIS, "AVGO", 0.2, -1.0, 1.0, "intact"),
        (OPENAI, "MSFT", 0.15, -0.8, 1.0, "intact"),
        (AI_THEME, "SNOW", 0.1, -0.5, 0.7, "intact"),
        (RATE_MACRO, "NET", 0.1, -0.4, 1.0, "intact"),
    ]
    for group, sym, d1, d5, vol, structure in cases:
        moves = {sym: _pm(sym, d1, d5, vol)}
        for p in group.peers:
            if p != sym:
                moves[p] = _pm(p, 2.5, 4.0)
        if group.primary_etf:
            moves[group.primary_etf] = _pm(group.primary_etf, 1.2)
        ctx = build_laggard_context(
            symbol=sym,
            group=group,
            symbol_move_1d=d1,
            symbol_move_5d=d5,
            symbol_vol_ratio=vol,
            technical_structure=structure,
            news_clean=True,
            has_earnings_risk=False,
            peer_move_data=moves,
        )
        res = detect_laggard(ctx)
        if res is None:
            continue
        n = build_narrative(ctx, res)
        assert len(n.summary_line) <= 60


def test_no_forbidden_words_any_type() -> None:
    sym = "AVGO"
    moves = _semis_moves(sym, 0.2, -1.0)
    ctx, res = _result_and_ctx(SEMIS, moves, sym)
    for ltype in (LaggardType.CATCH_UP, LaggardType.PRE_BREAKOUT, LaggardType.DISTRIBUTION):
        forced = LaggardResult(
            laggard_type=ltype,
            confidence=res.confidence,
            laggard_score=res.laggard_score,
            avg_peer_move_1d=res.avg_peer_move_1d,
            avg_peer_move_5d=res.avg_peer_move_5d,
            lag_vs_peers_1d=res.lag_vs_peers_1d,
            lag_vs_peers_5d=res.lag_vs_peers_5d,
            lag_vs_etf_1d=res.lag_vs_etf_1d,
            peers_moving=res.peers_moving,
            volume_pattern=res.volume_pattern,
            driver_type=res.driver_type,
            group_name=res.group_name,
            trigger_entity=res.trigger_entity,
        )
        n = build_narrative(ctx, forced)
        _validate_narrative(n)


def test_what_to_watch_is_specific() -> None:
    ctx, res = _result_and_ctx(SEMIS, _semis_moves("AVGO", 0.2, -1.0), "AVGO")
    n = build_narrative(ctx, res)
    assert n.what_to_watch.strip().lower() not in {"watch the stock", "watch this stock"}


def test_distribution_not_framed_as_opportunity() -> None:
    moves = _semis_moves("AVGO", -0.8, -2.0, 1.5)
    ctx, res = _result_and_ctx(SEMIS, moves, "AVGO", structure="weak")
    assert res.laggard_type == LaggardType.DISTRIBUTION
    n = build_narrative(ctx, res)
    assert "opportunity" not in n.explanation.lower()


def test_catch_up_theme_manual_example_has_numbers() -> None:
    sym = "SNOW"
    moves = {sym: _pm(sym, 0.2, -1.0, 1.0)}
    for p in AI_THEME.peers:
        if p != sym:
            moves[p] = _pm(p, 3.0, 4.5)
    moves["SMH"] = _pm("SMH", 1.0)
    ctx, res = _result_and_ctx(AI_THEME, moves, sym)
    n = build_narrative(ctx, res)
    assert "%" in n.explanation
    assert res.laggard_type == LaggardType.CATCH_UP


@pytest.mark.parametrize(
    ("driver", "ltype"),
    [
        ("sector", LaggardType.CATCH_UP),
        ("pre_ipo_proxy", LaggardType.CATCH_UP),
        ("theme", LaggardType.PRE_BREAKOUT),
        ("macro", LaggardType.DISTRIBUTION),
        ("dynamic_cluster", LaggardType.CATCH_UP),
    ],
)
def test_validate_passes_representative_combos(driver: str, ltype: LaggardType) -> None:
    sector_name = (
        "Dynamic cluster: SPCX driving 3 stocks"
        if driver == "dynamic_cluster"
        else "Semiconductors"
    )
    ctx = LaggardContext(
        symbol="TEST",
        symbol_move_1d=0.2,
        symbol_move_5d=-1.0,
        symbol_vol_ratio=1.0,
        technical_structure="intact",
        news_clean=True,
        has_earnings_risk=False,
        etf_move_1d=1.2,
        etf_move_5d=1.0,
        peer_moves=(_pm("NVDA", 3.5),),
        sector_name=sector_name,
        sector_etf="SOXX" if driver == "sector" else None,
        group_type=PeerGroupType.SECTOR,
        requires_etf_confirmation=driver == "sector",
        lag_threshold=1.5,
        min_peers_for_signal=3,
        trigger_entity="OpenAI" if driver == "pre_ipo_proxy" else None,
        registry_key="dynamic_spcx" if driver == "dynamic_cluster" else "semiconductors",
    )
    result = LaggardResult(
        laggard_type=ltype,
        confidence="high",
        laggard_score=75.0,
        avg_peer_move_1d=3.2,
        avg_peer_move_5d=4.5,
        lag_vs_peers_1d=3.0,
        lag_vs_peers_5d=5.5,
        lag_vs_etf_1d=2.8,
        peers_moving=(_pm("NVDA", 4.1), _pm("AMD", 3.2)),
        volume_pattern="accumulating",
        driver_type=driver,
        group_name=(
            "Dynamic cluster: SPCX driving 3 stocks"
            if driver == "dynamic_cluster"
            else "Semiconductors"
        ),
        trigger_entity="OpenAI" if driver == "pre_ipo_proxy" else None,
    )
    n = build_narrative(ctx, result)
    _validate_narrative(n)


def test_combination_matrix_validates() -> None:
    drivers = ("sector", "index", "theme", "macro", "pre_ipo_proxy", "dynamic_cluster")
    types = (
        LaggardType.CATCH_UP,
        LaggardType.PRE_BREAKOUT,
        LaggardType.DISTRIBUTION,
    )
    for driver, ltype in itertools.product(drivers, types):
        test_validate_passes_representative_combos(driver, ltype)
