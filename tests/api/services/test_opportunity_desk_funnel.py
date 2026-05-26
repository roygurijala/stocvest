"""Unit tests for Opportunity Desk snapshot funnel (Steps 2–3)."""

from __future__ import annotations

from stocvest.api.services.opportunity_desk.funnel import (
    OpportunityDeskFunnelConfig,
    diff_desk_snapshots,
    run_snapshot_funnel,
)
from stocvest.data.models import Snapshot


def _snap(
    symbol: str,
    *,
    last: float,
    prev: float,
    day_vol: float = 2_000_000.0,
    prev_vol: float = 2_000_000.0,
) -> Snapshot:
    return Snapshot(
        symbol=symbol,
        last_trade_price=last,
        prev_close=prev,
        day_volume=day_vol,
        prev_day_volume=prev_vol,
    )


def test_run_snapshot_funnel_ranks_by_abs_gap_and_caps_survivors() -> None:
    snaps = [
        _snap("LOW", last=10.0, prev=10.0),  # 0% gap — filtered
        _snap("AAA", last=110.0, prev=100.0),  # +10%
        _snap("BBB", last=95.0, prev=100.0),  # -5%
        _snap("CCC", last=103.0, prev=100.0),  # +3%
    ]
    cfg = OpportunityDeskFunnelConfig(survivor_limit=2, discovery_display_limit=15)
    result = run_snapshot_funnel(snaps, cfg)

    assert result.scanned_snapshot_count == 4
    assert result.eligible_symbol_count == 3
    assert [m.symbol for m in result.movers] == ["AAA", "BBB"]
    assert result.movers[0].gap_percent == 10.0
    assert result.movers[0].direction == "up"
    assert result.discovery_symbols == ("AAA", "BBB")


def test_run_snapshot_funnel_respects_liquidity_gates() -> None:
    snaps = [
        _snap("CHEAP", last=4.0, prev=3.8),  # below min_trade_price
        _snap("LOWVOL", last=110.0, prev=100.0, day_vol=100_000.0),
        _snap("LOWADV", last=110.0, prev=100.0, prev_vol=500_000.0),
        _snap("OK", last=110.0, prev=100.0),
    ]
    result = run_snapshot_funnel(snaps, OpportunityDeskFunnelConfig())

    assert result.eligible_symbol_count == 1
    assert [m.symbol for m in result.movers] == ["OK"]


def test_diff_desk_snapshots_added_dropped_retained() -> None:
    diff = diff_desk_snapshots(
        ["SPY", "MU", "NVDA"],
        ["MU", "AMD", "NVDA"],
    )
    assert diff.added == ("AMD",)
    assert diff.dropped == ("SPY",)
    assert diff.retained == ("MU", "NVDA")


def test_diff_desk_snapshots_normalizes_case() -> None:
    diff = diff_desk_snapshots(["mu"], ["MU"])
    assert diff.added == ()
    assert diff.dropped == ()
    assert diff.retained == ("MU",)
