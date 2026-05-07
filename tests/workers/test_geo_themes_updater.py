from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from stocvest.workers import geo_themes_updater as gtu


@pytest.mark.asyncio
async def test_perplexity_response_parsed(monkeypatch: pytest.MonkeyPatch) -> None:
    sample = {
        "active_themes": [
            {
                "key": "oil_disruption",
                "display_name": "Oil disruption",
                "description": "Supply risk",
                "primary_sectors": ["energy"],
                "risk_level": "high",
                "started_approx": "2026-01",
            }
        ],
        "as_of": "2026-01-01",
        "source": "perplexity_sonar",
    }

    async def fake_fetch() -> dict:
        return dict(sample)

    monkeypatch.setattr(gtu, "fetch_from_perplexity", fake_fetch)

    mock_r = MagicMock()
    mock_r.setex = MagicMock()
    with patch("redis.Redis.from_url", return_value=mock_r):
        out = await gtu.update_geo_themes()
    assert len(out.get("active_themes", [])) == 1
    th = out["active_themes"][0]
    assert th["key"] == "oil_disruption"
    assert "energy" in th["primary_sectors"]


def test_markdown_fences_stripped() -> None:
    raw = "```json\n{\"active_themes\": [], \"source\": \"t\"}\n```"
    content = raw.strip()
    lines = content.split("\n")
    lines = [ln for ln in lines if not ln.strip().startswith("```")]
    cleaned = "\n".join(lines).strip()
    payload = json.loads(cleaned)
    assert payload.get("active_themes") == []


@pytest.mark.asyncio
async def test_fallback_when_perplexity_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom() -> dict:
        raise RuntimeError("perplexity down")

    monkeypatch.setattr(gtu, "fetch_from_perplexity", boom)
    mock_r = MagicMock()
    mock_r.setex = MagicMock()
    with patch("redis.Redis.from_url", return_value=mock_r):
        out = await gtu.update_geo_themes()
    assert isinstance(out, dict)
    assert len(out.get("active_themes", [])) >= 1


@pytest.mark.asyncio
async def test_redis_setex_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    async def ok() -> dict:
        return {"active_themes": [], "source": "perplexity_sonar"}

    monkeypatch.setattr(gtu, "fetch_from_perplexity", ok)
    mock_r = MagicMock()
    mock_r.setex = MagicMock()
    with patch("redis.Redis.from_url", return_value=mock_r):
        await gtu.update_geo_themes()
    args, _kw = mock_r.setex.call_args
    assert args[0] == gtu.GEO_THEMES_KEY
    assert args[1] == 86400


def test_get_cached_themes_reads_redis() -> None:
    payload = {"active_themes": [{"key": "k"}], "source": "x"}

    class FakeRedis:
        def get(self, _k: str) -> str:
            return json.dumps(payload)

    with patch("redis.Redis.from_url", return_value=FakeRedis()):
        got = gtu.get_cached_themes()
    assert got["active_themes"][0]["key"] == "k"


def test_get_cached_themes_fallback_on_redis_exception() -> None:
    def boom(**_kw: object) -> object:
        raise ConnectionError()

    with patch("redis.Redis.from_url", side_effect=boom):
        got = gtu.get_cached_themes()
    assert got.get("source") == "fallback_static"
