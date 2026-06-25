"""Ledger position monitor — snapshot batch shape."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import pytest

from stocvest.api.services.ledger_position_monitor import _snapshots_by_symbol, run_ledger_position_monitor
from stocvest.data.models import Snapshot


def test_snapshots_by_symbol_maps_list():
    snaps = [
        Snapshot(symbol="AAPL", last_trade_price=190.0, day_close=190.0),
        Snapshot(symbol="MSFT", last_trade_price=420.0, day_close=420.0),
    ]
    by_sym = _snapshots_by_symbol(snaps)
    assert set(by_sym) == {"AAPL", "MSFT"}
    assert by_sym["AAPL"].last_trade_price == 190.0


def test_snapshots_by_symbol_passes_through_dict():
    snap = Snapshot(symbol="TSLA", last_trade_price=250.0)
    assert _snapshots_by_symbol({"TSLA": snap})["TSLA"] is snap


@dataclass
class _OpenRow:
    signal_id: str
    symbol: str
    mode: str
    direction: str
    generated_at: datetime
    stop_level: float | None = None
    reference_structure_level: float | None = None
    regime_label_at_entry: str | None = None


class _FakeRecorder:
    def iter_open_validation_records(self):
        return [
            _OpenRow(
                signal_id="sig-1",
                symbol="AAPL",
                mode="swing",
                direction="bullish",
                generated_at=datetime(2026, 5, 1, 20, 0, tzinfo=timezone.utc),
                stop_level=180.0,
            )
        ]

    def close_validation_position(self, **kwargs):  # noqa: ANN003
        return True


class _FakePolygon:
    async def get_snapshots_many(self, symbols: list[str], *, chunk_size: int = 50) -> list[Snapshot]:
        return [Snapshot(symbol=sym, last_trade_price=185.0, day_close=185.0) for sym in symbols]

    async def get_snapshot(self, symbol: str) -> Snapshot:
        return Snapshot(symbol=symbol, last_trade_price=100.0, change_percent=0.1)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):  # noqa: ANN002
        return None


@pytest.mark.asyncio
async def test_run_ledger_position_monitor_accepts_snapshot_list(monkeypatch: pytest.MonkeyPatch):
    """Regression: get_snapshots_many returns list, not dict (was AttributeError on .get)."""

    async def _fake_regime(_client):  # noqa: ANN001
        return "neutral"

    monkeypatch.setattr(
        "stocvest.api.services.ledger_position_monitor._current_macro_regime",
        _fake_regime,
    )
    monkeypatch.setattr(
        "stocvest.api.services.ledger_position_monitor.is_swing_monitor_evaluation_window_et",
        lambda _now: True,
    )
    counts = await run_ledger_position_monitor(_FakePolygon(), _FakeRecorder())  # type: ignore[arg-type]
    assert counts["errors"] == 0
    assert counts["swing_closed"] == 1


class _Settings:
    def __init__(self, target_on: bool) -> None:
        self.stocvest_day_profit_target_exit_enabled = target_on


class _DayRecorder:
    def __init__(self) -> None:
        self.closed: list[dict] = []

    def iter_open_validation_records(self):
        return [
            _OpenRow(
                signal_id="day-1",
                symbol="AAPL",
                mode="day",
                direction="bullish",
                generated_at=datetime(2026, 6, 24, 15, 0, tzinfo=timezone.utc),
                stop_level=95.0,
                reference_structure_level=105.0,
            )
        ]

    def close_validation_position(self, **kwargs):  # noqa: ANN003
        self.closed.append(kwargs)
        return True


class _DayPolygon(_FakePolygon):
    async def get_snapshots_many(self, symbols: list[str], *, chunk_size: int = 50) -> list[Snapshot]:
        # last 106 >= target 105 (target reached); last > vwap 104 so NO vwap violation for a long.
        return [
            Snapshot(symbol=sym, last_trade_price=106.0, day_close=106.0, day_vwap=104.0, day_volume=1_000_000.0)
            for sym in symbols
        ]


def _patch_day_monitor(monkeypatch: pytest.MonkeyPatch, *, target_on: bool) -> None:
    async def _fake_regime(_client):  # noqa: ANN001
        return "neutral"

    monkeypatch.setattr(
        "stocvest.api.services.ledger_position_monitor._current_macro_regime", _fake_regime
    )
    monkeypatch.setattr(
        "stocvest.api.services.ledger_position_monitor.is_day_monitor_active_session_et",
        lambda _now: True,
    )
    monkeypatch.setattr(
        "stocvest.api.services.ledger_position_monitor.get_settings",
        lambda: _Settings(target_on),
    )


@pytest.mark.asyncio
async def test_day_profit_target_exit_fires_when_enabled(monkeypatch: pytest.MonkeyPatch):
    """Flag ON: last price at/through the reference target closes the row via day_profit_target."""
    _patch_day_monitor(monkeypatch, target_on=True)
    rec = _DayRecorder()
    counts = await run_ledger_position_monitor(_DayPolygon(), rec)  # type: ignore[arg-type]
    assert counts["day_closed"] == 1
    assert len(rec.closed) == 1
    assert rec.closed[0]["exit_rule"] == "day_profit_target"
    assert rec.closed[0]["exit_price"] == 106.0


@pytest.mark.asyncio
async def test_day_profit_target_exit_inert_when_disabled(monkeypatch: pytest.MonkeyPatch):
    """Flag OFF: identical inputs never close via day_profit_target (legacy behavior preserved)."""
    _patch_day_monitor(monkeypatch, target_on=False)
    rec = _DayRecorder()
    await run_ledger_position_monitor(_DayPolygon(), rec)  # type: ignore[arg-type]
    assert all(c.get("exit_rule") != "day_profit_target" for c in rec.closed)
