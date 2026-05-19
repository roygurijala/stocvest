"""Pre-IPO monitor worker tests (Chunk 9)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from stocvest.workers import pre_ipo_monitor as pim
from stocvest.workers.pre_ipo_monitor import handler, pre_ipo_active_key


@pytest.mark.asyncio
async def test_handler_stores_activated_entities(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch() -> tuple[list[str], str]:
        return ["OpenAI", "SpaceX"], "OpenAI funding headline"

    monkeypatch.setattr(pim, "fetch_pre_ipo_from_perplexity", fake_fetch)
    mock_r = MagicMock()
    mock_r.setex = MagicMock()
    with patch("stocvest.workers.pre_ipo_monitor.get_sync_redis", return_value=mock_r):
        resp = await pim.run_pre_ipo_monitor()
    assert "OpenAI" in resp["activated_entities"]
    mock_r.setex.assert_called_once()
    key, ttl, payload = mock_r.setex.call_args[0]
    assert key.startswith("stocvest:pre_ipo_active:")
    assert ttl == 86400
    assert "OpenAI" in json.loads(payload)


@pytest.mark.asyncio
async def test_handler_stores_empty_list_no_news(monkeypatch: pytest.MonkeyPatch) -> None:
    async def empty() -> tuple[list[str], str]:
        return [], "No pre-IPO news today."

    monkeypatch.setattr(pim, "fetch_pre_ipo_from_perplexity", empty)
    mock_r = MagicMock()
    with patch("stocvest.workers.pre_ipo_monitor.get_sync_redis", return_value=mock_r):
        resp = await pim.run_pre_ipo_monitor()
    assert resp["activated_entities"] == []


def test_handler_returns_200_on_perplexity_error() -> None:
    mock_r = MagicMock()
    with patch("stocvest.workers.pre_ipo_monitor.get_sync_redis", return_value=mock_r):
        with patch(
            "stocvest.workers.pre_ipo_monitor.asyncio.run",
            side_effect=RuntimeError("perplexity down"),
        ):
            resp = handler({}, None)
    assert resp["statusCode"] == 200
    assert resp["activated_entities"] == []


def test_redis_key_format_correct() -> None:
    assert pre_ipo_active_key("2026-05-18") == "stocvest:pre_ipo_active:2026-05-18"
