"""POST /v1/desk/refresh — manual Opportunity Desk batch."""

from __future__ import annotations

import json

import pytest

from stocvest.api.handlers.desk import desk_refresh_handler
from stocvest.api.services.opportunity_desk.desk_refresh import (
    DeskRefreshCooldownError,
    run_manual_desk_refresh,
)


def _event(*, user_id: str | None = "user-1") -> dict:
    claims = {"sub": user_id} if user_id else {}
    return {
        "httpMethod": "POST",
        "path": "/v1/desk/refresh",
        "requestContext": {
            "requestId": "req-1",
            "http": {"method": "POST", "path": "/v1/desk/refresh"},
            "authorizer": {"claims": claims},
        },
    }


def test_desk_refresh_requires_auth() -> None:
    out = desk_refresh_handler(_event(user_id=None), {})
    assert out["statusCode"] == 401


def test_desk_refresh_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.desk.run_manual_desk_refresh",
        lambda _uid: {"status": "ok", "tiers": ["movers", "full"]},
    )
    out = desk_refresh_handler(_event(), {})
    assert out["statusCode"] == 200
    body = json.loads(out["body"])
    assert body["status"] == "ok"
    assert body["tiers"] == ["movers", "full"]


def test_desk_refresh_cooldown(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(_uid: str) -> dict:
        raise DeskRefreshCooldownError(retry_after_seconds=120)

    monkeypatch.setattr("stocvest.api.handlers.desk.run_manual_desk_refresh", _raise)
    out = desk_refresh_handler(_event(), {})
    assert out["statusCode"] == 429
    body = json.loads(out["body"])
    assert body["retry_after_seconds"] == 120


def test_run_manual_desk_refresh_releases_cooldown_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeRedis:
        deleted: list[str] = []

        def delete(self, key: str) -> None:
            self.deleted.append(key)

    fake = _FakeRedis()
    monkeypatch.setattr(
        "stocvest.api.services.opportunity_desk.desk_refresh.try_acquire_desk_refresh_cooldown",
        lambda _uid: (True, 0),
    )
    monkeypatch.setattr("stocvest.api.services.opportunity_desk.desk_refresh.upstash_configured", lambda: True)
    monkeypatch.setattr("stocvest.api.services.opportunity_desk.desk_refresh.get_upstash", lambda: fake)

    def _batch(*, tier: str = "full") -> dict:
        if tier == "movers":
            return {"ok": True}
        raise RuntimeError("full batch failed")

    monkeypatch.setattr("stocvest.api.services.opportunity_desk.desk_refresh.run_opportunity_desk_batch_sync", _batch)

    with pytest.raises(RuntimeError, match="full batch failed"):
        run_manual_desk_refresh("user-abc")

    assert fake.deleted == ["stocvest:desk:refresh_cooldown:user-abc"]


def test_run_manual_desk_refresh_keeps_cooldown_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeRedis:
        deleted: list[str] = []

        def delete(self, key: str) -> None:
            self.deleted.append(key)

    fake = _FakeRedis()
    monkeypatch.setattr(
        "stocvest.api.services.opportunity_desk.desk_refresh.try_acquire_desk_refresh_cooldown",
        lambda _uid: (True, 0),
    )
    monkeypatch.setattr("stocvest.api.services.opportunity_desk.desk_refresh.upstash_configured", lambda: True)
    monkeypatch.setattr("stocvest.api.services.opportunity_desk.desk_refresh.get_upstash", lambda: fake)
    monkeypatch.setattr(
        "stocvest.api.services.opportunity_desk.desk_refresh.run_opportunity_desk_batch_sync",
        lambda *, tier="full": {"tier": tier, "ok": True},
    )

    out = run_manual_desk_refresh("user-ok")
    assert out["status"] == "ok"
    assert fake.deleted == []
