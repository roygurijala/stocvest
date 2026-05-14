from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from stocvest.api.handlers.signals import gap_intel_snapshot_handler
from stocvest.data.models import Snapshot


def test_gap_intel_snapshot_handler_requires_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.build_request_context",
        lambda _e: SimpleNamespace(user_id=None, claims={}),
    )
    event = {
        "requestContext": {"http": {"method": "GET", "path": "/v1/signals/gap-intel"}},
        "queryStringParameters": {"symbol": "AAPL", "trading_mode": "day"},
    }
    resp = gap_intel_snapshot_handler(event, {})
    assert resp["statusCode"] == 401


def test_gap_intel_snapshot_handler_requires_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.build_request_context",
        lambda _e: SimpleNamespace(user_id="u1", claims={}),
    )
    event = {
        "requestContext": {"http": {"method": "GET", "path": "/v1/signals/gap-intel"}},
        "queryStringParameters": {"trading_mode": "day"},
    }
    resp = gap_intel_snapshot_handler(event, {})
    assert resp["statusCode"] == 400


def test_gap_intel_snapshot_handler_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.build_request_context",
        lambda _e: SimpleNamespace(user_id="u1", claims={}),
    )

    async def _fake_compute(symbol: str, mode: str, *, now_utc=None):  # noqa: ANN001
        from datetime import datetime, timezone

        from stocvest.signals.gap_intel_snapshot import build_gap_intel_snapshot

        snap = Snapshot(
            symbol=symbol.upper(),
            prev_close=100.0,
            day_open=101.0,
            last_trade_price=101.2,
            prev_day_volume=6_000_000.0,
            last_quote_bid=100.9,
            last_quote_ask=101.1,
        )
        return {
            **build_gap_intel_snapshot(
                symbol=symbol.upper(),
                snapshot=snap,
                bars_1m=[],
                market_status=None,
                trading_mode=mode,  # type: ignore[arg-type]
                now_utc=now_utc or datetime.now(tz=timezone.utc),
                prev_session_bar=None,
            ),
            "disclaimer": "x",
        }

    monkeypatch.setattr("stocvest.api.handlers.signals.compute_gap_intel_body", _fake_compute)
    monkeypatch.setattr("stocvest.api.handlers.signals.get_gap_intel_cache_row", lambda _ck: None)
    monkeypatch.setattr("stocvest.api.handlers.signals.put_gap_intel_cache_row", lambda *a, **k: None)
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.next_last_disable_metric_timestamp", lambda **k: None
    )

    event = {
        "requestContext": {"http": {"method": "GET", "path": "/v1/signals/gap-intel"}},
        "queryStringParameters": {"symbol": "aapl", "trading_mode": "swing"},
    }
    resp = gap_intel_snapshot_handler(event, {})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["symbol"] == "AAPL"
    assert "phase" in body
    assert "disclaimer" in body


def test_gap_intel_batch_handler_returns_items(monkeypatch: pytest.MonkeyPatch) -> None:
    from stocvest.api.handlers.signals import gap_intel_batch_handler

    monkeypatch.setattr(
        "stocvest.api.handlers.signals.build_request_context",
        lambda _e: SimpleNamespace(user_id="u1", claims={}),
    )

    async def _fake_compute(symbol: str, mode: str, *, now_utc=None):  # noqa: ANN001
        from datetime import datetime, timezone

        from stocvest.signals.gap_intel_snapshot import build_gap_intel_snapshot

        snap = Snapshot(
            symbol=symbol.upper(),
            prev_close=100.0,
            day_open=101.0,
            last_trade_price=101.2,
            prev_day_volume=6_000_000.0,
            last_quote_bid=100.9,
            last_quote_ask=101.1,
        )
        return {
            **build_gap_intel_snapshot(
                symbol=symbol.upper(),
                snapshot=snap,
                bars_1m=[],
                market_status=None,
                trading_mode=mode,  # type: ignore[arg-type]
                now_utc=now_utc or datetime.now(tz=timezone.utc),
                prev_session_bar=None,
            ),
            "disclaimer": "x",
        }

    monkeypatch.setattr("stocvest.api.handlers.signals.compute_gap_intel_body", _fake_compute)
    monkeypatch.setattr("stocvest.api.handlers.signals.get_gap_intel_cache_row", lambda _ck: None)
    monkeypatch.setattr("stocvest.api.handlers.signals.put_gap_intel_cache_row", lambda *a, **k: None)
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.next_last_disable_metric_timestamp", lambda **k: None
    )

    event = {
        "requestContext": {"http": {"method": "POST", "path": "/v1/signals/gap-intel/batch"}},
        "body": json.dumps({"symbols": ["aapl", "msft"], "trading_mode": "day"}),
    }
    resp = gap_intel_batch_handler(event, {})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert "AAPL" in body["items"]
    assert "MSFT" in body["items"]
    assert body["errors"] == {}
