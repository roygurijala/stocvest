"""Tests for Upstash dashboard cache helpers (mocked HTTP client)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import pytest

ET = ZoneInfo("America/New_York")


@pytest.fixture
def fake_upstash(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    monkeypatch.setattr("stocvest.data.dashboard_cache.upstash_configured", lambda: True)
    client = MagicMock()
    client.store = {}
    client.hashes = {}

    def _set(key, val, ex=None):
        client.store[key] = val

    def _get(key):
        return client.store.get(key)

    def _hset(key, field=None, value=None, values=None):
        d = client.hashes.setdefault(key, {})
        if values:
            d.update(values)

    def _incr(key):
        n = int(client.store.get(f"incr:{key}", 0)) + 1
        client.store[f"incr:{key}"] = n
        return n

    def _expire(key, sec):
        client.store[f"expire:{key}"] = sec

    client.set.side_effect = _set
    client.get.side_effect = _get
    client.hset.side_effect = _hset
    client.incr.side_effect = _incr
    client.expire.side_effect = _expire
    monkeypatch.setattr("stocvest.data.dashboard_cache.get_upstash", lambda: client)
    return client


def test_write_includes_state_version(fake_upstash: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.data.dashboard_cache.make_state_version",
        lambda mode="swing": "swing_2099_01_01",
    )
    from stocvest.data.dashboard_cache import write_dashboard_cache

    ok = write_dashboard_cache("k:test", {"a": 1}, "swing_signals", "swing")
    assert ok is True
    raw = fake_upstash.store.get("k:test")
    assert raw
    env = json.loads(raw)
    assert env["state_version"] == "swing_2099_01_01"
    assert env["data"] == {"a": 1}
    assert "computed_at" in env
    assert "ttl_seconds" in env


def test_swing_version_format(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed = datetime(2026, 5, 7, 12, 0, tzinfo=ET)

    class _DT:
        @classmethod
        def now(cls, tz=None):
            if tz == ET:
                return fixed
            return fixed.astimezone(tz or timezone.utc)

    monkeypatch.setattr("stocvest.data.dashboard_cache.datetime", _DT)
    from stocvest.data.dashboard_cache import make_state_version

    assert make_state_version("swing") == "swing_2026_05_07"


def test_day_version_format(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed = datetime(2026, 5, 7, 10, 35, tzinfo=ET)

    class _DT:
        @classmethod
        def now(cls, tz=None):
            if tz == ET:
                return fixed
            return fixed.astimezone(tz or timezone.utc)

    monkeypatch.setattr("stocvest.data.dashboard_cache.datetime", _DT)
    from stocvest.data.dashboard_cache import make_state_version

    assert make_state_version("day") == "day_2026_05_07_10_35"


def test_read_returns_full_envelope(fake_upstash: MagicMock) -> None:
    from stocvest.data.dashboard_cache import DashboardKeys, read_dashboard_cache, write_dashboard_cache

    write_dashboard_cache(DashboardKeys.MARKET_PULSE, {"x": 2}, "market_pulse", "day")
    env = read_dashboard_cache(DashboardKeys.MARKET_PULSE)
    assert env and env.get("data") == {"x": 2}
    assert env.get("state_version")


def test_read_returns_none_on_missing_key(fake_upstash: MagicMock) -> None:
    from stocvest.data.dashboard_cache import read_dashboard_cache

    assert read_dashboard_cache("missing:key") is None


def test_market_hours_ttl_shorter(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed = datetime(2026, 5, 7, 11, 0, tzinfo=ET)  # Wed RTH

    class _DT:
        @classmethod
        def now(cls, tz=None):
            if tz == ET:
                return fixed
            return fixed.astimezone(tz or timezone.utc)

    monkeypatch.setattr("stocvest.data.dashboard_cache.datetime", _DT)
    from stocvest.data.dashboard_cache import get_market_ttl

    assert get_market_ttl("market_pulse") < 300


def test_closed_market_ttl_longer(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed = datetime(2026, 5, 8, 18, 0, tzinfo=ET)  # Fri after hours

    class _DT:
        @classmethod
        def now(cls, tz=None):
            if tz == ET:
                return fixed
            return fixed.astimezone(tz or timezone.utc)

    monkeypatch.setattr("stocvest.data.dashboard_cache.datetime", _DT)
    from stocvest.data.dashboard_cache import get_market_ttl

    assert get_market_ttl("market_pulse") == 3600


def test_write_failure_returns_false_not_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("stocvest.data.dashboard_cache.upstash_configured", lambda: True)

    def boom():
        raise RuntimeError("network")

    monkeypatch.setattr("stocvest.data.dashboard_cache.get_upstash", boom)
    from stocvest.data.dashboard_cache import write_dashboard_cache

    assert write_dashboard_cache("k", {}, "swing_signals", "swing") is False


def test_heat_map_updated_on_success(fake_upstash: MagicMock, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.data.dashboard_cache.make_state_version",
        lambda mode="swing": "swing_test",
    )
    from stocvest.data.dashboard_cache import DashboardKeys, write_dashboard_cache

    write_dashboard_cache("k:ok", {"z": 1}, "swing_signals", "swing")
    h = fake_upstash.hashes.get(DashboardKeys.LAYER_HEALTH)
    assert h
    assert "k:ok:last_success" in h
    assert h.get("k:ok:status") == "ok"


def test_heat_map_updated_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("stocvest.data.dashboard_cache.upstash_configured", lambda: True)
    client = MagicMock()
    client.set.side_effect = RuntimeError("fail")
    client.hset = MagicMock()
    monkeypatch.setattr("stocvest.data.dashboard_cache.get_upstash", lambda: client)
    from stocvest.data.dashboard_cache import DashboardKeys, write_dashboard_cache

    assert write_dashboard_cache("k:bad", {}, "swing_signals", "swing") is False
    assert client.hset.called
    args = client.hset.call_args
    vals = args.kwargs.get("values") or {}
    assert vals.get("k:bad:status") == "error"
