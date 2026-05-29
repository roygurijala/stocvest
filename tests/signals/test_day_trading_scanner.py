from __future__ import annotations

import pytest

from stocvest.data.models import Snapshot
from stocvest.signals.day_trading_scanner import (
    PremarketGapScanner,
    dynamic_gap_candidates_from_snapshots,
    dynamic_gap_candidates_from_snapshots_with_stats,
)


def snapshot(
    symbol: str,
    *,
    prev_close: float | None,
    pre_market_price: float | None,
    last_trade_price: float | None = None,
    day_volume: float | None = None,
) -> Snapshot:
    return Snapshot(
        symbol=symbol,
        prev_close=prev_close,
        pre_market_price=pre_market_price,
        last_trade_price=last_trade_price,
        day_volume=day_volume,
    )


@pytest.mark.unit
def test_scanner_detects_gap_above_threshold():
    scanner = PremarketGapScanner(min_abs_gap_percent=2.0)
    snaps = [
        snapshot("AAPL", prev_close=100.0, pre_market_price=104.0, day_volume=10_000_000),
        snapshot("MSFT", prev_close=200.0, pre_market_price=201.0, day_volume=8_000_000),
    ]

    results = scanner.scan_snapshots(snaps)
    assert len(results) == 1
    assert results[0].symbol == "AAPL"
    assert results[0].gap_percent == pytest.approx(4.0)


@pytest.mark.unit
def test_scanner_uses_last_trade_when_premarket_missing():
    scanner = PremarketGapScanner(min_abs_gap_percent=2.0)
    snaps = [
        snapshot("NVDA", prev_close=100.0, pre_market_price=None, last_trade_price=103.0, day_volume=5_000_000)
    ]

    results = scanner.scan_snapshots(snaps)
    assert len(results) == 1
    assert results[0].premarket_price == pytest.approx(103.0)


@pytest.mark.unit
def test_scanner_sorts_by_rank_score_desc():
    scanner = PremarketGapScanner(min_abs_gap_percent=2.0)
    snaps = [
        snapshot("AAA", prev_close=100.0, pre_market_price=104.0, day_volume=5_000_000),
        snapshot("BBB", prev_close=100.0, pre_market_price=106.0, day_volume=20_000_000),
    ]

    results = scanner.scan_snapshots(snaps)
    assert len(results) == 2
    assert results[0].symbol == "BBB"
    assert results[0].rank_score >= results[1].rank_score


@pytest.mark.unit
def test_scanner_applies_volume_filter_and_limit():
    scanner = PremarketGapScanner(min_abs_gap_percent=2.0, min_day_volume=10_000_000)
    snaps = [
        snapshot("A", prev_close=100.0, pre_market_price=103.0, day_volume=5_000_000),
        snapshot("B", prev_close=100.0, pre_market_price=105.0, day_volume=15_000_000),
        snapshot("C", prev_close=100.0, pre_market_price=107.0, day_volume=25_000_000),
    ]

    results = scanner.scan_snapshots(snaps, limit=1)
    assert len(results) == 1
    assert results[0].symbol == "C"


@pytest.mark.unit
def test_scanner_ignores_invalid_snapshot_inputs():
    scanner = PremarketGapScanner(min_abs_gap_percent=2.0)
    snaps = [
        snapshot("BAD1", prev_close=None, pre_market_price=101.0),
        snapshot("BAD2", prev_close=100.0, pre_market_price=None, last_trade_price=None),
        snapshot("BAD3", prev_close=0.0, pre_market_price=102.0),
    ]

    results = scanner.scan_snapshots(snaps)
    assert results == []


@pytest.mark.unit
def test_dynamic_gap_candidates_prefers_last_trade_then_open():
    snaps = [
        Snapshot(
            symbol="LAST",
            prev_close=100.0,
            last_trade_price=103.0,
            day_open=102.0,
            day_volume=600_000.0,
            prev_day_volume=2_000_000.0,
        ),
        Snapshot(
            symbol="OPENONLY",
            prev_close=100.0,
            last_trade_price=None,
            day_open=104.0,
            day_volume=600_000.0,
            prev_day_volume=2_000_000.0,
        ),
    ]
    out = dynamic_gap_candidates_from_snapshots(snaps, limit=10, min_abs_gap_percent=2.0)
    assert [c.symbol for c in out] == ["OPENONLY", "LAST"]
    assert out[0].gap_percent == pytest.approx(4.0)
    assert out[1].gap_percent == pytest.approx(3.0)


@pytest.mark.unit
def test_dynamic_gap_candidates_filters_penny_and_volume():
    snaps = [
        Snapshot(symbol="PENNY", prev_close=2.0, last_trade_price=2.2, day_volume=600_000.0),
        Snapshot(symbol="LOWVOL", prev_close=100.0, last_trade_price=110.0, day_volume=100_000.0),
        Snapshot(
            symbol="OK",
            prev_close=10.0,
            last_trade_price=11.0,
            day_volume=600_000.0,
            prev_day_volume=2_000_000.0,
        ),
    ]
    out = dynamic_gap_candidates_from_snapshots(snaps, limit=10, min_abs_gap_percent=2.0, min_day_volume=500_000.0)
    assert len(out) == 1
    assert out[0].symbol == "OK"


@pytest.mark.unit
def test_dynamic_gap_candidates_excludes_reverse_split_artifact():
    """QH-style unadjusted prev vs post-split price must not rank as a mover."""
    snaps = [
        Snapshot(
            symbol="QH",
            prev_close=0.094,
            last_trade_price=2.82,
            day_volume=600_000.0,
            prev_day_volume=2_000_000.0,
        ),
        Snapshot(
            symbol="OK",
            prev_close=100.0,
            last_trade_price=110.0,
            day_volume=600_000.0,
            prev_day_volume=2_000_000.0,
        ),
    ]
    out = dynamic_gap_candidates_from_snapshots(snaps, limit=10, min_abs_gap_percent=2.0)
    assert [c.symbol for c in out] == ["OK"]


@pytest.mark.unit
def test_dynamic_gap_candidates_with_stats_eligible_before_limit():
    snaps = [
        Snapshot(
            symbol="NOGAP",
            prev_close=100.0,
            last_trade_price=100.5,
            day_volume=600_000.0,
            prev_day_volume=2_000_000.0,
        ),
        Snapshot(
            symbol="YES",
            prev_close=100.0,
            last_trade_price=110.0,
            day_volume=600_000.0,
            prev_day_volume=2_000_000.0,
        ),
    ]
    res = dynamic_gap_candidates_from_snapshots_with_stats(
        snaps, limit=10, min_abs_gap_percent=2.0, min_day_volume=500_000.0
    )
    assert res.eligible_symbol_count == 1
    assert len(res.candidates) == 1
    assert res.candidates[0].symbol == "YES"


@pytest.mark.unit
def test_dynamic_gap_candidates_with_stats_eligible_can_exceed_returned_limit():
    snaps = [
        Snapshot(
            symbol=f"S{i}",
            prev_close=100.0,
            last_trade_price=110.0,
            day_volume=600_000.0,
            prev_day_volume=2_000_000.0,
        )
        for i in range(15)
    ]
    res = dynamic_gap_candidates_from_snapshots_with_stats(
        snaps, limit=5, min_abs_gap_percent=2.0, min_day_volume=500_000.0
    )
    assert res.eligible_symbol_count == 15
    assert len(res.candidates) == 5
