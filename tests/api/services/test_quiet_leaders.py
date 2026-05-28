"""Quiet leaders funnel — low-velocity structure screen."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.api.services.opportunity_desk.funnel import FunnelMover
from stocvest.api.services.opportunity_desk.quiet_leaders import (
    QuietLeadersConfig,
    passes_quiet_leader_technical,
    select_quiet_leader_snapshots,
)
from stocvest.data.models import Snapshot
from stocvest.signals.swing_technical_analyzer import SwingTechnicalLayerResult


def test_select_quiet_leader_snapshots_excludes_movers_and_high_gap() -> None:
    snaps = [
        Snapshot(
            symbol="MRVL",
            last_trade_price=101.0,
            prev_close=100.0,
            day_volume=2_000_000.0,
            prev_day_volume=2_000_000.0,
        ),
        Snapshot(
            symbol="HOT",
            last_trade_price=110.0,
            prev_close=100.0,
            day_volume=2_000_000.0,
            prev_day_volume=2_000_000.0,
        ),
    ]
    exclude = {"HOT"}
    picked = select_quiet_leader_snapshots(snaps, exclude_symbols=exclude, config=QuietLeadersConfig())
    assert len(picked) == 1
    assert picked[0][0].symbol == "MRVL"
    assert abs(picked[0][1]) < 2.0


def test_passes_quiet_leader_technical() -> None:
    result = SwingTechnicalLayerResult(
        status="available",
        score=62,
        verdict="bullish",
        sma50=90.0,
        sma200=80.0,
        daily_rsi=58.0,
    )
    assert passes_quiet_leader_technical(result, last_price=100.0, config=QuietLeadersConfig()) is True


def test_passes_quiet_leader_technical_rejects_extended_rsi() -> None:
    result = SwingTechnicalLayerResult(
        status="available",
        score=70,
        verdict="bullish",
        sma50=90.0,
        sma200=80.0,
        daily_rsi=72.0,
    )
    assert passes_quiet_leader_technical(result, last_price=100.0, config=QuietLeadersConfig()) is False
