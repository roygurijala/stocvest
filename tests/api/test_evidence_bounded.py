"""Composite evidence caching, timeout, and rate limit (mocked)."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from stocvest.api.handlers.signals import composite_response_with_evidence_cache


def test_evidence_cached_on_second_call(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def compute() -> dict[str, Any]:
        calls.append(1)
        return {"symbol": "AAPL", "score": 50}

    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evidence_rate_limit_exceeded",
        lambda _uid: False,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.read_dashboard_cache",
        lambda _k: None,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.write_dashboard_cache",
        lambda *a, **k: True,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals._compute_with_thread_timeout",
        lambda fn, timeout_sec: fn(),
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.polygon_circuit",
        MagicMock(call=lambda fn: fn()),
    )

    first = composite_response_with_evidence_cache(
        symbol="AAPL",
        user_id="u1",
        user_email=None,
        mode="day",
        sync_compute=compute,
    )
    assert first.get("source") == "computed"
    assert calls == [1]

    monkeypatch.setattr(
        "stocvest.api.handlers.signals.read_dashboard_cache",
        lambda _k: {
            "state_version": "day_2026_05_08_10_00",
            "data": {"symbol": "AAPL", "score": 99},
        },
    )
    second = composite_response_with_evidence_cache(
        symbol="AAPL",
        user_id="u1",
        user_email=None,
        mode="day",
        sync_compute=compute,
    )
    assert second.get("source") == "cache"
    assert second.get("score") == 99
    assert calls == [1]


def test_evidence_timeout_returns_error_dict(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evidence_rate_limit_exceeded",
        lambda _uid: False,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.read_dashboard_cache",
        lambda _k: None,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals._compute_with_thread_timeout",
        lambda _fn, timeout_sec: None,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.polygon_circuit",
        MagicMock(call=lambda fn: fn()),
    )

    out = composite_response_with_evidence_cache(
        symbol="AAPL",
        user_id="u1",
        user_email=None,
        mode="day",
        sync_compute=lambda: {"symbol": "AAPL"},
    )
    assert out.get("error") == "timeout"


def test_evidence_rate_limit_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evidence_rate_limit_exceeded",
        lambda _uid: True,
    )
    out = composite_response_with_evidence_cache(
        symbol="AAPL",
        user_id="u1",
        user_email=None,
        mode="day",
        sync_compute=lambda: {"symbol": "AAPL"},
    )
    assert out.get("error") == "rate_limited"


def test_insufficient_data_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    writes: list[Any] = []

    def capture_write(*a, **k):
        writes.append((a, k))
        return True

    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evidence_rate_limit_exceeded",
        lambda _uid: False,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.read_dashboard_cache",
        lambda _k: None,
    )
    monkeypatch.setattr("stocvest.api.handlers.signals.write_dashboard_cache", capture_write)
    monkeypatch.setattr(
        "stocvest.api.handlers.signals._compute_with_thread_timeout",
        lambda fn, timeout_sec: fn(),
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.polygon_circuit",
        MagicMock(call=lambda fn: fn()),
    )

    composite_response_with_evidence_cache(
        symbol="AAPL",
        user_id="u1",
        user_email=None,
        mode="day",
        sync_compute=lambda: {"symbol": "AAPL", "status": "insufficient_data"},
    )
    assert writes == []
