"""Laggard assembler tests (Chunk 6)."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from stocvest.data.sector_peer_registry import _PEER_GROUPS
from stocvest.data import price_cache as pc
from stocvest.data.price_cache import PriceCache
from stocvest.signals.laggard_assembler import (
    build_peer_move_data,
    compute_laggard_signal,
    evaluation_groups_for_symbol,
    get_or_compute_dynamic_clusters,
    news_verdict_is_clean,
    tech_score_to_structure,
)


class _FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.setex_calls: list[tuple[str, int, str]] = []

    def get(self, key: str) -> str | None:
        return self.data.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.setex_calls.append((key, ttl, value))
        self.data[key] = value

    def scan_iter(self, match: str | None = None, count: int | None = None):
        _ = (match, count)
        suffix = ":updated_at"
        for key in sorted(self.data.keys()):
            if key.endswith(suffix):
                yield key


def _seed_semis_laggard(fake: _FakeRedis, subject: str = "AVGO") -> None:
    """Warm minimal Redis keys for a semiconductor catch-up on AVGO."""
    peers = {
        "SOXX": (1.2, 1.0, 5e6),
        subject: (0.2, -1.0, 4e6),
    }
    for p in _PEER_GROUPS["semiconductors"].peers:
        if p not in peers:
            peers[p] = (3.5, 5.0, 8e6)
    for sym, (d1, d5, vol) in peers.items():
        fake.data[f"stocvest:price:{sym}:updated_at"] = "2026-05-18T12:00:00+00:00"
        fake.data[f"stocvest:price:{sym}:5d_change"] = str(d5)
        fake.data[f"stocvest:price:{sym}:vol_avg_20d"] = str(vol)
        fake.data[f"stocvest:price:{sym}:vol_ratio"] = "1.0"
        # two closes for 1d change
        prev = 100.0
        last = prev * (1.0 + d1 / 100.0)
        fake.data[f"stocvest:price:{sym}:close_history"] = json.dumps([prev, last])


@pytest.mark.asyncio
async def test_returns_none_day_mode() -> None:
    out = await compute_laggard_signal(
        symbol="AVGO",
        news_verdict="neutral",
        has_earnings_risk=False,
        tech_score=60.0,
        symbol_move_1d=0.2,
        symbol_vol_today=1e7,
        mode="day",
    )
    assert out is None


@pytest.mark.asyncio
async def test_returns_none_cache_miss(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)
    cache = PriceCache()
    monkeypatch.setattr(cache, "list_cached_symbols", lambda: [])
    out = await compute_laggard_signal(
        symbol="AVGO",
        news_verdict="neutral",
        has_earnings_risk=False,
        tech_score=60.0,
        symbol_move_1d=0.2,
        symbol_vol_today=1e7,
        mode="swing",
        price_cache=cache,
    )
    assert out is None


@pytest.mark.asyncio
async def test_returns_none_symbol_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    fake.data["stocvest:price:NVDA:updated_at"] = "x"
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)
    cache = PriceCache()
    out = await compute_laggard_signal(
        symbol="AVGO",
        news_verdict="neutral",
        has_earnings_risk=False,
        tech_score=60.0,
        symbol_move_1d=0.2,
        symbol_vol_today=1e7,
        mode="swing",
        price_cache=cache,
    )
    assert out is None


@pytest.mark.asyncio
async def test_returns_dict_when_laggard_detected(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    _seed_semis_laggard(fake)
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)
    out = await compute_laggard_signal(
        symbol="AVGO",
        news_verdict="neutral",
        has_earnings_risk=False,
        tech_score=60.0,
        symbol_move_1d=0.2,
        symbol_vol_today=8_000_000.0,
        mode="swing",
        session_date="2026-05-18",
        redis_client=fake,
    )
    assert out is not None
    assert out["has_laggard_signal"] is True
    assert out["symbol"] == "AVGO"
    assert out["laggard_type"] in ("catch_up", "pre_breakout", "distribution")
    assert "narrative" in out
    assert "context" in out
    assert "filters_passed" in out
    assert "summary_line" in out["narrative"]


@pytest.mark.asyncio
async def test_dynamic_clusters_fetched_from_redis_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    _seed_semis_laggard(fake)
    cached = [{"leader_symbol": "SPCX", "leader_move_1d": 8.0, "leader_dominance_score": 3.0,
               "cluster_symbols": ["SPCX", "RKLB", "ASTS"], "cluster_direction": "up",
               "cluster_size": 3, "is_ipo_mode": False, "driver_label": "Dynamic cluster: SPCX driving 3 stocks"}]
    fake.data["stocvest:dynamic_clusters:2026-05-18"] = json.dumps(cached)
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)

    with patch("stocvest.signals.laggard_assembler.detect_all_dynamic_clusters") as detect:
        clusters = get_or_compute_dynamic_clusters(PriceCache(), session_date="2026-05-18", redis_client=fake)
        assert len(clusters) == 1
        assert clusters[0].leader_symbol == "SPCX"
        detect.assert_not_called()


@pytest.mark.asyncio
async def test_dynamic_clusters_computed_when_cache_miss(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    _seed_semis_laggard(fake)
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)

    with patch(
        "stocvest.signals.laggard_assembler.detect_all_dynamic_clusters",
        return_value=[],
    ) as detect:
        clusters = get_or_compute_dynamic_clusters(PriceCache(), session_date="2026-05-18", redis_client=fake)
        assert clusters == []
        detect.assert_called_once()
        assert any(k.startswith("stocvest:dynamic_clusters:") for k, _, _ in fake.setex_calls)


@pytest.mark.asyncio
async def test_returns_none_on_exception_not_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    _seed_semis_laggard(fake)
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)
    with patch(
        "stocvest.signals.laggard_assembler.detect_laggard_multi_group",
        side_effect=RuntimeError("boom"),
    ):
        out = await compute_laggard_signal(
            symbol="AVGO",
            news_verdict="neutral",
            has_earnings_risk=False,
            tech_score=60.0,
            symbol_move_1d=0.2,
            symbol_vol_today=1e7,
            mode="swing",
            session_date="2026-05-18",
            redis_client=fake,
        )
    assert out is None


def test_tech_score_to_structure_mapping() -> None:
    assert tech_score_to_structure(55.0) == "intact"
    assert tech_score_to_structure(25.0) == "weak"
    assert tech_score_to_structure(40.0) == "unknown"


def test_news_clean_mapping() -> None:
    assert news_verdict_is_clean("neutral") is True
    assert news_verdict_is_clean("bullish") is True
    assert news_verdict_is_clean("bearish") is False


def test_pre_ipo_activation_included() -> None:
    msft_groups = evaluation_groups_for_symbol(
        "MSFT",
        pre_ipo_active_entities=["OpenAI"],
    )
    keys = {g.registry_key for g in msft_groups}
    assert "openai_ecosystem" in keys


def test_build_peer_move_data_skips_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    fake.data["stocvest:price:NVDA:updated_at"] = "x"
    fake.data["stocvest:price:NVDA:5d_change"] = "4.0"
    fake.data["stocvest:price:NVDA:close_history"] = json.dumps([100.0, 104.0])
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)
    moves = build_peer_move_data(PriceCache(), ["NVDA", "MISSING"])
    assert "NVDA" in moves
    assert "MISSING" not in moves
