"""Composite API bodies must expose ``generated_at`` for Signals desk freshness."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.config.signal_parameters import default_signal_parameters
from tests.api.test_class_share_symbol_normalization import (
    _RecordingPoly,
    _mute_shared,
)


def _assert_generated_at_recent(out: dict) -> None:
    raw = out.get("generated_at")
    assert isinstance(raw, str) and raw.strip(), "composite response must include generated_at"
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None
    age_s = (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()
    assert 0 <= age_s < 120, f"generated_at should be recent, got {raw!r}"


@pytest.mark.asyncio
async def test_day_composite_includes_generated_at(monkeypatch: pytest.MonkeyPatch) -> None:
    module = "stocvest.api.services.real_composite_engine"
    _mute_shared(monkeypatch, module)
    monkeypatch.setattr(f"{module}.PolygonClient", _RecordingPoly())

    from stocvest.api.services.real_composite_engine import build_real_composite_response

    out = await build_real_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )
    _assert_generated_at_recent(out)


@pytest.mark.asyncio
async def test_swing_composite_includes_generated_at(monkeypatch: pytest.MonkeyPatch) -> None:
    module = "stocvest.api.services.swing_composite_engine"
    monkeypatch.setattr(f"{module}.get_all_cached_sector_data", lambda: {})
    monkeypatch.setattr(f"{module}.get_cached_sector_returns", lambda _etf: None)
    _mute_shared(monkeypatch, module)
    monkeypatch.setattr(f"{module}.PolygonClient", _RecordingPoly())

    from stocvest.api.services.swing_composite_engine import build_swing_composite_response

    out = await build_swing_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )
    _assert_generated_at_recent(out)
