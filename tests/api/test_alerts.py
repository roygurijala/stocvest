from __future__ import annotations

import json
import time
from typing import Any
from unittest.mock import MagicMock

import pytest

from stocvest.api.handlers.signals import swing_composite_handler
from stocvest.api.lambda_dispatch import lambda_handler
from stocvest.data.alert_store import get_in_memory_alert_store
from stocvest.data.models import AlertPreferences, AlertType
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.services.alert_trigger import AlertTriggerService
from stocvest.services.email_service import EmailService


def _ev(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    sub: str = "al-user",
    email: str = "al@example.com",
) -> dict[str, Any]:
    rk = f"{method} {path}"
    return {
        "version": "2.0",
        "routeKey": rk,
        "path": path,
        "httpMethod": method,
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
        "requestContext": {
            "authorizer": {"claims": {"sub": sub, "email": email}},
            "http": {"method": method, "path": path},
        },
    }


def _body(resp: dict[str, Any]) -> Any:
    return json.loads(str(resp.get("body") or "{}"))


@pytest.fixture
def brokers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")


def test_alert_preferences_default_values(brokers: None) -> None:
    r = lambda_handler(_ev("GET", "/v1/alerts/preferences"), {})
    assert r["statusCode"] == 200
    b = _body(r)
    assert b["email_enabled"] is True
    assert b["on_gap_detected"] is False
    assert b["watchlist_only"] is True


def test_save_and_retrieve_preferences(brokers: None) -> None:
    r1 = lambda_handler(
        _ev(
            "PATCH",
            "/v1/alerts/preferences",
            body={"email_enabled": False, "on_signal_fired": False},
        ),
        {},
    )
    assert r1["statusCode"] == 200
    assert _body(r1)["email_enabled"] is False
    r2 = lambda_handler(_ev("GET", "/v1/alerts/preferences"), {})
    assert _body(r2)["email_enabled"] is False


def test_signal_alert_skipped_when_email_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    store.save_preferences("u1", AlertPreferences(user_id="u1", email_enabled=False))
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="swing_composite",
        is_confluence=False,
        confluence_score=None,
    )
    send.assert_not_called()


def test_signal_alert_skipped_when_not_on_watchlist(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["AAPL"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="swing_composite",
        is_confluence=False,
        confluence_score=None,
    )
    send.assert_not_called()


def test_signal_alert_sent_when_on_watchlist(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="swing_composite",
        is_confluence=False,
        confluence_score=None,
    )
    send.assert_called_once()


def test_confluence_alert_type_when_confluence(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=90,
        pattern="swing_composite",
        is_confluence=True,
        confluence_score=4,
    )
    assert send.call_args is not None
    assert send.call_args.kwargs["alert_type"] == AlertType.CONFLUENCE_ALERT


def test_pdt_warning_at_2_trades(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_pdt_alert(user_id="u1", user_email="a@b.com", trades_used=2)
    send.assert_called_once()
    assert send.call_args.kwargs["alert_type"] == AlertType.PDT_WARNING


def test_pdt_blocked_at_3_trades(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_pdt_alert(user_id="u1", user_email="a@b.com", trades_used=3)
    send.assert_called_once()
    assert send.call_args.kwargs["alert_type"] == AlertType.PDT_BLOCKED


def test_alert_never_blocks_signal_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(EmailService, "send_alert_email", MagicMock(side_effect=RuntimeError("ses down")))
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: MagicMock(record_signal=MagicMock()))
    event = {
        "body": json.dumps(
            {
                "regime": "bull",
                "symbol": "NVDA",
                "price_at_signal": 100.0,
                "signals": [
                    {"layer": "technical", "score": 0.8, "confidence": 0.9},
                    {"layer": "news", "score": 0.6, "confidence": 0.85},
                    {"layer": "macro", "score": 0.5, "confidence": 0.8},
                ],
                "symbol_snapshot": {"last_trade_price": 100.0},
            }
        ),
        "requestContext": {
            "authorizer": {"claims": {"sub": "sig-u1", "email": "sig@test.com"}},
            "http": {"method": "POST", "path": "/v1/signals/swing/composite"},
        },
        "version": "2.0",
        "routeKey": "POST /v1/signals/swing/composite",
    }
    resp = swing_composite_handler(event, {})
    assert resp["statusCode"] == 200
    time.sleep(0.08)


def test_quiet_hours_suppresses_alert(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    monkeypatch.setattr(AlertTriggerService, "_in_quiet_hours", lambda self, prefs: True)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="x",
        is_confluence=False,
        confluence_score=None,
    )
    send.assert_not_called()


def test_alerts_history_empty(brokers: None) -> None:
    r = lambda_handler(_ev("GET", "/v1/alerts/history"), {})
    assert r["statusCode"] == 200
    assert _body(r)["alerts"] == []
