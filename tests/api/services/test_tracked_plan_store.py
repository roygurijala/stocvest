from __future__ import annotations

import pytest

from stocvest.api.services.tracked_plan_store import InMemoryTrackedPlanStore
from stocvest.signals.tracked_trade_plan import TrackedPlanLevels, TrackedTradePlan
from datetime import datetime, timezone

pytestmark = pytest.mark.unit


def _plan(plan_id: str, symbol: str, *, committed: str) -> TrackedTradePlan:
    return TrackedTradePlan(
        plan_id=plan_id,
        user_id="u1",
        symbol=symbol,
        mode="swing",
        committed_at=datetime.fromisoformat(committed),
        bias="Bullish",
        levels=TrackedPlanLevels(
            entry_low=1,
            entry_high=2,
            stop=0.5,
            target1=3,
            target2=None,
            price_at_commit=1.5,
            risk_reward_at_commit=2.0,
        ),
    )


def test_tracked_plan_store_dedupes_symbol_mode() -> None:
    store = InMemoryTrackedPlanStore(_by_user={})
    p1 = _plan("swing:AAPL:1", "AAPL", committed="2026-06-09T12:00:00+00:00")
    p2 = _plan("swing:AAPL:2", "AAPL", committed="2026-06-10T12:00:00+00:00")
    store.upsert_plan(p1)
    store.upsert_plan(p2)
    rows = store.list_plans("u1")
    assert len(rows) == 1
    assert rows[0].plan_id == "swing:AAPL:2"


def test_tracked_plan_store_build_default_requires_table_outside_dev(monkeypatch: pytest.MonkeyPatch) -> None:
    from stocvest.api.services import tracked_plan_store as mod
    from stocvest.utils.config import get_settings

    monkeypatch.delenv("STOCVEST_TRADE_PLANS_TABLE", raising=False)
    monkeypatch.setenv("STOCVEST_ENV", "production")
    get_settings.cache_clear()
    with pytest.raises(ValueError, match="STOCVEST_TRADE_PLANS_TABLE"):
        mod.build_default_tracked_plan_store()
    get_settings.cache_clear()
