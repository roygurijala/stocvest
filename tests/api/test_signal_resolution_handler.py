"""Tests for EventBridge-triggered signal_resolution Lambda handler."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

import stocvest.api.handlers.signal_resolution as signal_resolution_mod


def _body_dict(response: dict[str, Any]) -> dict[str, Any]:
    raw = response.get("body")
    if isinstance(raw, str):
        return json.loads(raw)
    if isinstance(raw, dict):
        return raw
    return {}


def _fake_run_close_coro(coro: Any, result: dict[str, Any]) -> dict[str, Any]:
    if asyncio.iscoroutine(coro):
        coro.close()
    return result


def test_handler_accepts_eventbridge_event(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(coro: Any) -> dict[str, Any]:
        return _fake_run_close_coro(
            coro,
            {
                "resolved_1h": 2,
                "resolved_24h": 0,
                "swing_closed": 0,
                "day_closed": 0,
                "skipped": 0,
                "errors": 0,
            },
        )

    monkeypatch.setattr(signal_resolution_mod.asyncio, "run", fake_run)

    event = {"source": "aws.events", "id": "evt-test-1", "version": "0"}
    out = signal_resolution_mod.signal_resolution_scheduled_handler(event, None)  # type: ignore[arg-type]

    assert out["statusCode"] == 200
    body = _body_dict(out)
    assert body.get("resolved_1h") == 2
    assert body.get("updated_1h") == 2


def test_handler_returns_200_on_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(coro: Any) -> dict[str, int]:
        if asyncio.iscoroutine(coro):
            coro.close()
        raise RuntimeError("polygon down")

    monkeypatch.setattr(signal_resolution_mod.asyncio, "run", boom)

    out = signal_resolution_mod.signal_resolution_scheduled_handler({}, None)  # type: ignore[arg-type]

    assert out["statusCode"] == 200
    body = _body_dict(out)
    assert "error" in body
    assert "polygon down" in body["error"]
    assert body.get("resolved_1h") == 0


def test_handler_logs_resolution_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    """Logger uses propagate=False; assert via captured info calls."""

    def fake_run(coro: Any) -> dict[str, Any]:
        return _fake_run_close_coro(
            coro,
            {
                "resolved_1h": 3,
                "resolved_24h": 1,
                "swing_closed": 0,
                "day_closed": 0,
                "skipped": 0,
                "errors": 0,
            },
        )

    monkeypatch.setattr(signal_resolution_mod.asyncio, "run", fake_run)

    info_messages: list[str] = []

    def capture_info(msg: str, *args: Any) -> None:
        info_messages.append(msg % args if args else msg)

    monkeypatch.setattr(signal_resolution_mod._LOG, "info", capture_info)

    signal_resolution_mod.signal_resolution_scheduled_handler({"source": "aws.events"}, None)  # type: ignore[arg-type]

    assert any("Resolved: 3 (1h), 1 (24h)" in m for m in info_messages), info_messages
    assert any("Ledger monitor:" in m for m in info_messages), info_messages
