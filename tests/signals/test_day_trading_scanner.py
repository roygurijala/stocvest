from __future__ import annotations

import pytest

from stocvest.data.models import Snapshot
from stocvest.signals.day_trading_scanner import PremarketGapScanner


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
