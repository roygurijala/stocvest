"""Opportunity Desk batch — funnel merge, recently hot, scheduled tier movers."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.api.services.opportunity_desk.batch import (
    build_recently_hot,
    run_opportunity_desk_batch,
)
from stocvest.api.services.opportunity_desk.discovery_row import (
    discovery_row_from_mover,
    execution_hint_from_composite,
)
from stocvest.api.services.opportunity_desk.funnel import FunnelMover
from stocvest.data.models import Snapshot


def test_execution_hint_blocks_low_rr_swing() -> None:
    hint = execution_hint_from_composite({"risk_reward": 0.5}, mode="swing")
    assert hint is not None
    assert "risk/reward" in hint.lower()


def test_build_recently_hot_tracks_dropped_symbols() -> None:
    now = datetime(2026, 5, 26, 15, 0, tzinfo=timezone.utc)
    mover = FunnelMover(
        symbol="MU",
        gap_percent=10.0,
        direction="up",
        rank_score=10.0,
        day_volume=2e6,
        session_price=110.0,
    )
    hot = build_recently_hot(
        previous_data={"discovery": [{"symbol": "MU"}, {"symbol": "NVDA"}]},
        discovery_rows=[{"symbol": "NVDA"}],
        movers_by_symbol={"MU": mover},
        now=now,
    )
    assert any(r["symbol"] == "MU" for r in hot)


@pytest.mark.asyncio
async def test_run_opportunity_desk_batch_movers_tier(monkeypatch: pytest.MonkeyPatch) -> None:
    snaps = [
        Snapshot(
            symbol="AAA",
            last_trade_price=110.0,
            prev_close=100.0,
            day_volume=2_000_000.0,
            prev_day_volume=2_000_000.0,
        )
    ]

    async def fake_load() -> tuple[list[Snapshot], str]:
        return snaps, "full_us"

    writes: list[tuple[str, dict]] = []
    recent_seen_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    def fake_write(key: str, data: dict, key_type: str, mode: str = "swing") -> bool:
        writes.append((key, data))
        return True

    monkeypatch.setattr(
        "stocvest.api.services.opportunity_desk.batch.load_us_equity_snapshots_for_funnel",
        fake_load,
    )
    monkeypatch.setattr(
        "stocvest.api.services.opportunity_desk.batch.write_dashboard_cache",
        fake_write,
    )
    monkeypatch.setattr(
        "stocvest.api.services.opportunity_desk.batch.read_dashboard_cache",
        lambda _k: {"data": {"rejected_samples": [{"symbol": "OLD", "reason": "gap_below_2.0pct", "seen_at": recent_seen_at}]}},
    )

    result = await run_opportunity_desk_batch(tier="movers")
    assert result["eligible_symbol_count"] == 1
    assert len(writes) == 2
    assert writes[0][1]["tier"] == "movers"
    assert writes[0][1]["movers_radar"][0]["symbol"] == "AAA"
    assert writes[0][1]["survivor_limit_used"] >= 1
    assert "rejection_reason_counts" in writes[0][1]
    assert "rejected_samples" in writes[0][1]
    assert any(row.get("symbol") == "OLD" for row in writes[0][1]["rejected_samples"])


def test_discovery_row_without_composite() -> None:
    mover = FunnelMover(
        symbol="BBB",
        gap_percent=-5.0,
        direction="down",
        rank_score=5.0,
        day_volume=1e6,
        session_price=95.0,
    )
    row = discovery_row_from_mover(mover, mode="swing", composite=None)
    assert row["symbol"] == "BBB"
    assert row["verdict"] is None
    assert row["execution_hint"] is None
