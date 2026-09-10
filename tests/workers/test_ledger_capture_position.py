"""ledger_capture_position worker — ADR-004 POS-D9 weekly shadow sweep."""

from __future__ import annotations

import pytest

from datetime import datetime, timezone

from stocvest.api.services.signal_recorder import InMemorySignalRecorder
from stocvest.data.models import SignalRecord
from stocvest.signals.position_thesis_drift import pillar_snapshot_to_json
from stocvest.workers.ledger_capture_position import (
    _layer_scores,
    _regime_label,
    _signal_strength,
    run_position_ledger_capture_async,
)


def _body(
    symbol: str,
    *,
    status: str = "active",
    verdict: str = "neutral",
    pillars: list[tuple[str, int, str]] | None = None,
) -> dict:
    body = {
        "symbol": symbol,
        "status": status,
        "verdict": verdict,
        "composite_score": 42,
        "signal_strength": 0.62,  # composite confidence (0..1) — scaled to 0..100 on the row
        "risk_reward": 2.1,
        "last_trade_price": 100.0,
        "reference_stop_level": 90.0,
        "reference_target_1": 130.0,
        "sector": "Technology",
        "market_environment": {"environment_tier": "normal", "macro_regime": "risk_off"},
        "layers": [
            {"layer": "fundamentals", "score": 61.0},
            {"layer": "technical", "score": 48.0},
            {"layer": "bogus", "score": None},
        ],
    }
    if pillars is not None:
        body["position_fundamentals"] = {
            "pillars": [
                {"pillar_id": pid, "label": f"{pid} label", "score": sc, "verdict": pv}
                for pid, sc, pv in pillars
            ]
        }
    return body


@pytest.fixture()
def recorder(monkeypatch: pytest.MonkeyPatch) -> InMemorySignalRecorder:
    rec = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.services.signal_recorder._recorder", rec)
    return rec


def test_helpers_map_body_fields() -> None:
    body = _body("AAPL")
    assert _layer_scores(body) == {"fundamentals": 61.0, "technical": 48.0}
    # regime is read from market_environment["macro_regime"] (the real key).
    assert _regime_label(body) == "risk_off"
    assert _regime_label({}) == "neutral"
    assert _regime_label({"regime": "bull"}) == "bull"  # top-level fallback
    # signal_strength = confidence (0..1) scaled to 0..100, clamped.
    assert _signal_strength(body) == 62
    assert _signal_strength({}) == 0
    assert _signal_strength({"signal_strength": None}) == 0
    assert _signal_strength({"signal_strength": 1.5}) == 100


@pytest.mark.asyncio
async def test_sweep_writes_shadow_rows_and_counts(recorder: InMemorySignalRecorder) -> None:
    calls: list[str] = []

    async def _compose(sym: str) -> dict:
        calls.append(sym)
        if sym == "BAD":
            raise RuntimeError("compose blew up")
        if sym == "THIN":
            return {"symbol": sym, "status": "insufficient_data", "verdict": "neutral"}
        return _body(sym, verdict="neutral")

    out = await run_position_ledger_capture_async(
        universe=["AAA", "THIN", "BAD"], compose=_compose, concurrency=2
    )

    assert out["job"] == "ledger_capture_position"
    assert out["universe"] == 3
    assert out["errors"] == 1  # BAD
    assert out["evaluated"] == 1  # AAA (THIN skipped as insufficient_data)
    assert out["shadow"] == 1
    assert out["qualified"] == 0
    assert out["capture_user"] == "platform-position-ledger"
    assert set(calls) == {"AAA", "THIN", "BAD"}

    rows = [r for r in recorder.scan_all_records() if r.mode == "position"]
    assert rows and all(r.capture_kind == "shadow" for r in rows)
    assert all(r.symbol == "AAA" for r in rows if r.user_id)


@pytest.mark.asyncio
async def test_sweep_persists_pillar_snapshot(recorder: InMemorySignalRecorder) -> None:
    async def _compose(sym: str) -> dict:
        return _body(sym, verdict="bullish", pillars=[("F1", 80, "bullish"), ("F4", 40, "bearish")])

    await run_position_ledger_capture_async(universe=["AAA"], compose=_compose, concurrency=1)
    rows = [r for r in recorder.scan_all_records() if r.mode == "position" and r.user_id]
    assert rows and rows[0].pillar_snapshot_json  # baseline persisted + round-trips through Dynamo item


@pytest.mark.asyncio
async def test_sweep_reports_informational_drift_for_open_position(
    recorder: InMemorySignalRecorder,
) -> None:
    # Seed an OPEN position under the capture user with an entry pillar baseline.
    baseline = pillar_snapshot_to_json(
        _body("AAA", verdict="bullish", pillars=[("F1", 80, "bullish"), ("F2", 60, "neutral")])
    )
    recorder.record_signal(
        SignalRecord(
            signal_id="open-1",
            symbol="AAA",
            direction="bullish",
            signal_strength=70,
            pattern="position_composite",
            layer_scores={},
            price_at_signal=100.0,
            generated_at=datetime.now(timezone.utc),
            user_id="platform-position-ledger",
            mode="position",
            ledger_qualified=True,
            ledger_position_open=True,
            pillar_snapshot_json=baseline,
        )
    )

    # Fresh composite degrades F1 (80→60, −20) and the overall verdict (bullish→neutral).
    async def _compose(sym: str) -> dict:
        return _body(sym, verdict="neutral", pillars=[("F1", 60, "bullish"), ("F2", 60, "neutral")])

    out = await run_position_ledger_capture_async(universe=["AAA"], compose=_compose, concurrency=1)
    assert out["open_positions_checked"] == 1
    assert out["drift_detected"] == 1
    ev = out["drift"][0]
    assert ev["symbol"] == "AAA"
    assert ev["verdict_downgraded"] is True
    assert [p["pillar_id"] for p in ev["degraded_pillars"]] == ["F1"]
