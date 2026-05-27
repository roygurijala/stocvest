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
