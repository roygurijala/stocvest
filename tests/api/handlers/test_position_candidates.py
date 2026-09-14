"""Handler tests for GET /v1/signals/position/candidates (POS-D15)."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from stocvest.api.handlers.signals import position_candidates_handler
from stocvest.api.services.position_scan import GemCandidate, PositionScanSnapshot
from stocvest.api.services.position_scan_store import (
    InMemoryPositionScanStore,
    reset_position_scan_store_for_tests,
)

pytestmark = pytest.mark.unit


def _event(*, qs: dict | None = None, sub: str | None = "user-1") -> dict:
    ctx: dict = {"requestContext": {}}
    if sub is not None:
        ctx = {"requestContext": {"authorizer": {"claims": {"sub": sub}}}}
    return {**ctx, "headers": {}, "queryStringParameters": qs or {}}


def _candidate(symbol: str, tier: str, rank: float) -> GemCandidate:
    return GemCandidate(
        symbol=symbol,
        tier=tier,
        rank=rank,
        composite_score=40,
        verdict="bullish",
        fundamentals_score=80,
        fundamentals_verdict="bullish",
        technical_score=66,
        technical_verdict="bullish",
        sector_verdict="neutral",
        data_quality="high",
        weakest_pillar_id="F4",
        weakest_pillar_label="Valuation",
        rs_vs_spy_6m_pct=8.0,
        signal_valid_days=90,
        why="Passes strict quality gates — weakest F4 valuation. Screening only.",
        pillars=[],
        failing_gates=[],
    )


def _patch_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    snap = PositionScanSnapshot(
        generated_at=datetime(2026, 9, 8, tzinfo=timezone.utc),
        universe_size=25,
        candidates=[
            _candidate("HIGH", "gem", 88.0),
            _candidate("MIDD", "gem", 75.0),
            _candidate("SOFT", "strong", 70.0),
            _candidate("WATCH", "monitor", 50.0),
        ],
    )
    monkeypatch.setattr(
        "stocvest.api.services.position_scan.get_position_scan_snapshot_sync",
        lambda *, force=False: (snap, not force),
    )


def test_requires_auth() -> None:
    res = position_candidates_handler(_event(sub=None), {})
    assert res["statusCode"] == 401


def test_default_returns_gem_tier(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_snapshot(monkeypatch)
    res = position_candidates_handler(_event(), {})
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["mode"] == "position"
    assert body["tier"] == "gem"
    assert [c["symbol"] for c in body["candidates"]] == ["HIGH", "MIDD"]
    assert body["universe_size"] == 25
    assert body["cached"] is True


def test_tier_all_includes_non_insufficient(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_snapshot(monkeypatch)
    res = position_candidates_handler(_event(qs={"tier": "all"}), {})
    body = json.loads(res["body"])
    assert body["count"] == 4


def test_limit_is_applied(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_snapshot(monkeypatch)
    res = position_candidates_handler(_event(qs={"tier": "all", "limit": "2"}), {})
    body = json.loads(res["body"])
    assert body["count"] == 2


def test_bad_tier_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_snapshot(monkeypatch)
    res = position_candidates_handler(_event(qs={"tier": "banana"}), {})
    assert res["statusCode"] == 400


def test_miss_claims_once_then_polls_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "stocvest-development-api-signals")
    reset_position_scan_store_for_tests(InMemoryPositionScanStore())
    monkeypatch.setattr(
        "stocvest.api.services.position_scan.get_position_scan_snapshot_sync",
        lambda *, force=False: (None, False),
    )

    def _boom_compute() -> None:
        raise AssertionError("must not inline compose inside AWS")

    monkeypatch.setattr(
        "stocvest.api.services.position_scan.compute_and_persist_position_scan",
        _boom_compute,
    )
    kicks = {"n": 0}

    def _kick() -> bool:
        kicks["n"] += 1
        return True

    monkeypatch.setattr("stocvest.api.handlers.signals.trigger_async_position_scan_refresh", _kick)
    first = json.loads(position_candidates_handler(_event(), {})["body"])
    second = json.loads(position_candidates_handler(_event(), {})["body"])
    assert first["pending"] is True and second["pending"] is True
    assert first["degraded"] is False
    assert kicks["n"] == 1
    reset_position_scan_store_for_tests(None)


def test_refresh_kicks_async_and_returns_pending_in_aws(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_position_scan_store_for_tests(InMemoryPositionScanStore())
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "stocvest-development-api-signals")
    monkeypatch.setattr(
        "stocvest.api.services.position_scan.get_position_scan_snapshot_sync",
        lambda *, force=False: (None, False),
    )

    def _boom_compute() -> None:
        raise AssertionError("must not inline compose inside AWS")

    monkeypatch.setattr(
        "stocvest.api.services.position_scan.compute_and_persist_position_scan",
        _boom_compute,
    )
    kicks = {"n": 0}

    def _kick() -> bool:
        kicks["n"] += 1
        return True

    monkeypatch.setattr("stocvest.api.handlers.signals.trigger_async_position_scan_refresh", _kick)
    res = position_candidates_handler(_event(qs={"refresh": "1"}), {})
    body = json.loads(res["body"])
    assert body["pending"] is True
    assert body["candidates"] == []
    assert kicks["n"] == 1


def test_refresh_inlines_when_not_in_aws(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_position_scan_store_for_tests(InMemoryPositionScanStore())
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.setattr(
        "stocvest.api.services.position_scan.get_position_scan_snapshot_sync",
        lambda *, force=False: (None, False),
    )
    snap = PositionScanSnapshot(
        generated_at=datetime(2026, 9, 8, tzinfo=timezone.utc),
        universe_size=25,
        candidates=[_candidate("HIGH", "gem", 88.0)],
    )
    monkeypatch.setattr(
        "stocvest.api.services.position_scan.compute_and_persist_position_scan",
        lambda: snap,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.trigger_async_position_scan_refresh",
        lambda: False,
    )
    res = position_candidates_handler(_event(qs={"refresh": "true"}), {})
    body = json.loads(res["body"])
    assert body["cached"] is False
    assert body.get("pending") is not True
    assert [c["symbol"] for c in body["candidates"]] == ["HIGH"]


def test_refresh_invalidates_and_returns_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryPositionScanStore()
    reset_position_scan_store_for_tests(store)
    _patch_snapshot(monkeypatch)
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "stocvest-development-api-signals")
    kicks = {"n": 0}

    def _kick() -> bool:
        kicks["n"] += 1
        return True

    monkeypatch.setattr("stocvest.api.handlers.signals.trigger_async_position_scan_refresh", _kick)
    res = position_candidates_handler(_event(qs={"refresh": "true"}), {})
    body = json.loads(res["body"])
    assert body["pending"] is True
    assert body["candidates"] == []
    assert kicks["n"] == 1
    assert store.get() is None


def test_scan_refresh_handler_computes(monkeypatch: pytest.MonkeyPatch) -> None:
    from stocvest.api.handlers.signals import position_scan_refresh_handler

    called = {"n": 0}

    def _compute() -> None:
        called["n"] += 1

    monkeypatch.setattr(
        "stocvest.api.services.position_scan.compute_and_persist_position_scan",
        _compute,
    )
    r = position_scan_refresh_handler({"position_scan_refresh": True}, {})
    assert r["statusCode"] == 200 and r["refreshed"] is True
    assert called["n"] == 1


def test_scan_failure_degrades_gracefully(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*, force=False):
        raise RuntimeError("scan down")

    monkeypatch.setattr(
        "stocvest.api.services.position_scan.get_position_scan_snapshot_sync", _boom
    )
    res = position_candidates_handler(_event(), {})
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["degraded"] is True
    assert body["candidates"] == []
