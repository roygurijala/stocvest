"""ledger_capture_position worker — ADR-004 POS-D9 weekly shadow sweep."""

from __future__ import annotations

import pytest

from stocvest.api.services.signal_recorder import InMemorySignalRecorder
from stocvest.workers.ledger_capture_position import (
    _layer_scores,
    _regime_label,
    _signal_strength,
    run_position_ledger_capture_async,
)


def _body(symbol: str, *, status: str = "active", verdict: str = "neutral") -> dict:
    return {
        "symbol": symbol,
        "status": status,
        "verdict": verdict,
        "composite_score": 42,
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
    assert _signal_strength(body) == 42
    assert _signal_strength({"composite_score": None}) == 0
    assert _signal_strength({"composite_score": 250}) == 100


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
