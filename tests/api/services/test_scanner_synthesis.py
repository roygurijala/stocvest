"""Tests for day-desk scanner synthesis (grouped rejections, near misses, market copy)."""

from __future__ import annotations

import pytest

from stocvest.api.services.scanner_synthesis import (
    build_scanner_synthesis,
    synthesis_to_api_dict,
)


def make_rejection(
    symbol: str,
    reason_type: str = "session_volume",
    pct_below: float = 80.0,
) -> dict:
    gate = {
        "session_volume": "session_volume",
        "liquidity": "liquidity",
        "structure": "score_floor",
    }.get(reason_type, reason_type)
    return {
        "symbol": symbol,
        "desk": "day",
        "gate": gate,
        "reason_type": reason_type,
        "reason_label": reason_type.replace("_", " ").title(),
        "reason_detail": f"Volume {pct_below}% below pace",
        "pct_below_threshold": pct_below,
        "margin_pct": pct_below,
        "detail": f"Volume {pct_below}% below pace",
    }


def test_all_session_volume_classified_correctly():
    rejections = [make_rejection(sym, pct_below=70.0 + i) for i, sym in enumerate(
        ["SPY", "SOFI", "QQQ", "NFLX", "TSLA", "INTC", "NVDA", "AMZN", "AAPL", "MSFT"]
    )]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    assert len(synthesis.session_volume_rejections) == 10
    assert len(synthesis.liquidity_rejections) == 0


def test_liquidity_classified_separately():
    rejections = [
        make_rejection("SPY", pct_below=68.0),
        make_rejection("WARP", reason_type="liquidity", pct_below=0),
        make_rejection("CCM", reason_type="liquidity", pct_below=0),
    ]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    assert len(synthesis.session_volume_rejections) == 1
    assert len(synthesis.liquidity_rejections) == 2
    assert all(nm.symbol == "SPY" for nm in synthesis.near_misses) or synthesis.near_misses[0].symbol == "SPY"


def test_near_misses_max_3():
    rejections = [make_rejection(sym, pct_below=50.0 + i * 3) for i, sym in enumerate(
        ["SPY", "SOFI", "QQQ", "NFLX", "TSLA", "INTC", "NVDA", "AMZN", "AAPL", "MSFT"]
    )]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    assert len(synthesis.near_misses) <= 3


def test_near_misses_sorted_by_pct_of_needed_desc():
    rejections = [
        make_rejection("A", pct_below=83.0),
        make_rejection("B", pct_below=75.0),
        make_rejection("C", pct_below=68.0),
    ]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    assert synthesis.near_misses[0].pct_of_needed == pytest.approx(32.0)
    assert synthesis.near_misses[0].symbol == "C"


def test_market_proxy_flagged():
    rejections = [
        make_rejection("SPY", pct_below=68.0),
        make_rejection("QQQ", pct_below=70.0),
        make_rejection("NVDA", pct_below=80.0),
    ]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    by_sym = {nm.symbol: nm for nm in synthesis.near_misses}
    assert by_sym["SPY"].is_market_proxy is True
    assert by_sym["QQQ"].is_market_proxy is True
    assert by_sym.get("NVDA") is None or by_sym["NVDA"].is_market_proxy is False


def test_volume_context_none_when_no_session_volume():
    rejections = [
        make_rejection("WARP", reason_type="liquidity", pct_below=0),
    ]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    assert synthesis.volume_context is None


def test_volume_context_condition_label_low_participation():
    rejections = [make_rejection(sym, pct_below=72.0) for sym in ["SPY", "QQQ", "NVDA"]]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    assert synthesis.volume_context is not None
    assert synthesis.volume_context.market_condition_label == "Low participation"


def test_market_summary_not_empty():
    rejections = [make_rejection("SPY", pct_below=68.0)]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    assert len(synthesis.market_summary) > 20
    assert "%" in synthesis.market_summary


def test_what_would_change_not_empty():
    rejections = [make_rejection("SPY", pct_below=68.0)]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    assert len(synthesis.what_would_change) > 20


def test_session_volume_sorted_ascending_by_deficit():
    rejections = [
        make_rejection("A", pct_below=88.0),
        make_rejection("B", pct_below=74.0),
        make_rejection("C", pct_below=68.0),
        make_rejection("D", pct_below=83.0),
    ]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    api = synthesis_to_api_dict(synthesis)
    pcts = [row["pct_below"] for row in api["rejection_groups"]["session_volume"]]
    assert pcts == [68.0, 74.0, 83.0, 88.0]


def test_zero_qualified_handled():
    rejections = [make_rejection("SPY", pct_below=80.0)]
    synthesis = build_scanner_synthesis(
        rejections, qualified_count=0, session_time_et="11:24 AM"
    )
    assert synthesis.qualified_count == 0


def test_all_pass_no_rejections():
    synthesis = build_scanner_synthesis(
        [], qualified_count=2, session_time_et="11:24 AM"
    )
    assert synthesis.qualified_count == 2
    assert synthesis.near_misses == []
    assert len(synthesis.market_summary) > 10
