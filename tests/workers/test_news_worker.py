"""ADR-001 Phase 2 — ECS news worker Benzinga WS gating."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from stocvest.workers import news_worker as nw


def _settings(*, benzinga_ws_enabled: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        stocvest_news_worker_benzinga_ws_enabled=benzinga_ws_enabled,
        stocvest_news_triage_queue_url="https://sqs.example/queue",
        benzinga_api_key="",
        benzinga_news_ws_url="wss://api.benzinga.com/api/v1/news/stream",
        stocvest_news_worker_cloudwatch_namespace="Stocvest/NewsWorker",
        stocvest_news_worker_heartbeat_key="stocvest:news_worker:heartbeat",
        aws_region="us-east-1",
    )


@pytest.mark.unit
def test_benzinga_ws_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nw, "get_settings", lambda: _settings(benzinga_ws_enabled=False))
    worker = nw.NewsWorker()
    assert worker.benzinga_ws_enabled() is False


@pytest.mark.asyncio
async def test_build_worker_tasks_skips_benzinga_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nw, "get_settings", lambda: _settings(benzinga_ws_enabled=False))
    worker = nw.NewsWorker()

    async def _noop_edgar() -> None:
        return None

    async def _noop_health() -> None:
        return None

    benzinga_called = {"n": 0}

    async def _spy_benzinga() -> None:
        benzinga_called["n"] += 1

    monkeypatch.setattr(worker, "_run_benzinga_stream", _spy_benzinga)
    monkeypatch.setattr(worker, "_run_edgar_poller", _noop_edgar)
    monkeypatch.setattr(worker, "_run_health_reporter", _noop_health)

    tasks = worker.build_worker_tasks()
    assert len(tasks) == 2
    assert benzinga_called["n"] == 0
    for task in tasks:
        task.cancel()


@pytest.mark.asyncio
async def test_build_worker_tasks_includes_benzinga_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nw, "get_settings", lambda: _settings(benzinga_ws_enabled=True))
    worker = nw.NewsWorker()

    async def _noop_edgar() -> None:
        return None

    async def _noop_health() -> None:
        return None

    async def _spy_benzinga() -> None:
        return None

    monkeypatch.setattr(worker, "_run_benzinga_stream", _spy_benzinga)
    monkeypatch.setattr(worker, "_run_edgar_poller", _noop_edgar)
    monkeypatch.setattr(worker, "_run_health_reporter", _noop_health)

    tasks = worker.build_worker_tasks()
    assert len(tasks) == 3
    for task in tasks:
        task.cancel()
